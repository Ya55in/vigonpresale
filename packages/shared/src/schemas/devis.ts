import { z } from 'zod';

/** Classification d'un message fournisseur entrant (flux étape 7). */
export const NATURES_MESSAGE = [
  'DEVIS_RECU',
  'DEMANDE_PRECISION',
  'AUTOMATIQUE',
] as const;

export const classificationSchema = z.object({
  nature: z.enum(NATURES_MESSAGE),
});

export type NatureMessage = (typeof NATURES_MESSAGE)[number];
export type Classification = z.infer<typeof classificationSchema>;

const texteOuNull = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

/** Montant : accepte « 24 500,00 MAD » ; null si le modèle n'a rien trouvé. */
const montantOuNull = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    // Retire espaces (y compris insécables) et séparateurs de milliers.
    const nettoye = v.replace(/[\s ]/g, '').replace(/,(\d{2})$/, '.$1');
    const m = nettoye.match(/-?\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  });

const pourcentage = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').replace('%', ''));
    return Number.isFinite(n) ? n : null;
  });

export const ligneDevisSchema = z.object({
  designation: z.string().min(1),
  reference: texteOuNull,
  quantite: z.coerce.number().positive().default(1),
  // null assumé : jamais de prix inventé, la ligne est signalée en aval.
  prix_achat_ht: montantOuNull,
  remise_pct: pourcentage,
  tva_pct: pourcentage,
  disponibilite: texteOuNull,
  confiance: z.coerce.number().min(0).max(1).default(0.5),
});

export const devisSchema = z.object({
  numero_devis: texteOuNull,
  date_devis: texteOuNull,
  devise: z.string().default('MAD'),
  validite: texteOuNull,
  delai_livraison: texteOuNull,
  conditions_paiement: texteOuNull,
  // Laissée en clair : « 2 ans retour atelier » et « 24 mois sur site » ne se
  // comparent pas sur la seule durée, et normaliser ferait perdre la réserve.
  garantie: texteOuNull,
  lignes: z.array(ligneDevisSchema),
});

export type LigneDevis = z.infer<typeof ligneDevisSchema>;
export type Devis = z.infer<typeof devisSchema>;
