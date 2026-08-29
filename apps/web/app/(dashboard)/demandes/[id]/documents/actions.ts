'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { LIBELLES_DOCUMENT, TYPES_DOCUMENT } from '@vigon/shared';

import { ErreurAutorisation, requirePermissionApi } from '@/lib/auth/guards';
import { emettreDocument } from '@/lib/documents/emission';
import { lireDocument } from '@/lib/documents/requetes';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Émission et suivi des documents financiers d'une affaire.
 *
 * Toute la logique d'émission vit dans `emettreDocument` : ces actions ne font
 * que la garde, la validation de saisie et le rafraîchissement. Le gel du
 * contenu, la numérotation et le refus d'une offre non approuvée s'y trouvent,
 * et n'ont pas à être redits ici.
 */

export type ResultatDocument =
  | { ok: true; message: string }
  | { ok: false; message: string };

const emissionSchema = z.object({
  offreId: z.coerce.number().int().positive(),
  type: z.enum(TYPES_DOCUMENT),
  // Une échéance ne concerne que ce qui s'encaisse ; laissée vide, elle reste
  // nulle plutôt que de recevoir une date par défaut qui engagerait le client.
  dateEcheance: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  notes: z.string().trim().max(2_000).optional(),
});

export async function emettreDocumentFinancier(
  demandeId: number,
  _etat: ResultatDocument | null,
  donnees: FormData,
): Promise<ResultatDocument> {
  try {
    const utilisateur = await requirePermissionApi('document.emettre');

    const parse = emissionSchema.safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Saisie invalide.' };
    }

    const resultat = await emettreDocument({
      tenant: utilisateur.tenant_id,
      utilisateurId: utilisateur.id,
      offreId: parse.data.offreId,
      type: parse.data.type,
      dateEcheance: parse.data.dateEcheance,
      notes: parse.data.notes,
    });

    if (!resultat.ok) return resultat;

    revalidatePath(`/demandes/${demandeId}/documents`);
    revalidatePath(`/demandes/${demandeId}/historique`);

    return {
      ok: true,
      message: `${LIBELLES_DOCUMENT[parse.data.type]} ${resultat.numero} émis.`,
    };
  } catch (e) {
    if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
    throw e;
  }
}

/**
 * Envoie le document au client, en PDF joint.
 *
 * POURQUOI L'ENVOI VIT ICI ET PAS DANS `emettreDocument`
 *
 * Émettre et envoyer sont deux décisions distinctes. Un bon de commande se
 * prépare souvent avant d'être transmis, une pro-forma se relit, et une facture
 * part parfois par un autre canal. Les coudre ensemble retirerait à l'humain le
 * seul moment où il peut encore vérifier — et l'émission est irréversible, le
 * numéro étant consommé.
 *
 * PERMISSION : `document.emettre`, sans en créer une nouvelle. Transmettre est
 * la suite naturelle d'émettre, et le même public l'exerce — l'avant-vente qui
 * est en face du client, la finance qui tient les comptes. Une permission de
 * plus se serait ajoutée à la matrice sans distinguer personne.
 *
 * LE PDF EST PRODUIT ICI, PAS À L'ÉMISSION : un document jamais envoyé n'a pas
 * à coûter un rendu ni une place de stockage. Il est reproduit à l'identique à
 * chaque fois, `contenu_json` étant figé.
 */
