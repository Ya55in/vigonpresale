'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { booleenFormulaire } from '@vigon/shared';

import { ErreurAutorisation, requirePermissionApi } from '@/lib/auth/guards';
import type { ProfilUtilisateur } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat =
  | { ok: true; message?: string }
  | { ok: false; message: string };

/** Statuts après lesquels une consultation ne doit plus être retouchée. */
const STATUTS_FIGES = ['envoyee', 'relancee', 'devis_recu', 'precision_demandee'];

/**
 * Statuts encore replanifiables : tant que le worker n'a pas expédié le
 * message, la date reste modifiable et l'envoi annulable.
 */
const STATUTS_AVANT_ENVOI = ['en_validation', 'planifiee'] as const;

async function demandeDuTenant(
  utilisateur: ProfilUtilisateur,
  demandeId: number,
): Promise<{ id: number; code: string } | null> {
  const { data } = await createAdminClient()
    .from('demandes')
    .select('id, code')
    .eq('id', demandeId)
    .eq('tenant_id', utilisateur.tenant_id)
    .maybeSingle();

  return data;
}

async function consultationDuTenant(
  utilisateur: ProfilUtilisateur,
  consultationId: number,
  demandeId: number,
): Promise<{ id: number; statut: string; marque: string | null } | null> {
  const { data } = await createAdminClient()
    .from('consultations')
    .select('id, statut, marque')
    .eq('id', consultationId)
    .eq('demande_id', demandeId)
    .eq('tenant_id', utilisateur.tenant_id)
    .maybeSingle();

  return data;
}

async function auditer(
  utilisateur: ProfilUtilisateur,
  action: string,
  entiteId: number,
  details: Record<string, unknown>,
): Promise<void> {
  await createAdminClient().from('audit_events').insert({
    tenant_id: utilisateur.tenant_id,
    user_id: utilisateur.id,
    entite: 'consultations',
    entite_id: entiteId,
    action,
    details: JSON.parse(JSON.stringify(details)),
  });
}

function enEchec(e: unknown): Resultat {
  if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
  console.error('[consultations] action en échec', e);
  return { ok: false, message: "L'opération a échoué. Réessayez." };
}

/**
 * Prépare les consultations : résout les fournisseurs par marque puis fait
 * rédiger une demande de devis par le modèle.
 *
 * Le sourcing web et les appels au modèle prennent plusieurs dizaines de
 * secondes : l'action est volontairement déclenchée à la demande, jamais
 * automatiquement au chargement de l'écran.
 */
export async function preparerConsultations(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('consultation.creer');

    const parse = z
      .object({
        demandeId: z.coerce.number().int().positive(),
        /**
         * Identifiants retenus dans la proposition sémantique, séparés par des
         * virgules. Absent, on consulte tout ce que la résolution par marque
         * trouve — le comportement d'avant.
         */
        retenus: z
          .string()
          .optional()
          .default('')
          .transform((v) =>
            v
              .split(',')
              .map((x) => Number(x.trim()))
              .filter((n) => Number.isInteger(n) && n > 0),
          ),
      })
      .safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const demande = await demandeDuTenant(utilisateur, parse.data.demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    const db = createAdminClient();
    const { data: articles } = await db
      .from('demande_items')
      .select('id, designation, reference, marque, quantite')
      .eq('demande_id', demande.id);

    if (!articles || articles.length === 0) {
      return { ok: false, message: "Aucun article : validez d'abord les articles." };
    }

    // Import différé : @vigon/services tire imapflow et googleapis, inutiles
    // au rendu des autres écrans.
    const { genererConsultations } = await import('@vigon/services');

    const resultat = await genererConsultations({
      demandeId: demande.id,
      tenant: utilisateur.tenant_id,
      articles: articles.map((a) => ({
        id: a.id,
        designation: a.designation,
        reference: a.reference,
        marque: a.marque,
        quantite: Number(a.quantite),
      })),
      fournisseursRetenus: parse.data.retenus,
    });

    if (resultat.creees > 0) {
      await db
        .from('demandes')
        .update({ statut: 'en_validation_rfq' })
        .eq('id', demande.id)
        .eq('tenant_id', utilisateur.tenant_id);
    }

    await auditer(utilisateur, 'consultations.preparees', demande.id, {
      code: demande.code,
      ...resultat,
    });

    revalidatePath(`/demandes/${demande.id}/consultations`);

    const details = [
      `${resultat.creees} consultation(s) préparée(s)`,
      resultat.ignorees > 0 ? `${resultat.ignorees} déjà existante(s)` : '',
      resultat.nonResolues.length > 0
        ? `${resultat.nonResolues.length} marque(s) sans fournisseur`
        : '',
      resultat.erreurs.length > 0 ? `${resultat.erreurs.length} en erreur` : '',
    ].filter(Boolean);

    return { ok: true, message: details.join(' — ') };
  } catch (e) {
    return enEchec(e);
  }
}

