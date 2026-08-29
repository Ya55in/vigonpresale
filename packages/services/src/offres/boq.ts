/**
 * Construction du Bill of Quantities envoyé à Gamma (flux étape 9b).
 *
 * INTERDICTION ABSOLUE : le BoQ ne contient jamais le nom d'un fournisseur, un
 * prix d'achat ni un taux de marge. La fonction `verifierAnonymisation` en fait
 * une garantie vérifiée, pas une intention — elle est appelée avant tout envoi
 * vers un service externe.
 */

export type ProduitBoq = {
  designation: string;
  reference: string | null;
  marque: string;
  imageUrl: string | null;
  descriptionTechnique: string | null;
  pointsCles: string[];
  quantite: number;
  prixUnitaireHt: number;
  totalHt: number;
};

export type Boq = {
  client: { nom: string; logoUrl: string | null; contact: string | null };
  referenceOffre: string;
  date: string;
  validite: string;
  solution: {
    titre: string;
    resume: string;
    tableauExplicatif: { besoin: string; solutionProposee: string; benefice: string }[];
  };
  produits: ProduitBoq[];
  totaux: {
    totalHt: number;
    tvaPct: number;
    totalTva: number;
    totalTtc: number;
    devise: string;
  };
  conditions: { livraison: string; paiement: string; garantie: string };
  /**
   * Articles de la demande que cette offre ne couvre pas.
   *
   * Une offre est bâtie sur le devis d'un seul fournisseur ; celui-ci n'a pas
   * toujours chiffré tout le besoin. Taire les manques laisserait croire à une
   * réponse complète et fausserait la comparaison entre offres — on les nomme.
   *
   * Calculés en TypeScript par différence entre la demande et la feuille de
   * coûts : le modèle ne les invente pas.
   */
  articlesNonProposes?: { designation: string; reference: string | null; quantite: number }[];
};

export class FuiteDonneesInternes extends Error {
  constructor(readonly termes: string[]) {
    super(
      `Le BoQ contient des données internes interdites : ${termes.join(', ')}. ` +
        'Génération interrompue.',
    );
    this.name = 'FuiteDonneesInternes';
  }
}

/**
 * Vérifie qu'aucune donnée interne n'a fui dans le BoQ.
 *
 * Deux familles de contrôle :
 *  - des termes révélateurs (« prix d'achat », « marge », « fournisseur ») que
 *    le modèle pourrait glisser dans une description ou une synthèse ;
 *  - les noms de fournisseurs réellement impliqués, passés par l'appelant.
 *
 * Une correspondance interrompt la génération : il vaut mieux une offre non
 * produite qu'une offre révélant les prix d'achat au client.
 */
export function verifierAnonymisation(
  boq: Boq,
  nomsFournisseurs: string[],
): void {
  // On n'inspecte que le texte libre : les nombres des totaux sont légitimes.
  const texte = [
    boq.solution.titre,
    boq.solution.resume,
    ...boq.solution.tableauExplicatif.flatMap((l) => [
      l.besoin,
      l.solutionProposee,
      l.benefice,
    ]),
    ...boq.produits.flatMap((p) => [
      p.designation,
      p.descriptionTechnique ?? '',
      ...p.pointsCles,
    ]),
    boq.conditions.livraison,
    boq.conditions.paiement,
    boq.conditions.garantie,
  ]
    .join(' \n ')
    .toLowerCase();

  const trouves: string[] = [];

  const termesInterdits = [
    "prix d'achat",
    'prix d achat',
    'prix achat',
    'taux de marge',
    'marge brute',
    'markup',
    'coût d\'achat',
    'cout d achat',
    'notre fournisseur',
    'le fournisseur',
    'distributeur officiel',
  ];

  for (const terme of termesInterdits) {
    if (texte.includes(terme)) trouves.push(terme);
  }

  for (const nom of nomsFournisseurs) {
    const normalise = nom.trim().toLowerCase();
    // Les noms très courts produiraient des faux positifs ; la marque, elle,
    // est légitime dans une offre — seul le distributeur doit disparaître.
    if (normalise.length < 4) continue;
    if (texte.includes(normalise)) trouves.push(nom);
  }

  if (trouves.length > 0) throw new FuiteDonneesInternes([...new Set(trouves)]);
}

const montant = (valeur: number, devise: string): string =>
  `${valeur.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`;

