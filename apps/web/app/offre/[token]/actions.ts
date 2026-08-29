'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';

export type ResultatPublic =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Actions ouvertes au client, sans authentification.
 *
 * Le jeton EST l'autorisation : il est long, aléatoire et ne circule que dans
 * le courriel envoyé au client. Aucune de ces actions n'accepte d'identifiant
 * interne — tout est retrouvé depuis le jeton, pour qu'un paramètre forgé ne
 * puisse pas viser une autre offre.
 */

/** Seule une offre effectivement chez le client peut être décidée. */
const STATUTS_DECIDABLES = ['validee', 'envoyee', 'consultee'] as const;

/**
 * Test d'appartenance qui n'impose pas le type littéral à son argument.
 *
 * `Array.includes` d'un tuple `as const` exigerait que la valeur testée soit
 * déjà l'un des littéraux — or c'est justement ce qu'on cherche à savoir.
 */
const estDecidable = (statut: string | null): boolean =>
  (STATUTS_DECIDABLES as readonly string[]).includes(statut ?? '');

async function offreDepuisToken(token: string) {
  if (!token || token.length < 20) return null;

  const { data } = await createAdminClient()
    .from('offres')
    .select('id, tenant_id, demande_id, numero, statut, date_expiration')
    .eq('token_public', token)
    .maybeSingle();

  return data;
}

/** Notifie les rôles concernés par la décision du client. */
async function notifier(
  tenant: string,
  roles: ('presale' | 'finance' | 'after_sales' | 'admin')[],
  params: {
    type: string;
    severite: 'info' | 'avertissement';
    titre: string;
    message: string;
    offreId: number;
    demandeId: number | null;
  },
): Promise<void> {
  const db = createAdminClient();

  const { error } = await db.from('notifications').insert(
    roles.map((role) => ({
      tenant_id: tenant,
      role_cible: role,
      type: params.type,
      severite: params.severite,
      titre: params.titre,
      message: params.message,
      lien: `/offres/${params.offreId}/preview`,
      offre_id: params.offreId,
      demande_id: params.demandeId,
    })),
  );

  if (error) console.error(`[offre publique] notifications : ${error.message}`);
}

/**
 * Le client approuve : le deal est gagné.
 *
 * Le passage de statut est conditionné à l'état courant, ce qui rend un double
 * clic inoffensif — la seconde tentative ne trouve plus de ligne à mettre à jour.
 */
