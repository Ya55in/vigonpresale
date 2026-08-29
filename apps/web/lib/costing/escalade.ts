import { peutValiderCosting, type RoleApp } from '@/lib/auth/permissions';

export type DecisionValidation = {
  autorise: boolean;
  escalade: boolean;
  motif?: string;
  /** Libellé du bouton, dérivé de la décision. */
  libelleBouton: string;
};

export type Seuils = { margeMin: number; montantMax: number };

/**
 * Décide ce que l'utilisateur peut faire d'une feuille de coûts.
 *
 * Même fonction côté serveur et côté client : le client n'en tire que le
 * libellé du bouton, le serveur en tire l'autorisation. Les seuils viennent de
 * la table `parametres`, jamais d'une constante figée dans l'interface.
 */
export function decider(
  role: RoleApp,
  feuille: { marge_globale_pct: number; total_ttc: number },
  seuils: Seuils,
): DecisionValidation {
  const decision = peutValiderCosting(role, feuille, seuils);

  const libelleBouton = decision.autorise
    ? 'Valider et verrouiller'
    : decision.escalade
      ? 'Soumettre à FINANCE'
      : 'Validation non autorisée';

  return { ...decision, libelleBouton };
}

/**
 * Motif d'escalade recalculé à chaque affichage.
 *
 * La spec prévoyait une colonne `motif_escalade` ; elle n'existe pas au schéma.
 * Le recalcul est de toute façon préférable : un motif figé mentirait dès que
 * la marge ou les seuils changent.
 */
export function motifEscalade(
  feuille: { marge_globale_pct: number; total_ttc: number },
  seuils: Seuils,
): string | null {
  const motifs: string[] = [];

  if (feuille.marge_globale_pct < seuils.margeMin) {
    motifs.push(
      `Marge ${feuille.marge_globale_pct.toFixed(1)} % inférieure au seuil de ${seuils.margeMin} %`,
    );
  }
  if (feuille.total_ttc > seuils.montantMax) {
    motifs.push(
      `Montant ${feuille.total_ttc.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} supérieur au plafond de ${seuils.montantMax.toLocaleString('fr-FR')}`,
    );
  }

  return motifs.length > 0 ? motifs.join(' — ') : null;
}
