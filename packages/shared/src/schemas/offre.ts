import { z } from 'zod';

/** Enrichissement commercial d'un produit pour l'offre (flux étape 9a). */
export const descriptionProduitSchema = z.object({
  description_technique: z.string().min(1),
  points_cles: z.array(z.string().min(1)).max(6).default([]),
});

/** Synthèse de la solution proposée (flux étape 9b). */
export const syntheseOffreSchema = z.object({
  titre: z.string().min(1),
  resume: z.string().min(1),
  tableau_explicatif: z
    .array(
      z.object({
        besoin: z.string().min(1),
        solution_proposee: z.string().min(1),
        benefice: z.string().min(1),
      }),
    )
    .default([]),
});

/**
 * Résultat du sourcing d'un fournisseur par recherche web (flux étape 3b).
 *
 * `email` vide est une réponse VALIDE : le prompt impose au modèle de le
 * laisser vide plutôt que d'inventer une adresse. L'exiger non vide ferait
 * réessayer inutilement une extraction pourtant correcte. La validité
 * commerciale est vérifiée ensuite par emailCommercialValide().
 */
export const fournisseurSourceSchema = z.object({
  nom: z.string().trim().default(''),
  email: z.string().trim().default(''),
  site: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
});

export type DescriptionProduit = z.infer<typeof descriptionProduitSchema>;
export type SyntheseOffre = z.infer<typeof syntheseOffreSchema>;
export type FournisseurSource = z.infer<typeof fournisseurSourceSchema>;
