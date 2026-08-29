import { z } from 'zod';

/**
 * Devis saisi par le fournisseur lui-même, depuis le formulaire en ligne.
 *
 * Ce schéma remplace l'extraction par le modèle sur ce chemin : les données
 * arrivent déjà structurées, donc rien à deviner et rien à mal lire. C'est tout
 * l'intérêt du formulaire — un prix mal extrait se propageait jusqu'au costing.
 *
 * La validation est donc plus stricte qu'à l'extraction, où l'on accepte des
 * `null` faute de mieux. Ici il y a un humain devant l'écran : on peut exiger
 * un prix cohérent et le lui dire tout de suite.
 */

/** Montant saisi à la main : accepte « 24 500,50 » comme « 24500.5 ». */
const montantSaisi = z
  .union([z.number(), z.string()])
  .transform((v) => {
    if (typeof v === 'number') return v;
    // Espaces (y compris insécables) et virgule décimale française.
    const nettoye = v.replace(/[\s ]/g, '').replace(',', '.');
    return nettoye === '' ? Number.NaN : Number(nettoye);
  })
  .refine((n) => Number.isFinite(n) && n >= 0, 'Prix invalide')
  .refine((n) => n <= 1_000_000_000, 'Prix hors limites');

const texteCourt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .default('')
    .transform((v) => (v.length > 0 ? v : null));

export const ligneReponseSchema = z.object({
  /** Article consulté auquel la ligne répond ; jamais choisi par le fournisseur. */
  demandeItemId: z.coerce.number().int().positive(),
  /**
   * Une ligne non chiffrée est un refus de coter, pas un prix à zéro.
   * Elle n'est pas enregistrée — un zéro fausserait le comparatif.
   */
  chiffree: z.coerce.boolean().default(false),
  /**
   * Vide = non renseigné, pas invalide.
   *
   * Le formulaire poste toutes les lignes, y compris celles que le fournisseur
   * a décochées : sans ce `preprocess`, leur champ vide serait lu comme un
   * montant illisible et ferait échouer une saisie pourtant correcte.
   */
  prixUnitaireHt: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    montantSaisi.optional(),
  ),
  remisePct: z.coerce.number().min(0).max(100).optional().default(0),
  disponibilite: texteCourt(120),
});

export const reponseFournisseurSchema = z.object({
  lignes: z.array(ligneReponseSchema).min(1),
  /* Critères portés par le devis entier : ce sont eux qui alimentent la
     synthèse comparative, à côté du prix. */
  delaiLivraison: texteCourt(200),
  conditionsPaiement: texteCourt(200),
  garantie: texteCourt(200),
  validiteOffre: texteCourt(120),
  numeroDevis: texteCourt(80),
});

export type LigneReponse = z.infer<typeof ligneReponseSchema>;
export type ReponseFournisseur = z.infer<typeof reponseFournisseurSchema>;

/**
 * Contrôle métier que le schéma seul ne peut pas porter.
 *
 * Une ligne cochée « je chiffre » sans prix est une saisie inachevée, pas une
 * ligne à zéro : la refuser évite un devis qui paraîtrait complet et
 * remporterait le comparatif sur un prix qui n'existe pas.
 */
export function validerReponse(reponse: ReponseFournisseur): string | null {
  const chiffrees = reponse.lignes.filter((l) => l.chiffree);

  if (chiffrees.length === 0) {
    return 'Indiquez un prix pour au moins un article, sinon votre réponse ne peut pas être exploitée.';
  }

  const sansPrix = chiffrees.find(
    (l) => l.prixUnitaireHt === undefined || l.prixUnitaireHt <= 0,
  );

  if (sansPrix) {
    return 'Un article coché est sans prix : renseignez-le ou décochez la ligne.';
  }

  return null;
}
