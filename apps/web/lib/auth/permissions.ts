export type RoleApp = 'admin' | 'presale' | 'finance' | 'after_sales';

export const PERMISSIONS = {
  admin: ['*'],

  presale: [
    'demande.voir',
    'demande.creer',
    'demande.modifier',
    'demande.assigner',
    'article.voir',
    'article.modifier',
    'article.valider',
    // Absente de la matrice d'origine : sans elle, /opportunites retombait sur
    // demande.voir, que FINANCE possède, et devenait accessible par URL directe
    // alors que la sidebar le masquait.
    'opportunite.voir',
    'fournisseur.voir',
    'fournisseur.creer',
    'fournisseur.modifier',
    'consultation.voir',
    'consultation.creer',
    'consultation.modifier',
    'consultation.envoyer',
    'consultation.planifier',
    'consultation.relancer',
    'devis.voir',
    'devis.valider',
    'devis.modifier',
    'costing.voir',
    'costing.creer',
    'costing.modifier',
    'costing.soumettre',
    'costing.valider',
    'costing.verrouiller',
    'marge.definir',
    'marge.valider',
    'prix_achat.voir',
    'offre.voir',
    'offre.generer',
    'offre.modifier',
    'offre.previsualiser',
    'offre.envoyer',
    'client.voir',
    'client.creer',
    'client.modifier',
    'dashboard.presale',
    // Le bon de commande matérialise l'accord du client, et c'est l'avant-vente
    // qui est en face de lui : lui refuser l'émission bloquerait le flux chaque
    // fois que la finance n'est pas disponible.
    'document.voir',
    'document.emettre',
  ],

  finance: [
    'demande.voir',
    'devis.voir',
    'costing.voir',
    'costing.modifier',
    'costing.valider',
    'costing.verrouiller',
    'costing.reviser',
    'marge.voir',
    'marge.valider',
    'marge.definir_seuils',
    'prix_achat.voir',
    'offre.voir',
    'dashboard.finance',
    'rapport.financier',
    'export.financier',
    'document.voir',
    'document.emettre',
    // Constater un règlement engage la comptabilité : c'est le seul acte de ce
    // module que l'avant-vente ne partage pas.
    'document.regler',
  ],

  after_sales: [
    'demande.voir_gagnees',
    'offre.voir_approuvees',
    'client.voir',
    'dashboard.apres_vente',
    'livraison.voir',
    'livraison.modifier',
  ],
} as const;

export type Permission = (typeof PERMISSIONS)[RoleApp][number];

/**
 * Détermine si l'utilisateur peut valider et verrouiller un costing.
 *
 * PRESALE valide de façon autonome tant que la marge et le montant
 * restent dans les seuils. Au-delà, l'escalade vers FINANCE est imposée.
 *
 * À appeler côté serveur AVANT toute action de validation,
 * et côté client uniquement pour adapter le libellé du bouton.
 */
export function peutValiderCosting(
  role: RoleApp,
  costSheet: { marge_globale_pct: number; total_ttc: number },
  seuils: { margeMin: number; montantMax: number },
): { autorise: boolean; escalade: boolean; motif?: string } {
  if (role === 'admin' || role === 'finance') {
    return { autorise: true, escalade: false };
  }

  if (role !== 'presale') {
    return { autorise: false, escalade: false, motif: 'Rôle non autorisé' };
  }

  const motifs: string[] = [];

  if (costSheet.marge_globale_pct < seuils.margeMin) {
    motifs.push(
      `Marge ${costSheet.marge_globale_pct.toFixed(1)} % inférieure au seuil de ${seuils.margeMin} %`,
    );
  }
  if (costSheet.total_ttc > seuils.montantMax) {
    motifs.push(
      `Montant ${costSheet.total_ttc.toFixed(2)} supérieur au plafond de ${seuils.montantMax}`,
    );
  }

  if (motifs.length > 0) {
    return { autorise: false, escalade: true, motif: motifs.join(' — ') };
  }

  return { autorise: true, escalade: false };
}

/** Vérifie qu'un rôle possède une permission (admin = toutes). */
export function roleHasPermission(
  role: RoleApp,
  permission: string,
): boolean {
  const list = PERMISSIONS[role];
  if ((list as readonly string[]).includes('*')) {
    return true;
  }
  return (list as readonly string[]).includes(permission);
}

/*
 * `CHAMPS_INTERDITS` a été retiré le 2026-08-25.
 *
 * Cette table listait les colonnes qu'un rôle ne devait pas voir « dans les
 * réponses API ». Aucune API REST n'a jamais existé ici — tout passe par des
 * Server Components — et RIEN ne la lisait : ni garde, ni filtre, ni écran.
 *
 * Une constante de sécurité que personne n'applique est pire qu'absente : elle
 * se lit comme une protection en place. Le cloisonnement réel tient à
 * l'inverse, et il est plus sûr — chaque requête nomme ses colonnes, donc
 * l'écran après-vente ne demande jamais un prix d'achat plutôt que de le
 * demander puis de l'effacer.
 */