export type ResultatProposition =
  | {
      ok: true;
      fournisseurs: {
        fournisseurIds: number[];
        nom: string;
        score: number;
        articlesCouverts: { designation: string; similarite: number; preuve: string }[];
        articlesDemandes: number;
        fiabilite: {
          consultations: number;
          reponses: number;
          tauxReponse: number | null;
          delaiMoyenHeures: number | null;
        } | null;
      }[];
      articlesNonCouverts: string[];
      /** Marques à confier au sourcing web quand l'historique ne couvre pas. */
      marquesASourcer: string[];
      indisponible: boolean;
    }
  | { ok: false; message: string };

/**
 * Propose les fournisseurs susceptibles de couvrir le besoin.
 *
 * Fondé sur ce que chacun a déjà chiffré, pas sur sa fiche : un fournisseur
 * ayant coté des bornes WiFi remonte sur un besoin WiFi même si sa marque
 * déclarée est autre. La recherche par marque, elle, le manquerait.
 *
 * Ne décide rien — l'avant-vente coche qui consulter.
 */
export async function proposerFournisseurs(
  demandeId: number,
): Promise<ResultatProposition> {
  try {
    const utilisateur = await requirePermissionApi('consultation.creer');

    const demande = await demandeDuTenant(utilisateur, demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    const { data: articles } = await createAdminClient()
      .from('demande_items')
      .select('id, designation, reference, marque')
      .eq('demande_id', demande.id);

    if (!articles || articles.length === 0) {
      return { ok: false, message: "Aucun article : validez d'abord les articles." };
    }

    const { chercherFournisseurs } = await import('@vigon/services');

    const resultat = await chercherFournisseurs({
      tenant: utilisateur.tenant_id,
      articles,
    });

    return {
      ok: true,
      fournisseurs: resultat.fournisseurs.map((f) => ({
        fournisseurIds: f.fournisseurIds,
        nom: f.nom,
        score: f.score,
        articlesCouverts: f.articlesCouverts.map((a) => ({
          designation: a.designation,
          similarite: a.similarite,
          preuve: a.preuve,
        })),
        articlesDemandes: f.articlesDemandes,
        fiabilite: f.fiabilite
          ? {
              consultations: f.fiabilite.consultations,
              reponses: f.fiabilite.reponses,
              tauxReponse: f.fiabilite.tauxReponse,
              delaiMoyenHeures: f.fiabilite.delaiMoyenHeures,
            }
          : null,
      })),
      articlesNonCouverts: resultat.articlesNonCouverts.map((a) => a.designation),
      marquesASourcer: resultat.marquesASourcer,
      indisponible: resultat.indisponible,
    };
  } catch (e) {
    if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
    console.error('[proposition] échec', e);
    return { ok: false, message: 'Recherche impossible.' };
  }
}

/** Une ligne non vide par entrée ; c'est la saisie d'une liste à puces. */
const lignes = (libelle: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.split('\n').map((l) => l.trim()).filter(Boolean))
    .pipe(z.array(z.string().min(1)).min(1, `${libelle} : au moins une ligne.`));

/**
 * Champs du message tel qu'il est saisi à l'écran.
 *
 * L'utilisateur ne manipule jamais de HTML : il édite le contenu, et le
 * rendu est réassemblé par buildRfqHtml() comme à la génération. C'est la
 * même règle que pour le modèle — la mise en forme ne vient jamais de la
 * saisie.
 */
const editionSchema = z.object({
  id: z.coerce.number().int().positive(),
  demandeId: z.coerce.number().int().positive(),
  sujet: z.string().trim().min(1, "L'objet est obligatoire.").max(300),
  intro: z.string().trim().min(1, "L'introduction est obligatoire.").max(2_000),
  transition: z.string().trim().min(1, 'La transition est obligatoire.').max(2_000),
  articles: lignes('Articles'),
  questionsIntro: z
    .string()
    .trim()
    .min(1, "L'introduction des questions est obligatoire.")
    .max(2_000),
  questions: lignes('Questions'),
  cloture: z.string().trim().min(1, 'La clôture est obligatoire.').max(2_000),
});

export async function modifierConsultation(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('consultation.modifier');

    const parse = editionSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { id, demandeId, sujet } = parse.data;

    if (!(await demandeDuTenant(utilisateur, demandeId))) {
      return { ok: false, message: 'Demande introuvable.' };
    }

    const consultation = await consultationDuTenant(utilisateur, id, demandeId);
    if (!consultation) return { ok: false, message: 'Consultation introuvable.' };

    // Un message parti ne se réécrit pas : le fournisseur a reçu l'original.
    if (STATUTS_FIGES.includes(consultation.statut)) {
      return { ok: false, message: 'Cette consultation est déjà envoyée.' };
    }

    // Import différé, comme à la préparation : @vigon/services tire imapflow
    // et googleapis, inutiles au rendu des autres écrans.
    const { buildRfqHtml, buildRfqTexte } = await import('@vigon/services');

    const rfq = {
      sujet,
      intro: parse.data.intro,
      transition: parse.data.transition,
      articles: parse.data.articles,
      questions_intro: parse.data.questionsIntro,
      questions: parse.data.questions,
      cloture: parse.data.cloture,
    };

    const { error } = await createAdminClient()
      .from('consultations')
      .update({
        sujet,
        corps_html: buildRfqHtml(rfq),
        corps_texte: buildRfqTexte(rfq),
      })
      .eq('id', id);

    if (error) return { ok: false, message: error.message };

    await auditer(utilisateur, 'consultation.modifiee', id, {
      demande_id: demandeId,
      marque: consultation.marque,
    });

    revalidatePath(`/demandes/${demandeId}/consultations`);
    return { ok: true, message: 'Modifications enregistrées.' };
  } catch (e) {
    return enEchec(e);
  }
}

