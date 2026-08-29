import { z } from 'zod';

/**
 * Contenu figé d'un document financier.
 *
 * Gelé dans `contenu_json` à l'émission, comme le BoQ d'une offre l'est dans
 * `source_json` : une facture émise ne doit jamais changer parce qu'un prix de
 * la feuille de coûts a été corrigé ensuite. Un document financier est une
 * photographie, pas une vue.
 *
 * Le client est recopié pour la même raison — une raison sociale qui change
 * après émission ne réécrit pas les factures déjà envoyées.
 */

export const TYPES_DOCUMENT = ['bon_commande', 'proforma', 'facture'] as const;
export type TypeDocument = (typeof TYPES_DOCUMENT)[number];

export const LIBELLES_DOCUMENT: Record<TypeDocument, string> = {
  bon_commande: 'Bon de commande',
  proforma: 'Facture pro-forma',
  facture: 'Facture',
};

/** Préfixe du numéro, distinct par type pour que la référence se lise seule. */
export const PREFIXES_DOCUMENT: Record<TypeDocument, string> = {
  bon_commande: 'BC',
  proforma: 'PF',
  facture: 'FA',
};

export const STATUTS_DOCUMENT = ['emis', 'regle', 'annule'] as const;
export type StatutDocument = (typeof STATUTS_DOCUMENT)[number];

export const LIBELLES_STATUT_DOCUMENT: Record<StatutDocument, string> = {
  emis: 'Émis',
  regle: 'Réglé',
  annule: 'Annulé',
};

export const ligneDocumentSchema = z.object({
  designation: z.string().min(1),
  reference: z.string().nullable().default(null),
  quantite: z.number().positive(),
  unite: z.string().default('u'),
  prixUnitaireHt: z.number().nonnegative(),
  totalHt: z.number().nonnegative(),
});

export const contenuDocumentSchema = z.object({
  client: z.object({
    nom: z.string(),
    adresse: z.string().nullable().default(null),
    email: z.string().nullable().default(null),
  }),
  /** Référence de l'affaire, reprise pour que le client s'y retrouve. */
  reference: z.string().nullable().default(null),
  objet: z.string().nullable().default(null),
  lignes: z.array(ligneDocumentSchema),
  totaux: z.object({
    devise: z.string().default('MAD'),
    totalHt: z.number(),
    tvaPct: z.number(),
    totalTva: z.number(),
    totalTtc: z.number(),
  }),
  conditions: z
    .object({
      livraison: z.string().nullable().default(null),
      paiement: z.string().nullable().default(null),
      garantie: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
});

export type LigneDocument = z.infer<typeof ligneDocumentSchema>;
export type ContenuDocument = z.infer<typeof contenuDocumentSchema>;

export function estTypeDocument(v: unknown): v is TypeDocument {
  return typeof v === 'string' && (TYPES_DOCUMENT as readonly string[]).includes(v);
}

export function estStatutDocument(v: unknown): v is StatutDocument {
  return typeof v === 'string' && (STATUTS_DOCUMENT as readonly string[]).includes(v);
}

/**
 * Totaux recalculés depuis les lignes.
 *
 * Jamais repris d'une saisie ni d'un appel : un total qui ne découle pas de ses
 * lignes est un document faux, et c'est le genre d'écart qu'on ne découvre
 * qu'au litige. Les arrondis se font au centime, à chaque étape, pour que la
 * somme affichée corresponde à celle qu'un lecteur refait à la main.
 */
export function calculerTotaux(
  lignes: LigneDocument[],
  tvaPct: number,
): { totalHt: number; totalTva: number; totalTtc: number } {
  const centimes = (n: number) => Math.round(n * 100) / 100;

  const totalHt = centimes(lignes.reduce((s, l) => s + l.totalHt, 0));
  const totalTva = centimes(totalHt * (tvaPct / 100));

  return { totalHt, totalTva, totalTtc: centimes(totalHt + totalTva) };
}