export async function approuverOffre(
  _etat: ResultatPublic | null,
  donnees: FormData,
): Promise<ResultatPublic> {
  try {
    const token = String(donnees.get('token') ?? '');
    const offre = await offreDepuisToken(token);

    if (!offre) return { ok: false, message: 'Offre introuvable.' };

    if (offre.statut === 'approuvee') {
      return { ok: true, message: 'Cette offre est déjà approuvée. Merci.' };
    }
    if (!estDecidable(offre.statut)) {
      return { ok: false, message: "Cette offre n'est plus disponible." };
    }
    if (offre.date_expiration && new Date(offre.date_expiration) < new Date()) {
      return {
        ok: false,
        message: 'Cette offre a expiré. Contactez-nous pour une mise à jour.',
      };
    }

    const db = createAdminClient();
    const maintenant = new Date().toISOString();

    const { data: approuvee } = await db
      .from('offres')
      .update({ statut: 'approuvee', date_approbation: maintenant })
      .eq('id', offre.id)
      .in('statut', STATUTS_DECIDABLES)
      .select('id');

    if (!approuvee || approuvee.length === 0) {
      return { ok: true, message: 'Cette offre est déjà approuvée. Merci.' };
    }

    if (offre.demande_id) {
      // Le client, lui, est parti : il ne réessaiera pas. Une affaire gagnée
      // qui ne s'inscrit pas se découvre au reporting, des semaines plus tard,
      // sans plus aucun moyen de savoir ce qui a échoué.
      const { data: demande, error: erreurDemande } = await db
        .from('demandes')
        .update({ statut: 'gagnee', date_decision: maintenant })
        .eq('id', offre.demande_id)
        .eq('tenant_id', offre.tenant_id)
        .select('opportunite_id')
        .maybeSingle();

      if (erreurDemande) {
        console.error(
          `[offre publique] ${offre.numero} approuvée mais affaire non marquée gagnée : ${erreurDemande.message}`,
        );
      }

      if (demande?.opportunite_id) {
        const { error: erreurOpportunite } = await db
          .from('opportunites')
          .update({ statut: 'gagnee' })
          .eq('id', demande.opportunite_id)
          .eq('tenant_id', offre.tenant_id);

        if (erreurOpportunite) {
          console.error(
            `[offre publique] opportunité ${demande.opportunite_id} non marquée gagnée : ${erreurOpportunite.message}`,
          );
        }
      }
    }

    // AFTER_SALES est notifié : c'est ce qui fait apparaître le dossier dans
    // son espace, la spec le prévoit explicitement.
    await notifier(offre.tenant_id, ['presale', 'finance', 'after_sales'], {
      type: 'offre_approuvee',
      severite: 'info',
      titre: `Offre approuvée — ${offre.numero}`,
      message: 'Le client a approuvé l’offre. Le deal est gagné.',
      offreId: offre.id,
      demandeId: offre.demande_id,
    });

    const entetes = await headers();
    await db.from('audit_events').insert({
      tenant_id: offre.tenant_id,
      entite: 'offres',
      entite_id: offre.id,
      action: 'offre.approuvee',
      acteur_type: 'client',
      ip: entetes.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent: entetes.get('user-agent'),
      details: { numero: offre.numero, demande_id: offre.demande_id },
    });

    revalidatePath(`/offre/${token}`);
    return {
      ok: true,
      message: 'Merci, votre approbation est enregistrée. Nous revenons vers vous.',
    };
  } catch (e) {
    console.error('[offre publique] approbation en échec', e);
    return { ok: false, message: "L'opération a échoué. Réessayez." };
  }
}

/**
 * Le client demande une modification.
 *
 * N'entraîne pas la perte du deal : l'offre reste ouverte et PRESALE reprend la
 * main. Seul un refus explicite ou l'expiration ferment le dossier.
 */
