'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { booleenFormulaire, urlApplication } from '@vigon/shared';

import { ErreurAutorisation, requirePermissionApi } from '@/lib/auth/guards';
import { buildEmailOffreHtml } from '@/lib/offres/envoi';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat =
  | { ok: true; message: string }
  | { ok: false; message: string };

function enEchec(e: unknown): Resultat {
  if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
  console.error('[offre/valider] action en échec', e);
  return { ok: false, message: "L'opération a échoué. Réessayez." };
}

const montant = (valeur: number, devise: string): string =>
  `${valeur.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`;

/**
 * Valide l'offre et l'envoie au client.
 *
 * L'envoi du courriel est le seul maillon qui dépend d'un service tiers : s'il
 * échoue, l'offre reste « validee » avec son lien public utilisable, plutôt que
 * d'être bloquée. PRESALE peut alors transmettre le lien par un autre canal.
 */
export async function validerEtEnvoyer(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('offre.envoyer');

    const parse = z
      .object({
        offreId: z.coerce.number().int().positive(),
        /** Permet de valider sans envoyer, quand le client sera contacté autrement. */
        envoyer: booleenFormulaire(true),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };
    const { offreId, envoyer } = parse.data;

    const db = createAdminClient();

    const { data: offre } = await db
      .from('offres')
      .select(
        'id, demande_id, numero, titre, statut, token_public, source_json, delai_reponse_jours, pdf_url',
      )
      .eq('id', offreId)
      .eq('tenant_id', utilisateur.tenant_id)
      .maybeSingle();

    if (!offre) return { ok: false, message: 'Offre introuvable.' };

    if (['envoyee', 'consultee', 'approuvee'].includes(offre.statut ?? '')) {
      return { ok: false, message: 'Cette offre est déjà partie chez le client.' };
    }
    if (!offre.pdf_url) {
      return {
        ok: false,
        message: "Aucun document produit : régénérez l'offre avant de l'envoyer.",
      };
    }

    const { data: demande } = await db
      .from('demandes')
      .select('id, code, email_client, opportunite_id, clients(nom, email_principal)')
      .eq('id', offre.demande_id!)
      .eq('tenant_id', utilisateur.tenant_id)
      .single();

    const client = demande
      ? Array.isArray(demande.clients)
        ? demande.clients[0]
        : demande.clients
      : null;

    const destinataire = demande?.email_client ?? client?.email_principal ?? null;

    // --- Validation ---
    const { data: valide } = await db
      .from('offres')
      .update({
        statut: 'validee',
        date_validation: new Date().toISOString(),
        valide_par: utilisateur.id,
      })
      .eq('id', offreId)
      .not('statut', 'in', '("envoyee","consultee","approuvee")')
      .select('id');

    if (!valide || valide.length === 0) {
      return { ok: false, message: 'Offre déjà traitée par ailleurs.' };
    }

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'offres',
      entite_id: offreId,
      action: 'offre.validee',
      details: { numero: offre.numero },
    });

    if (!envoyer) {
      revalidatePath(`/offres/${offreId}/preview`);
      return { ok: true, message: 'Offre validée, sans envoi.' };
    }

    if (!destinataire) {
      revalidatePath(`/offres/${offreId}/preview`);
      return {
        ok: false,
        message:
          'Offre validée mais adresse client inconnue : renseignez-la sur la fiche client.',
      };
    }

    const appUrl = urlApplication();
    const lienPublic = `${appUrl}/offre/${offre.token_public}`;
    const delaiJours = offre.delai_reponse_jours ?? 15;
    const expiration = new Date(Date.now() + delaiJours * 86_400_000);

    const boq = (offre.source_json ?? {}) as {
      totaux?: { totalTtc?: number; devise?: string };
      solution?: { titre?: string };
    };

    /*
     * Point d'envoi UNIFIÉ, et non l'API Gmail directement : `envoyer` retient
     * le transport disponible — Gmail si un refresh token existe, SMTP sinon.
     *
     * Cet écran appelait `gmailConfigure` puis `envoyerEmail`, seul de toute
     * l'application à court-circuiter ce point. L'envoi de l'offre au client
     * était donc refusé faute de refresh token Gmail, alors que le SMTP
     * configuré fonctionnait — et servait déjà aux RFQ, aux relances et aux
     * invitations. Le bouton validait l'offre, puis annonçait « envoi
     * impossible » sur un compte parfaitement utilisable.
     *
     * `envoyer` est aliasé : c'est déjà le nom du booléen « valider sans
     * envoyer » du formulaire, une trentaine de lignes plus haut.
     */
    const {
      envoiConfigure,
      descriptionEnvoi,
      envoyer: envoyerCourriel,
    } = await import('@vigon/services');

    if (!envoiConfigure('principal')) {
      revalidatePath(`/offres/${offreId}/preview`);
      return {
        ok: false,
        message:
          'Offre validée. Envoi impossible : aucun transport pour le compte ' +
          'principal — renseigner un mot de passe d’application SMTP ' +
          '(IMAP_CLIENT_USER / IMAP_CLIENT_PASSWORD) ou un refresh token Gmail ' +
          `(GMAIL_PRINCIPAL_*). Lien à transmettre manuellement : ${lienPublic}`,
      };
    }

    const sujet = `Notre proposition — ${offre.titre ?? offre.numero} (${offre.numero})`;

    try {
      const message = await envoyerCourriel('principal', {
        a: destinataire,
        sujet,
        html: buildEmailOffreHtml({
          clientNom: client?.nom ?? 'Client',
          titreOffre: boq.solution?.titre ?? offre.titre ?? offre.numero,
          reference: offre.numero,
          lienPublic,
          validiteJours: delaiJours,
          totalTtc: montant(
            Number(boq.totaux?.totalTtc ?? 0),
            boq.totaux?.devise ?? 'MAD',
          ),
        }),
      });

      await db
        .from('offres')
        .update({
          statut: 'envoyee',
          date_envoi: new Date().toISOString(),
          envoye_par: utilisateur.id,
          date_expiration: expiration.toISOString(),
        })
        .eq('id', offreId);

      await db
        .from('demandes')
        .update({
          statut: 'offre_envoyee',
          date_envoi_client: new Date().toISOString(),
        })
        .eq('id', demande!.id)
        .eq('tenant_id', utilisateur.tenant_id);

      await db.from('communications').insert({
        tenant_id: utilisateur.tenant_id,
        demande_id: demande!.id,
        offre_id: offreId,
        direction: 'sortant',
        type: 'offre_client',
        thread_id: message.threadId,
        message_id: message.messageId,
        destinataires: [destinataire],
        sujet,
      });

      await db.from('audit_events').insert({
        tenant_id: utilisateur.tenant_id,
        user_id: utilisateur.id,
        entite: 'offres',
        entite_id: offreId,
        action: 'offre.envoyee',
        details: {
          numero: offre.numero,
          destinataire,
          expiration: expiration.toISOString(),
        },
      });

      revalidatePath(`/offres/${offreId}/preview`);
      revalidatePath(`/demandes/${demande!.id}`);

      // Le transport est nommé : c'est la première question posée quand un
      // client dit n'avoir rien reçu, et la réponse était jusqu'ici invisible
      // depuis l'écran.
      return {
        ok: true,
        message:
          `Offre envoyée à ${destinataire} par ${descriptionEnvoi('principal')}. ` +
          `Expire le ${expiration.toLocaleDateString('fr-FR')}.`,
      };
    } catch (e) {
      const motif = e instanceof Error ? e.message : String(e);

      await db.from('audit_events').insert({
        tenant_id: utilisateur.tenant_id,
        user_id: utilisateur.id,
        entite: 'offres',
        entite_id: offreId,
        action: 'offre.envoi_echoue',
        details: { numero: offre.numero, destinataire, motif },
      });

      revalidatePath(`/offres/${offreId}/preview`);
      return {
        ok: false,
        message: `Offre validée mais envoi échoué : ${motif}. Lien à transmettre : ${lienPublic}`,
      };
    }
  } catch (e) {
    return enEchec(e);
  }
}