export async function exclureConsultation(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('consultation.modifier');

    const parse = z
      .object({
        id: z.coerce.number().int().positive(),
        demandeId: z.coerce.number().int().positive(),
        retablir: booleenFormulaire(),
      })
      .safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const { id, demandeId, retablir } = parse.data;

    if (!(await demandeDuTenant(utilisateur, demandeId))) {
      return { ok: false, message: 'Demande introuvable.' };
    }
    const consultation = await consultationDuTenant(utilisateur, id, demandeId);
    if (!consultation) return { ok: false, message: 'Consultation introuvable.' };

    if (STATUTS_FIGES.includes(consultation.statut)) {
      return { ok: false, message: 'Cette consultation est déjà envoyée.' };
    }

    const { error } = await createAdminClient()
      .from('consultations')
      .update({
        statut: retablir ? 'en_validation' : 'abandonnee',
        date_envoi_prevue: null,
      })
      .eq('id', id);

    if (error) return { ok: false, message: error.message };

    await auditer(
      utilisateur,
      retablir ? 'consultation.retablie' : 'consultation.exclue',
      id,
      { demande_id: demandeId, marque: consultation.marque },
    );

    revalidatePath(`/demandes/${demandeId}/consultations`);
    return { ok: true, message: retablir ? 'Consultation rétablie.' : 'Consultation exclue.' };
  } catch (e) {
    return enEchec(e);
  }
}

const planificationSchema = z.object({
  demandeId: z.coerce.number().int().positive(),
  /** Vide = toutes les consultations à valider de la demande. */
  id: z.coerce.number().int().positive().optional(),
  /** ISO ; absent = envoi immédiat. */
  dateEnvoi: z.string().trim().optional(),
});

/**
 * Planifie l'envoi des consultations retenues.
 *
 * L'envoi lui-même est fait par le worker, jamais ici : une Server Action ne
 * doit pas dépendre d'un appel Gmail qui peut durer ou échouer, et le worker
 * garantit un unique chemin d'envoi, donc une seule règle d'idempotence.
 */
