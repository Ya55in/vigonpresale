import { LANGUE_DEFAUT, NOM_LANGUE_POUR_PROMPT, type Langue } from '@vigon/shared';

import { appliquerGabarit } from './gabarits.js';
import { lireGabarit } from './gabaritsStockes.js';

/**
 * Tous les prompts du flux métier, assemblés depuis les gabarits.
 *
 * Règle inchangée : le modèle ne produit que des DONNÉES structurées. Aucune
 * mise en forme HTML ne lui est demandée — elle est assemblée par du TypeScript
 * déterministe, pour que le rendu ne dépende jamais de ses sauts de ligne.
 *
 * Le texte des prompts vit désormais dans `gabarits.ts` et peut être retouché
 * depuis /admin. Ces fonctions ne font plus que fournir les valeurs des
 * variables : elles sont donc asynchrones, puisqu'elles lisent la base.
 */

/** Flux étape 2 — extraction des spécifications techniques. */
export async function promptSpecifications(
  tenant: string,
  contenuConsolide: string,
): Promise<string> {
  return appliquerGabarit(await lireGabarit(tenant, 'specifications'), {
    contenu: contenuConsolide,
  });
}

/** Flux étape 4 — rédaction d'une demande de devis fournisseur. */
export async function promptRfq(
  tenant: string,
  params: {
    marque: string;
    nomFournisseur: string;
    articles: { designation: string; reference: string | null; quantite: number }[];
    /** Langue de correspondance du fournisseur ; français par défaut. */
    langue?: Langue;
  },
): Promise<string> {
  const liste = params.articles
    .map(
      (a) =>
        `- ${a.quantite} x ${a.designation}${a.reference ? ` (référence ${a.reference})` : ''}`,
    )
    .join('\n');

  return appliquerGabarit(await lireGabarit(tenant, 'rfq'), {
    marque: params.marque,
    nomFournisseur: params.nomFournisseur,
    articles: liste,
    langue: NOM_LANGUE_POUR_PROMPT[params.langue ?? LANGUE_DEFAUT],
  });
}

/** Flux étape 7 — classification d'un message fournisseur entrant. */
export async function promptClassification(
  tenant: string,
  contenu: string,
): Promise<string> {
  return appliquerGabarit(await lireGabarit(tenant, 'classification'), { contenu });
}

/** Flux étape 7 — extraction des lignes d'un devis fournisseur. */
export async function promptExtractionDevis(
  tenant: string,
  contenu: string,
): Promise<string> {
  return appliquerGabarit(await lireGabarit(tenant, 'extraction_devis'), { contenu });
}

/** Flux étape 9a — description commerciale d'un produit. */
export async function promptDescriptionProduit(
  tenant: string,
  params: {
    designation: string;
    marque: string;
    reference: string | null;
    specifications: string | null;
  },
): Promise<string> {
  return appliquerGabarit(await lireGabarit(tenant, 'description_produit'), {
    designation: params.designation,
    marque: params.marque,
    reference: params.reference ?? 'non précisée',
    specifications: params.specifications ?? 'non précisées',
  });
}

/** Flux étape 9b — synthèse de la solution proposée. */
export async function promptSyntheseOffre(
  tenant: string,
  params: {
    titreProjet: string;
    produits: { designation: string; quantite: number }[];
  },
): Promise<string> {
  const liste = params.produits
    .map((p) => `- ${p.quantite} x ${p.designation}`)
    .join('\n');

  return appliquerGabarit(await lireGabarit(tenant, 'synthese_offre'), {
    titreProjet: params.titreProjet,
    produits: liste,
  });
}

/** Flux étape 3b — extraction d'un contact fournisseur depuis une page web. */
export async function promptSourcingFournisseur(
  tenant: string,
  params: { marque: string; contenuWeb: string },
): Promise<string> {
  return appliquerGabarit(await lireGabarit(tenant, 'sourcing_fournisseur'), {
    marque: params.marque,
    contenu: params.contenuWeb,
  });
}