export async function envoyerDocumentAuClient(
  demandeId: number,
  _etat: ResultatDocument | null,
  donnees: FormData,
): Promise<ResultatDocument> {
  try {
    const utilisateur = await requirePermissionApi('document.emettre');

    const parse = z
      .object({ documentId: z.coerce.number().int().positive() })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Saisie invalide.' };

    const db = createAdminClient();
    const doc = await lireDocument(utilisateur.tenant_id, parse.data.documentId);

    if (!doc) return { ok: false, message: 'Document introuvable.' };

    // Le document appartient-il à CETTE affaire ?
    //
    // `lireDocument` ne contrôle que le locataire. Sans ce second contrôle, un
    // `documentId` forgé faisait partir la facture d'une autre affaire du même
    // locataire — à l'adresse client de celle-ci. Deux dossiers distincts, un
    // document envoyé au mauvais destinataire, et rien pour le signaler.
    //
    // Le rapprochement se fait sur la donnée en base, jamais sur le champ du
    // formulaire, qui est précisément ce dont on se méfie.
    if (doc.demandeId !== demandeId) {
      return { ok: false, message: 'Document introuvable.' };
    }

    // Un document annulé ne part pas : l'envoyer donnerait au client une pièce
    // que la plateforme considère comme nulle.
    if (doc.statut === 'annule') {
      return { ok: false, message: 'Ce document est annulé : il ne peut pas être envoyé.' };
    }
    if (!doc.contenu) {
      return {
        ok: false,
        message: `Le contenu figé de ${doc.numero} est illisible : envoi refusé.`,
      };
    }

    const { data: demande } = await db
      .from('demandes')
      .select('id, code, email_client, clients(nom, email_principal)')
      .eq('id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      .maybeSingle();

    const client = demande
      ? Array.isArray(demande.clients)
        ? demande.clients[0]
        : demande.clients
      : null;

    // L'adresse est une donnée VIVANTE, pas figée : le contenu du document ne
    // doit pas changer, mais son destinataire peut avoir changé de messagerie
    // depuis l'émission. `contenu.client.email` reste le repli.
    const destinataire =
      demande?.email_client ?? client?.email_principal ?? doc.contenu.client.email ?? null;

    if (!destinataire) {
      return {
        ok: false,
        message: 'Adresse client inconnue : renseignez-la sur la fiche client.',
      };
    }

    // Envois déjà faits, comptés dans l'audit.
    //
    // Ni refus ni blocage : un client qui a perdu le message doit pouvoir le
    // recevoir de nouveau, et une facture n'a pas de statut « envoyée » en base.
    // Mais un second envoi involontaire — un double clic, un retour arrière —
    // met deux fois la même pièce chez le client sans que personne ne le sache.
    // Le dire dans le retour suffit à le rendre visible.
    const { count: envoisPrecedents } = await db
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', utilisateur.tenant_id)
      .eq('entite', 'documents_financiers')
      .eq('entite_id', doc.id)
      .eq('action', 'document.envoye');

    const services = await import('@vigon/services');
    if (!services.envoiConfigure('principal')) {
      return {
        ok: false,
        message:
          'Aucun transport configuré pour le compte principal : renseignez un mot de passe d’application SMTP ou un refresh token Gmail.',
      };
    }

    const { produirePdfDocument } = await import('@/lib/documents/pdf');
    const pdf = await produirePdfDocument(doc, utilisateur.tenant_id);

    const { buildEmailDocumentHtml, sujetEmailDocument } = await import(
      '@/lib/documents/envoi'
    );

    const libelleType = LIBELLES_DOCUMENT[doc.type];
    const montant = `${doc.totalTtc.toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${doc.devise}`;

    const echeance = doc.dateEcheance
      ? new Date(doc.dateEcheance).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : null;

    const sujet = sujetEmailDocument({
      libelleType,
      numero: doc.numero,
      objet: doc.contenu.objet,
    });

    const html = buildEmailDocumentHtml({
      libelleType,
      numero: doc.numero,
      clientNom: doc.contenu.client.nom,
      objet: doc.contenu.objet,
      totalTtc: montant,
      dateEcheance: echeance,
      nomFichier: pdf.nomFichier,
    });

    // Point d'envoi UNIFIÉ, jamais l'API Gmail en direct : c'est l'erreur qui
    // avait fait échouer l'envoi de l'offre (BUG-14) sur un SMTP parfaitement
    // utilisable.
    const message = await services.envoyer('principal', {
      a: destinataire,
      sujet,
      html,
      piecesJointes: [
        { nom: pdf.nomFichier, contenu: pdf.buffer, typeMime: 'application/pdf' },
      ],
    });

    await db.from('communications').insert({
      tenant_id: utilisateur.tenant_id,
      demande_id: demandeId,
      direction: 'sortant',
      type: 'document_financier',
      thread_id: message.threadId,
      message_id: message.messageId,
      destinataires: [destinataire],
      sujet,
      corps_html: html,
    });

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'documents_financiers',
      entite_id: doc.id,
      action: 'document.envoye',
      details: {
        numero: doc.numero,
        destinataire,
        transport: message.transport,
        // Signalé plutôt que tu : un PDF non archivé reste reproductible depuis
        // `contenu_json`, mais on doit savoir qu'il manque.
        archive: pdf.url !== null,
        rang: (envoisPrecedents ?? 0) + 1,
      },
    });

    revalidatePath(`/demandes/${demandeId}/documents`);
    revalidatePath(`/demandes/${demandeId}/historique`);

    const rang = (envoisPrecedents ?? 0) + 1;

    return {
      ok: true,
      message:
        rang > 1
          ? `${doc.numero} envoyé à ${destinataire} — ${rang}ᵉ envoi de ce document.`
          : `${doc.numero} envoyé à ${destinataire}.`,
    };
  } catch (e) {
    if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };

    // Remonté à l'écran plutôt que relancé : l'envoi échoue pour des raisons
    // extérieures — serveur SMTP indisponible, adresse refusée — et l'opérateur
    // doit lire laquelle, pas voir une page d'erreur.
    const motif = e instanceof Error ? e.message : String(e);
    console.error('[document] envoi au client en échec', e);
    return { ok: false, message: `Envoi impossible : ${motif}` };
  }
}

