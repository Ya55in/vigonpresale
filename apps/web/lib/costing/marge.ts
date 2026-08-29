/**
 * Conversion entre les deux modes de calcul de la marge.
 *
 * Les colonnes `prix_vente_ht` et `total_ligne_ht` sont GENERATED ALWAYS AS en
 * base, sur la formule du markup : (achat + coûts) × (1 + marge_pct/100).
 * L'application ne peut donc pas changer la formule — et la règle absolue n°5
 * interdit de recalculer un prix côté application.
 *
 * Le mode « marge brute » est donc obtenu en convertissant le taux saisi en son
 * équivalent markup AVANT écriture. `mode_calcul` sur la feuille garde la trace
 * du mode choisi, pour réafficher à l'utilisateur le taux qu'il a saisi.
 */

export type ModeCalcul = 'markup' | 'marge';

/**
 * Marge brute -> markup.
 *
 * marge brute : (PV - PA) / PV     markup : (PV - PA) / PA
 * d'où markup = marge / (1 - marge)
 *
 * Une marge brute de 100 % est impossible (elle supposerait un coût nul) :
 * on borne pour éviter une division par zéro.
 */
export function margeVersMarkup(margePct: number): number {
  if (margePct <= 0) return margePct;
  const borne = Math.min(margePct, 99);
  return (borne / (100 - borne)) * 100;
}

/** Markup -> marge brute, pour réafficher le taux dans le mode choisi. */
export function markupVersMarge(markupPct: number): number {
  if (markupPct <= 0) return markupPct;
  return (markupPct / (100 + markupPct)) * 100;
}

/** Taux à écrire dans `marge_pct` selon le mode retenu. */
export function tauxAStocker(saisi: number, mode: ModeCalcul): number {
  return mode === 'marge' ? margeVersMarkup(saisi) : saisi;
}

/** Taux à afficher à l'utilisateur, depuis la valeur stockée. */
export function tauxAAfficher(stocke: number, mode: ModeCalcul): number {
  return mode === 'marge' ? markupVersMarge(stocke) : stocke;
}

export const LIBELLE_MODE: Record<ModeCalcul, string> = {
  markup: 'Markup sur coût — (PV − PA) / PA',
  marge: 'Marge brute — (PV − PA) / PV',
};
