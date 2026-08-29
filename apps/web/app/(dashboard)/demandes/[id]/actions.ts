'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requirePermissionApi, ErreurAutorisation } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat = { ok: true; message: string } | { ok: false; message: string };

const schema = z.object({ demandeId: z.coerce.number().int().positive() });

/**
 * Remet une demande bloquée dans le flux.
 *
 * POURQUOI CETTE ACTION EXISTE
 *
 * `bloquee` était un terminus. Deux endroits l'écrivaient — contenu inexploitable
 * à la réception, extraction en échec — et aucun ne le levait. Six demandes y
 * sont restées après le retrait du modèle `llama-3.3-70b-versatile` par Groq :
 * la cause était réparée depuis, les demandes non.
 *
 * ELLE N'EXTRAIT RIEN ELLE-MÊME. Elle repose la demande en `nouvelle` ; le job
 * « reprise » du worker la reprend au cycle suivant. L'extraction reste d'un
 * seul côté, celui qui porte la garde anti-chevauchement — deux extractions
 * concurrentes sur la même demande inséreraient les articles en double, et rien
 * ne le signalerait avant le chiffrage.
 *
 * @see apps/worker/src/jobs/reprendreExtractions.ts
 */
export async function relancerExtraction(
  _etatPrecedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    // Même permission que la modification d'une demande : rouvrir un dossier
    // clos est un acte d'instruction, pas une simple lecture.
    const utilisateur = await requirePermissionApi('demande.modifier');

    const parse = schema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Demande invalide.' };
    const { demandeId } = parse.data;

    const db = createAdminClient();

    const { data: demande } = await db
      .from('demandes')
      .select('id, code, statut, contenu_consolide')
      .eq('id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      .maybeSingle();

    if (!demande) return { ok: false, message: 'Demande introuvable.' };
    if (demande.statut !== 'bloquee') {
      return { ok: false, message: "Cette demande n'est pas bloquée." };
    }

    // Sans contenu consolidé, la reprise tournerait à vide et rebloquerait la
    // demande sur le même motif : le dire ici évite un aller-retour inutile.
    if (!demande.contenu_consolide?.trim()) {
      return {
        ok: false,
        message:
          "Aucun contenu à analyser : le message d'origine était vide ou ses pièces jointes illisibles. Complétez les articles à la main.",
      };
    }

    const { data: repris, error } = await db
      .from('demandes')
      .update({ statut: 'nouvelle', motif_blocage: null })
      .eq('id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      // Verrou optimiste : deux relances simultanées n'en produisent qu'une.
      .eq('statut', 'bloquee')
      .select('id');

    if (error) return { ok: false, message: error.message };
    if (!repris || repris.length === 0) {
      return { ok: false, message: 'Demande déjà relancée par ailleurs.' };
    }

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'demandes',
      entite_id: demandeId,
      action: 'demande.debloquee',
      details: { code: demande.code },
    });

    revalidatePath(`/demandes/${demandeId}`);
    revalidatePath('/demandes');

    return {
      ok: true,
      message: 'Extraction relancée. Le worker la reprend au prochain cycle.',
    };
  } catch (e) {
    if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
    console.error('[demande] relance d’extraction en échec', e);
    return { ok: false, message: "L'opération a échoué. Réessayez." };
  }
}
