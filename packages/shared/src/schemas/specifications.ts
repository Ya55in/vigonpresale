import { z } from 'zod';

/**
 * Sortie attendue de l'extraction des spécifications techniques (flux étape 2).
 *
 * Tolérant en entrée, strict en sortie : le modèle renvoie parfois une quantité
 * sous forme de texte (« 3 unités ») ou une date vide. On normalise ici plutôt
 * que de rejeter toute la demande.
 */

/** Accepte 3, "3", "3 unités" ; rejette ce dont on ne peut extraire un nombre. */
const quantite = z.union([z.number(), z.string()]).transform((v, ctx) => {
  if (typeof v === 'number') return v;
  const m = v.replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!m) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Quantité illisible : « ${v} »` });
    return z.NEVER;
  }
  return Number(m[0]);
});

/** Normalise une date en ISO (YYYY-MM-DD) ; null si absente ou illisible. */
const dateIso = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (!v) return null;
    const m = v.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  });

const texteOuNull = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

export const articleExtraitSchema = z.object({
  ligne_num: z.number().int().positive(),
  designation: z.string().min(1),
  reference: texteOuNull,
  marque: z.string().min(1).default('Non specifie'),
  fabricant: texteOuNull,
  quantite,
  unite: z.string().default('unité'),
  categorie: texteOuNull,
  specifications: texteOuNull,
  confiance: z.coerce.number().min(0).max(1).default(0.5),
});

export const clientExtraitSchema = z.object({
  nom: texteOuNull,
  email: texteOuNull,
  contact: texteOuNull,
});

export const specificationsSchema = z.object({
  client: clientExtraitSchema.default({ nom: null, email: null, contact: null }),
  titre_projet: z.string().min(1).default('Demande sans titre'),
  deadline_souhaitee: dateIso,
  articles: z.array(articleExtraitSchema),
});

export type ArticleExtrait = z.infer<typeof articleExtraitSchema>;
export type Specifications = z.infer<typeof specificationsSchema>;