/**
 * Rend le BoQ en markdown structuré pour Gamma.
 *
 * `textMode: "preserve"` empêche Gamma de réécrire ce contenu : la structure
 * ci-dessous est donc celle du document final, elle est produite par du
 * TypeScript déterministe et jamais par le modèle.
 */
export function boqVersMarkdown(boq: Boq): string {
  const { devise } = boq.totaux;
  const morceaux: string[] = [];

  morceaux.push(`# ${boq.solution.titre}`);
  morceaux.push('');
  morceaux.push(`**Référence de l'offre :** ${boq.referenceOffre}  `);
  morceaux.push(`**Client :** ${boq.client.nom}  `);
  if (boq.client.contact) morceaux.push(`**Interlocuteur :** ${boq.client.contact}  `);
  morceaux.push(`**Date :** ${boq.date}  `);
  morceaux.push(`**Validité :** ${boq.validite}`);
  morceaux.push('');
  morceaux.push('---');
  morceaux.push('');

  morceaux.push('## Synthèse de la solution');
  morceaux.push('');
  morceaux.push(boq.solution.resume);
  morceaux.push('');

  if (boq.solution.tableauExplicatif.length > 0) {
    morceaux.push('| Besoin | Solution proposée | Bénéfice |');
    morceaux.push('| --- | --- | --- |');
    for (const ligne of boq.solution.tableauExplicatif) {
      morceaux.push(
        `| ${ligne.besoin} | ${ligne.solutionProposee} | ${ligne.benefice} |`,
      );
    }
    morceaux.push('');
  }

  morceaux.push('---');
  morceaux.push('');
  morceaux.push('## Matériel proposé');
  morceaux.push('');

  for (const [index, produit] of boq.produits.entries()) {
    morceaux.push(`### ${index + 1}. ${produit.designation}`);
    morceaux.push('');
    if (produit.imageUrl) {
      morceaux.push(`![${produit.designation}](${produit.imageUrl})`);
      morceaux.push('');
    }
    morceaux.push(`**Marque :** ${produit.marque}  `);
    if (produit.reference) morceaux.push(`**Référence :** ${produit.reference}  `);
    morceaux.push(`**Quantité :** ${produit.quantite}`);
    morceaux.push('');

    if (produit.descriptionTechnique) {
      morceaux.push(produit.descriptionTechnique);
      morceaux.push('');
    }
    if (produit.pointsCles.length > 0) {
      for (const point of produit.pointsCles) morceaux.push(`- ${point}`);
      morceaux.push('');
    }

    morceaux.push(
      `**Prix unitaire HT :** ${montant(produit.prixUnitaireHt, devise)} — ` +
        `**Total HT :** ${montant(produit.totalHt, devise)}`,
    );
    morceaux.push('');
  }

  morceaux.push('---');
  morceaux.push('');
  morceaux.push('## Récapitulatif financier');
  morceaux.push('');
  morceaux.push('| | Montant |');
  morceaux.push('| --- | --- |');
  morceaux.push(`| Total HT | ${montant(boq.totaux.totalHt, devise)} |`);
  morceaux.push(
    `| TVA ${boq.totaux.tvaPct} % | ${montant(boq.totaux.totalTva, devise)} |`,
  );
  morceaux.push(`| **Total TTC** | **${montant(boq.totaux.totalTtc, devise)}** |`);
  morceaux.push('');

  // Placé avant les conditions et après les montants : le lecteur doit voir ce
  // que le total ne couvre pas au moment même où il en prend connaissance.
  if (boq.articlesNonProposes && boq.articlesNonProposes.length > 0) {
    morceaux.push('## Articles non couverts par cette proposition');
    morceaux.push('');
    for (const a of boq.articlesNonProposes) {
      const reference = a.reference ? ` (réf. ${a.reference})` : '';
      morceaux.push(`- ${a.quantite} × ${a.designation}${reference}`);
    }
    morceaux.push('');
    morceaux.push(
      'Ces éléments ne figurent pas dans les montants ci-dessus. ' +
        'Nous pouvons les chiffrer séparément sur demande.',
    );
    morceaux.push('');
  }

  morceaux.push('## Conditions');
  morceaux.push('');
  morceaux.push(`- **Livraison :** ${boq.conditions.livraison}`);
  morceaux.push(`- **Paiement :** ${boq.conditions.paiement}`);
  morceaux.push(`- **Garantie :** ${boq.conditions.garantie}`);
  morceaux.push('');

  return morceaux.join('\n');
}
