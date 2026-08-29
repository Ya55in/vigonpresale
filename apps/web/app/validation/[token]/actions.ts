'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { lireValidationPublique } from '@/lib/validation/circuit';
import { createAdminClient } from '@/lib/supabase/admin';

export type ResultatDecision =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Décision de l'administrateur, prise depuis le lien reçu.
 *
 * Le jeton EST l'autorisation, comme sur la page offre et la page devis : il
 * est long, aléatoire, et ne circule que dans le message envoyé à
 * l'administrateur. Aucun identifiant interne n'est accepté du formulaire — la
 * validation, le tenant et la feuille sont tous retrouvés depuis lui, pour
 * qu'un paramètre forgé ne puisse pas viser une autre demande.
 *
 * L'écriture est conditionnée à `statut = 'en_attente'` : deux clics successifs
 * ou un lien rejoué ne peuvent pas renverser une décision déjà prise.
 */
async function decider(
  token: string,
  statut: 'approuvee' | 'refusee',
  motif: string | null,
): Promise<ResultatDecision> {
  const validation = await lireValidationPublique(token);

  if (!validation) return { ok: false, message: 'Ce lien n’est pas valide.' };

  if (validation.expiree) {
    return {
      ok: false,
      message: 'Cette demande est caduque. Demandez à l’avant-vente d’en émettre une nouvelle.',
    };
  }

  if (!validation.decidable) {
    return { ok: false, message: 'Une décision a déjà été prise sur cette demande.' };
  }

  const db = createAdminClient();

  const { data, error } = await db
    .from('validations_offre')
    .update({
      statut,
      motif_refus: motif,
      date_decision: new Date().toISOString(),
    })
    .eq('id', validation.id)
    // Garde d'idempotence : seule la transition depuis « en attente » passe.
    .eq('statut', 'en_attente')
    .select('id, tenant_id, demande_id, cost_sheet_id')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: 'Une décision a déjà été prise sur cette demande.' };
  }

  await db.from('notifications').insert(
    (['presale', 'finance'] as const).map((role) => ({
      tenant_id: data.tenant_id,
      role_cible: role,
      type: statut === 'approuvee' ? 'costing_a_valider' : 'costing_renvoye',
      severite: statut === 'approuvee' ? 'info' : 'avertissement',
      titre:
        statut === 'approuvee'
          ? 'Génération de l’offre approuvée'
          : 'Génération de l’offre refusée',
      message:
        statut === 'approuvee'
          ? 'L’administrateur a donné son accord : l’offre peut être générée.'
          : `Refus${motif ? ` — ${motif}` : ''}. Reprenez le costing avant de resoumettre.`,
      lien: `/demandes/${data.demande_id}/costing`,
      demande_id: data.demande_id,
    })),
  );

  await db.from('audit_events').insert({
    tenant_id: data.tenant_id,
    entite: 'cost_sheets',
    entite_id: data.cost_sheet_id,
    action: statut === 'approuvee' ? 'validation.approuvee' : 'validation.refusee',
    // Décidé depuis un lien public : aucun utilisateur authentifié derrière.
    acteur_type: 'admin_lien',
    details: { motif },
  });

  revalidatePath(`/validation/${token}`);
  revalidatePath(`/demandes/${data.demande_id}/costing`);

  return {
    ok: true,
    message:
      statut === 'approuvee'
        ? 'Accord enregistré. L’avant-vente peut générer l’offre.'
        : 'Refus enregistré. L’avant-vente est prévenue.',
  };
}

export async function approuverGeneration(
  token: string,
  _etat: ResultatDecision | null,
): Promise<ResultatDecision> {
  return decider(token, 'approuvee', null);
}

export async function refuserGeneration(
  token: string,
  _etat: ResultatDecision | null,
  donnees: FormData,
): Promise<ResultatDecision> {
  const parse = z
    .object({
      // Le motif est exigé : un refus sans raison oblige l'avant-vente à
      // deviner ce qu'il faut corriger avant de resoumettre.
      motif: z
        .string()
        .trim()
        .min(3, 'Indiquez le motif du refus.')
        .max(1_000),
    })
    .safeParse(Object.fromEntries(donnees));

  if (!parse.success) {
    return { ok: false, message: parse.error.issues[0]?.message ?? 'Motif requis.' };
  }

  return decider(token, 'refusee', parse.data.motif);
}
