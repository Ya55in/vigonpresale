'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { booleenFormulaire } from '@vigon/shared';

import { ErreurAutorisation, requirePermissionApi } from '@/lib/auth/guards';
import { genererOffreComplete } from '@/lib/offres/generer';
import { lireValidation, validationObligatoire } from '@/lib/validation/circuit';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Déclenche la génération de l'offre.
 *
 * L'opération est longue — enrichissement IA par produit, recherche d'images,
 * puis Gamma ou rendu PDF — d'où un déclenchement explicite plutôt qu'un
 * lancement automatique à l'ouverture de l'écran.
 */
export async function genererOffre(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('offre.generer');

    const parse = z
      .object({
        demandeId: z.coerce.number().int().positive(),
        /**
         * Feuille à chiffrer. Absente, la plus récente est prise — c'est le
         * parcours d'origine. Renseignée quand la demande porte une feuille par
         * fournisseur et qu'on génère l'offre de l'une d'elles.
         */
        costSheetId: z.coerce.number().int().positive().optional(),
        /**
         * Visuels produits. Absent du formulaire, la valeur reste vraie — le
         * comportement d'avant, et celui qu'on veut par défaut.
         */
        avecImages: booleenFormulaire(true),
        /**
         * Conditions propres à cette offre. Les trois champs vont ensemble :
         * n'en surcharger qu'un laisserait deux valeurs du modèle standard à
         * côté d'une exception, sans que l'écran dise laquelle est laquelle.
         */
        livraison: z.string().trim().max(500).optional().default(''),
        paiement: z.string().trim().max(500).optional().default(''),
        garantie: z.string().trim().max(500).optional().default(''),
      })
      .safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const db = createAdminClient();

    const { data: demande } = await db
      .from('demandes')
      .select('id')
      .eq('id', parse.data.demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      .maybeSingle();

    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    // La feuille doit appartenir à CETTE demande : sans ce contrôle, un
    // identifiant forgé chiffrerait l'offre d'un autre dossier.
    if (parse.data.costSheetId) {
      const { data: feuille } = await db
        .from('cost_sheets')
        .select('id')
        .eq('id', parse.data.costSheetId)
        .eq('demande_id', demande.id)
        .eq('tenant_id', utilisateur.tenant_id)
        .maybeSingle();

      if (!feuille) return { ok: false, message: 'Feuille de coûts introuvable.' };
    }

    // Circuit d'approbation, quand le tenant l'exige. Désactivé par défaut :
    // le rendre obligatoire d'emblée aurait bloqué tous les dossiers en cours.
    if (await validationObligatoire(utilisateur.tenant_id)) {
      const feuilleId =
        parse.data.costSheetId ??
        (
          await db
            .from('cost_sheets')
            .select('id')
            .eq('demande_id', demande.id)
            .eq('tenant_id', utilisateur.tenant_id)
            .order('version', { ascending: false })
            .limit(1)
            .maybeSingle()
        ).data?.id;

      if (!feuilleId) return { ok: false, message: 'Aucune feuille de coûts.' };

      const validation = await lireValidation(utilisateur.tenant_id, feuilleId);

      if (validation.statut !== 'approuvee') {
        const messages: Record<string, string> = {
          aucune: "Validation requise : soumettez la feuille à l'administrateur.",
          en_attente: 'Décision en attente : l’administrateur n’a pas encore répondu.',
          refusee: `Génération refusée${validation.motifRefus ? ` — ${validation.motifRefus}` : ''}.`,
          expiree: 'La demande de validation est caduque : soumettez-en une nouvelle.',
        };

        return { ok: false, message: messages[validation.statut] ?? 'Validation requise.' };
      }
    }

    // Surcharge seulement si les trois champs sont renseignés : un formulaire
    // laissé vide doit reprendre le modèle standard, pas écrire des conditions
    // vides dans l'offre.
    const { livraison, paiement, garantie } = parse.data;
    const conditions =
      livraison && paiement && garantie ? { livraison, paiement, garantie } : undefined;

    const resultat = await genererOffreComplete({
      demandeId: demande.id,
      tenant: utilisateur.tenant_id,
      utilisateurId: utilisateur.id,
      costSheetId: parse.data.costSheetId,
      avecImages: parse.data.avecImages,
      conditions,
    });

    revalidatePath(`/demandes/${demande.id}/offre`);
    revalidatePath(`/demandes/${demande.id}`);

    const details = [
      // `numero` porte déjà « -Vnn » : la version n'est pas répétée.
      `Offre ${resultat.numero} générée`,
      `${resultat.produits} produit(s)`,
      resultat.repliLocal ? 'PDF produit localement' : 'document Gamma',
      resultat.photosManquantes.length > 0
        ? `${resultat.photosManquantes.length} visuel(s) à fournir`
        : '',
    ].filter(Boolean);

    return { ok: true, message: details.join(' — ') };
  } catch (e) {
    if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
    const message = e instanceof Error ? e.message : String(e);
    console.error('[offre] génération en échec', e);
    return { ok: false, message };
  }
}