export async function demanderModification(
  _etat: ResultatPublic | null,
  donnees: FormData,
): Promise<ResultatPublic> {
  try {
    const parse = z
      .object({
        token: z.string().min(20),
        commentaire: z
          .string()
          .trim()
          .min(5, 'Merci de préciser votre demande.')
          .max(4000),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return {
        ok: false,
        message: parse.error.issues[0]?.message ?? 'Données invalides.',
      };
    }
    const { token, commentaire } = parse.data;

    const offre = await offreDepuisToken(token);
    if (!offre) return { ok: false, message: 'Offre introuvable.' };
    if (!estDecidable(offre.statut)) {
      return { ok: false, message: "Cette offre n'est plus modifiable." };
    }

    const db = createAdminClient();
    const entetes = await headers();

    await db.from('communications').insert({
      tenant_id: offre.tenant_id,
      demande_id: offre.demande_id,
      offre_id: offre.id,
      direction: 'entrant',
      type: 'demande_modification',
      canal: 'web',
      sujet: `Demande de modification — ${offre.numero}`,
      corps_texte: commentaire,
    });

    // ADMIN avec PRESALE : c'est le retour d'un client sur une offre partie,
    // il doit être visible du responsable et pas seulement de qui suit le dossier.
    await notifier(offre.tenant_id, ['presale', 'admin'], {
      type: 'offre_modification_demandee',
      severite: 'avertissement',
      titre: `Retour client à traiter — ${offre.numero}`,
      message: commentaire.slice(0, 500),
      offreId: offre.id,
      demandeId: offre.demande_id,
    });

    await db.from('audit_events').insert({
      tenant_id: offre.tenant_id,
      entite: 'offres',
      entite_id: offre.id,
      action: 'offre.modification_demandee',
      acteur_type: 'client',
      ip: entetes.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent: entetes.get('user-agent'),
      details: { numero: offre.numero, commentaire },
    });

    revalidatePath(`/offre/${token}`);
    return {
      ok: true,
      message: 'Votre demande est transmise. Nous revenons vers vous rapidement.',
    };
  } catch (e) {
    console.error('[offre publique] demande de modification en échec', e);
    return { ok: false, message: "L'opération a échoué. Réessayez." };
  }
}

/**
 * Le client décline explicitement : le deal est perdu.
 *
 * Le motif est obligatoire — la spec l'impose, et sans lui l'analyse des pertes
 * est impossible. Distinct de `demanderModification`, qui laisse le dossier
 * ouvert.
 */
export async function declinerOffre(
  _etat: ResultatPublic | null,
  donnees: FormData,
): Promise<ResultatPublic> {
  try {
    const parse = z
      .object({
        token: z.string().min(20),
        motif: z
          .string()
          .trim()
          .min(5, 'Merci d’indiquer le motif de votre refus.')
          .max(4000),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return {
        ok: false,
        message: parse.error.issues[0]?.message ?? 'Données invalides.',
      };
    }
    const { token, motif } = parse.data;

    const offre = await offreDepuisToken(token);
    if (!offre) return { ok: false, message: 'Offre introuvable.' };

    if (offre.statut === 'refusee') {
      return { ok: true, message: 'Votre refus est déjà enregistré.' };
    }
    if (!estDecidable(offre.statut)) {
      return { ok: false, message: "Cette offre n'est plus disponible." };
    }

    const db = createAdminClient();
    const maintenant = new Date().toISOString();

    const { data: refusee } = await db
      .from('offres')
      .update({ statut: 'refusee', date_refus: maintenant, motif_refus: motif })
      .eq('id', offre.id)
      .in('statut', STATUTS_DECIDABLES)
      .select('id');

    if (!refusee || refusee.length === 0) {
      return { ok: true, message: 'Votre refus est déjà enregistré.' };
    }

    if (offre.demande_id) {
      // Même raison qu'à l'approbation : le motif de perte est ce qui nourrit
      // l'analyse des échecs, et il ne se ressaisit pas après coup.
      const { data: demande, error: erreurDemande } = await db
        .from('demandes')
        .update({ statut: 'perdue', motif_perte: motif, date_decision: maintenant })
        .eq('id', offre.demande_id)
        .eq('tenant_id', offre.tenant_id)
        .select('opportunite_id')
        .maybeSingle();

      if (erreurDemande) {
        console.error(
          `[offre publique] ${offre.numero} refusée mais affaire non marquée perdue : ${erreurDemande.message}`,
        );
      }

      if (demande?.opportunite_id) {
        const { error: erreurOpportunite } = await db
          .from('opportunites')
          .update({ statut: 'perdue' })
          .eq('id', demande.opportunite_id)
          .eq('tenant_id', offre.tenant_id);

        if (erreurOpportunite) {
          console.error(
            `[offre publique] opportunité ${demande.opportunite_id} non marquée perdue : ${erreurOpportunite.message}`,
          );
        }
      }
    }

    await notifier(offre.tenant_id, ['presale', 'finance'], {
      type: 'offre_refusee',
      severite: 'avertissement',
      titre: `Offre refusée — ${offre.numero}`,
      message: motif.slice(0, 500),
      offreId: offre.id,
      demandeId: offre.demande_id,
    });

    const entetes = await headers();
    await db.from('audit_events').insert({
      tenant_id: offre.tenant_id,
      entite: 'offres',
      entite_id: offre.id,
      action: 'offre.refusee',
      acteur_type: 'client',
      ip: entetes.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      user_agent: entetes.get('user-agent'),
      details: { numero: offre.numero, motif, demande_id: offre.demande_id },
    });

    revalidatePath(`/offre/${token}`);
    return {
      ok: true,
      message: 'Votre réponse est enregistrée. Merci de nous avoir consultés.',
    };
  } catch (e) {
    console.error('[offre publique] refus en échec', e);
    return { ok: false, message: "L'opération a échoué. Réessayez." };
  }
}