export async function planifierEnvoi(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('consultation.planifier');

    const parse = planificationSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Données invalides.' };
    const { demandeId, id, dateEnvoi } = parse.data;

    const demande = await demandeDuTenant(utilisateur, demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    let quand: Date;
    if (dateEnvoi) {
      quand = new Date(dateEnvoi);
      if (Number.isNaN(quand.getTime())) {
        return { ok: false, message: 'Date de planification invalide.' };
      }
      // Une date passée serait envoyée immédiatement par le worker, ce qui
      // trahirait l'intention : mieux vaut le refuser explicitement.
      if (quand.getTime() < Date.now() - 60_000) {
        return { ok: false, message: 'La date de planification est déjà passée.' };
      }
    } else {
      quand = new Date();
    }

    const db = createAdminClient();
    let requete = db
      .from('consultations')
      .update({
        statut: 'planifiee',
        envoi_immediat: !dateEnvoi,
        date_envoi_prevue: quand.toISOString(),
      })
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      // Une consultation déjà planifiée reste replanifiable : c'est le seul
      // moyen de corriger une date saisie trop vite. Le filtre exclut en
      // revanche tout ce que le worker a déjà expédié.
      .in('statut', STATUTS_AVANT_ENVOI);

    if (id) requete = requete.eq('id', id);

    const { data, error } = await requete.select('id');
    if (error) return { ok: false, message: error.message };

    const nombre = data?.length ?? 0;
    if (nombre === 0) {
      return {
        ok: false,
        message: 'Aucune consultation planifiable ici — elles sont déjà parties.',
      };
    }

    await db
      .from('demandes')
      .update({ statut: 'planifiee' })
      .eq('id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id);

    await auditer(utilisateur, 'consultations.planifiees', demandeId, {
      code: demande.code,
      consultations: nombre,
      date_envoi_prevue: quand.toISOString(),
      immediat: !dateEnvoi,
    });

    revalidatePath(`/demandes/${demandeId}/consultations`);
    revalidatePath(`/demandes/${demandeId}`);

    return {
      ok: true,
      message: dateEnvoi
        ? `${nombre} envoi(s) planifié(s) pour le ${quand.toLocaleString('fr-FR')}.`
        : `${nombre} envoi(s) déclenché(s) — le worker les traite sous une minute.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Remet des consultations planifiées à l'état « à valider ».
 *
 * Course avec le worker assumée : il relève toutes les minutes, et un envoi
 * déjà parti a fait passer la consultation à « envoyee ». Le filtre sur
 * `planifiee` fait donc échouer l'annulation plutôt que de laisser croire
 * qu'un message parti a été retenu.
 */
export async function annulerPlanification(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('consultation.planifier');

    const parse = z
      .object({
        demandeId: z.coerce.number().int().positive(),
        /** Vide = toutes les consultations planifiées de la demande. */
        id: z.coerce.number().int().positive().optional(),
      })
      .safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const { demandeId, id } = parse.data;

    const demande = await demandeDuTenant(utilisateur, demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    const db = createAdminClient();
    let requete = db
      .from('consultations')
      .update({
        statut: 'en_validation',
        envoi_immediat: false,
        date_envoi_prevue: null,
      })
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      .eq('statut', 'planifiee');

    if (id) requete = requete.eq('id', id);

    const { data, error } = await requete.select('id');
    if (error) return { ok: false, message: error.message };

    const nombre = data?.length ?? 0;
    if (nombre === 0) {
      return {
        ok: false,
        message: "Rien à annuler — l'envoi est déjà parti ou n'était pas planifié.",
      };
    }

    // La demande retourne en validation RFQ : plus aucun envoi n'est programmé.
    const { count } = await db
      .from('consultations')
      .select('id', { count: 'exact', head: true })
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      .eq('statut', 'planifiee');

    if ((count ?? 0) === 0) {
      await db
        .from('demandes')
        .update({ statut: 'en_validation_rfq' })
        .eq('id', demandeId)
        .eq('tenant_id', utilisateur.tenant_id);
    }

    await auditer(utilisateur, 'consultations.planification_annulee', demandeId, {
      code: demande.code,
      consultations: nombre,
    });

    revalidatePath(`/demandes/${demandeId}/consultations`);
    revalidatePath(`/demandes/${demandeId}`);

    return { ok: true, message: `${nombre} envoi(s) annulé(s).` };
  } catch (e) {
    return enEchec(e);
  }
}

const reponseSchema = z.object({
  demandeId: z.coerce.number().int().positive(),
  consultationId: z.coerce.number().int().positive(),
  message: z
    .string()
    .trim()
    .min(10, 'Rédigez une réponse d’au moins 10 caractères.')
    .max(5000),
});

/**
 * Répond au fournisseur dans le fil de la consultation.
 *
 * Sert au cas le plus courant après une demande de précision : le fournisseur
 * pose une question, l'avant-vente y répond sans quitter la plateforme. Répondre
 * depuis sa boîte mail ferait échapper l'échange au dossier, et la réponse
 * n'apparaîtrait dans aucun historique.
 *
 * L'envoi part EN RÉPONSE au dernier message connu du fil : le fournisseur
 * retrouve le contexte, et son éventuelle relance revient au bon endroit — c'est
 * ce dont dépend l'appariement à la réception.
 */
export async function repondreFournisseur(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('consultation.modifier');

    const parse = reponseSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { demandeId, consultationId, message } = parse.data;

    const db = createAdminClient();

    const { data: consultation } = await db
      .from('consultations')
      .select('id, demande_id, marque, sujet, statut, thread_id, message_id, fournisseur_email, fournisseur_nom')
      .eq('id', consultationId)
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      .maybeSingle();

    if (!consultation) return { ok: false, message: 'Consultation introuvable.' };
    if (!consultation.fournisseur_email) {
      return { ok: false, message: 'Aucune adresse fournisseur sur cette consultation.' };
    }
    if (!consultation.thread_id) {
      return {
        ok: false,
        message: "La consultation n'a pas encore été envoyée : rien à quoi répondre.",
      };
    }

    const { envoiConfigure, envoyer } = await import('@vigon/services');
    if (!envoiConfigure('fournisseur')) {
      return { ok: false, message: "Aucun transport d'envoi configuré." };
    }

    // On répond au dernier message reçu du fournisseur, pas à notre propre
    // consultation : c'est lui qui porte le fil côté destinataire.
    const { data: dernierEntrant } = await db
      .from('communications')
      .select('message_id')
      .eq('consultation_id', consultationId)
      .eq('direction', 'entrant')
      .not('message_id', 'is', null)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    const repondA = dernierEntrant?.message_id ?? consultation.message_id ?? undefined;

    const { buildReponseHtml } = await import('@/lib/consultations/reponseHtml');

    let envoye;
    try {
      envoye = await envoyer('fournisseur', {
        a: consultation.fournisseur_email,
        sujet: `Re: ${consultation.sujet ?? 'demande de devis'}`,
        html: buildReponseHtml({ message }),
        texte: message,
        threadId: consultation.thread_id,
        inReplyTo: repondA,
        references: repondA,
      });
    } catch (e) {
      return {
        ok: false,
        message: `Envoi impossible : ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    await db.from('communications').insert({
      tenant_id: utilisateur.tenant_id,
      demande_id: demandeId,
      consultation_id: consultationId,
      direction: 'sortant',
      type: 'reponse_precision',
      thread_id: envoye.threadId,
      message_id: envoye.messageId,
      in_reply_to: repondA ?? null,
      destinataires: [consultation.fournisseur_email],
      sujet: `Re: ${consultation.sujet ?? ''}`,
      corps_texte: message,
    });

    // La balle repasse au fournisseur : on repart en attente de devis et les
    // relances reprennent, sinon le dossier resterait figé sur « précision
    // demandée » alors que la question a été traitée.
    if (consultation.statut === 'precision_demandee') {
      const { lireParametres } = await import('@vigon/services');
      const parametres = await lireParametres(utilisateur.tenant_id);

      await db
        .from('consultations')
        .update({
          statut: 'envoyee',
          prochaine_relance: new Date(
            Date.now() + parametres.delaiRelanceHeures * 3_600_000,
          ).toISOString(),
        })
        .eq('id', consultationId);
    }

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'consultations',
      entite_id: consultationId,
      action: 'consultation.reponse_envoyee',
      details: {
        marque: consultation.marque,
        destinataire: consultation.fournisseur_email,
        longueur: message.length,
      },
    });

    revalidatePath(`/demandes/${demandeId}/consultations`);
    return {
      ok: true,
      message: `Réponse envoyée à ${consultation.fournisseur_nom ?? consultation.fournisseur_email}.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}