const suiviSchema = z.object({
  documentId: z.coerce.number().int().positive(),
  dateReglement: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

/**
 * Constate le règlement d'un document.
 *
 * Réservé à FINANCE : c'est le seul acte du module qui engage la comptabilité.
 * La transition est conditionnée à `statut = 'emis'` — un document annulé ne
 * peut pas être réglé, et un règlement déjà constaté ne se redate pas d'un
 * second clic.
 */
export async function marquerRegle(
  demandeId: number,
  _etat: ResultatDocument | null,
  donnees: FormData,
): Promise<ResultatDocument> {
  try {
    const utilisateur = await requirePermissionApi('document.regler');

    const parse = suiviSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Saisie invalide.' };

    const db = createAdminClient();

    const { data, error } = await db
      .from('documents_financiers')
      .update({
        statut: 'regle',
        date_reglement: parse.data.dateReglement ?? new Date().toISOString().slice(0, 10),
      })
      .eq('id', parse.data.documentId)
      .eq('tenant_id', utilisateur.tenant_id)
      .eq('statut', 'emis')
      .select('numero')
      .maybeSingle();

    if (error || !data) {
      return { ok: false, message: 'Ce document n’est plus dans un état réglable.' };
    }

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'documents_financiers',
      entite_id: parse.data.documentId,
      action: 'document.regle',
      details: { numero: data.numero },
    });

    revalidatePath(`/demandes/${demandeId}/documents`);
    revalidatePath(`/demandes/${demandeId}/historique`);

    return { ok: true, message: `${data.numero} marqué réglé.` };
  } catch (e) {
    if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
    throw e;
  }
}

/**
 * Annule un document émis.
 *
 * Le document n'est jamais supprimé : une séquence de numérotation trouée n'est
 * plus opposable, et un document disparu est indistinguable d'un document qui
 * n'a jamais existé. L'annulation est un statut, pas un effacement.
 */
export async function annulerDocument(
  demandeId: number,
  _etat: ResultatDocument | null,
  donnees: FormData,
): Promise<ResultatDocument> {
  try {
    const utilisateur = await requirePermissionApi('document.emettre');

    const parse = z
      .object({
        documentId: z.coerce.number().int().positive(),
        motif: z.string().trim().min(3, 'Indiquez le motif de l’annulation.').max(500),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Saisie invalide.' };
    }

    const db = createAdminClient();

    const { data, error } = await db
      .from('documents_financiers')
      .update({ statut: 'annule', notes: parse.data.motif })
      .eq('id', parse.data.documentId)
      .eq('tenant_id', utilisateur.tenant_id)
      .eq('statut', 'emis')
      .select('numero')
      .maybeSingle();

    if (error || !data) {
      return { ok: false, message: 'Seul un document émis peut être annulé.' };
    }

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'documents_financiers',
      entite_id: parse.data.documentId,
      action: 'document.annule',
      details: { numero: data.numero, motif: parse.data.motif },
    });

    revalidatePath(`/demandes/${demandeId}/documents`);
    revalidatePath(`/demandes/${demandeId}/historique`);

    return { ok: true, message: `${data.numero} annulé.` };
  } catch (e) {
    if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
    throw e;
  }
}
