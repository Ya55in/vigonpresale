import { DEFAUTS_METIER } from '@vigon/shared';

import { boiteGlobale } from './cacheGlobal.js';
import { nombreOptionnel, optionnel } from './env.js';
import { clientAdmin } from './supabase.js';

/**
 * Paramètres métier, lus depuis la table `parametres`.
 *
 * Ordre de priorité : base > variable d'environnement > défaut du code. La base
 * est la source de vérité — c'est là que FINANCE ajuste les seuils sans
 * redéploiement — mais l'absence d'une ligne ne doit jamais bloquer un job.
 */

export type ParametresMetier = {
  margeDefautPct: number;
  tvaPct: number;
  delaiRelanceHeures: number;
  maxRelances: number;
  delaiExpirationOffreJours: number;
  delaiRelanceClientJours: number;
  seuilValidationFinanceMontant: number;
  seuilValidationFinanceMargeMin: number;
};

/** Correspondance clé en base -> champ, avec la variable d'env de repli. */
const CORRESPONDANCES: {
  champ: keyof ParametresMetier;
  cle: string;
  env: string;
  defaut: number;
}[] = [
  {
    champ: 'margeDefautPct',
    cle: 'marge_defaut_pct',
    env: 'MARGE_DEFAUT_PCT',
    defaut: DEFAUTS_METIER.margeDefautPct,
  },
  { champ: 'tvaPct', cle: 'tva_pct', env: 'TVA_PCT', defaut: DEFAUTS_METIER.tvaPct },
  {
    champ: 'delaiRelanceHeures',
    cle: 'delai_relance_heures',
    env: 'DELAI_RELANCE_HEURES',
    defaut: DEFAUTS_METIER.delaiRelanceHeures,
  },
  {
    champ: 'maxRelances',
    cle: 'max_relances',
    env: 'MAX_RELANCES',
    defaut: DEFAUTS_METIER.maxRelances,
  },
  {
    champ: 'delaiExpirationOffreJours',
    cle: 'delai_expiration_offre',
    env: 'DELAI_EXPIRATION_OFFRE_JOURS',
    defaut: DEFAUTS_METIER.delaiExpirationOffreJours,
  },
  {
    champ: 'delaiRelanceClientJours',
    cle: 'delai_relance_client_jours',
    env: 'DELAI_RELANCE_CLIENT_JOURS',
    defaut: DEFAUTS_METIER.delaiRelanceClientJours,
  },
  {
    champ: 'seuilValidationFinanceMontant',
    cle: 'seuil_validation_finance_montant',
    env: 'SEUIL_VALIDATION_FINANCE_MONTANT',
    defaut: DEFAUTS_METIER.seuilValidationFinanceMontant,
  },
  {
    champ: 'seuilValidationFinanceMargeMin',
    cle: 'seuil_validation_finance_marge_min',
    env: 'SEUIL_VALIDATION_FINANCE_MARGE_MIN',
    defaut: DEFAUTS_METIER.seuilValidationFinanceMargeMin,
  },
];

/** Cache court : un worker tourne en continu, il doit voir un changement vite. */
const DUREE_CACHE_MS = 60_000;

type Cache = { valeurs: ParametresMetier; expire: number; tenant: string } | null;

// Ancré sur `globalThis` : Next instancie ce module deux fois (graphe des
// Server Components, graphe des Server Actions). Sans cet ancrage,
// `invaliderCacheParametres()` appelé depuis /admin viderait un cache que la
// page ne lit pas, et l'écran remontrerait l'ancienne valeur une minute durant.
const boite = boiteGlobale<Cache>('parametres', null);

export async function lireParametres(tenant: string): Promise<ParametresMetier> {
  const cache = boite.valeur;
  if (cache && cache.tenant === tenant && cache.expire > Date.now()) {
    return cache.valeurs;
  }

  const enBase = new Map<string, string>();

  const { data, error } = await clientAdmin()
    .from('parametres')
    .select('cle, valeur')
    .eq('tenant_id', tenant);

  if (error) {
    // On continue sur les replis : un paramètre illisible ne doit pas
    // interrompre les relances ni la réception.
    console.error(`[parametres] lecture impossible, replis utilisés : ${error.message}`);
  } else {
    for (const ligne of data ?? []) {
      if (ligne.cle && ligne.valeur !== null) enBase.set(ligne.cle, ligne.valeur);
    }
  }

  const valeurs = {} as ParametresMetier;

  for (const { champ, cle, env, defaut } of CORRESPONDANCES) {
    const brut = enBase.get(cle);
    const depuisBase = brut === undefined ? Number.NaN : Number(brut);

    valeurs[champ] = Number.isFinite(depuisBase)
      ? depuisBase
      : nombreOptionnel(env, defaut);
  }

  boite.valeur = { valeurs, expire: Date.now() + DUREE_CACHE_MS, tenant };
  return valeurs;
}

/** Vide le cache : utile après une écriture de paramètre depuis l'écran admin. */
export function invaliderCacheParametres(): void {
  boite.valeur = null;
}

/* ------------------------------------------------------------------------- */
/* Conditions commerciales de l'offre                                         */
/* ------------------------------------------------------------------------- */

export type ConditionsOffre = {
  livraison: string;
  paiement: string;
  garantie: string;
};

/** Textes de repli, repris de la spec initiale. */
export const CONDITIONS_OFFRE_DEFAUT: ConditionsOffre = {
  livraison: 'Selon délais indiqués par produit, à compter de la commande.',
  paiement: '30 jours fin de mois.',
  garantie: 'Garantie constructeur, 12 mois minimum.',
};

export const CLES_CONDITIONS: Record<keyof ConditionsOffre, string> = {
  livraison: 'offre_condition_livraison',
  paiement: 'offre_condition_paiement',
  garantie: 'offre_condition_garantie',
};

/**
 * Conditions commerciales figurant au pied de chaque offre.
 *
 * Elles étaient codées en dur dans le générateur d'offre. Les sortir en base
 * permet de les faire évoluer sans redéploiement — un délai de paiement se
 * renégocie plus souvent qu'on ne livre une version.
 *
 * Elles sont gelées dans `source_json` au moment de la génération : changer une
 * condition ne réécrit jamais une offre déjà partie chez un client.
 */
export async function lireConditionsOffre(tenant: string): Promise<ConditionsOffre> {
  const { data, error } = await clientAdmin()
    .from('parametres')
    .select('cle, valeur')
    .eq('tenant_id', tenant)
    .in('cle', Object.values(CLES_CONDITIONS));

  if (error) {
    console.error(`[conditions] lecture impossible, défauts utilisés : ${error.message}`);
    return { ...CONDITIONS_OFFRE_DEFAUT };
  }

  const enBase = new Map((data ?? []).map((l) => [l.cle, l.valeur]));

  const lire = (champ: keyof ConditionsOffre): string => {
    const valeur = enBase.get(CLES_CONDITIONS[champ]);
    return valeur && valeur.trim().length > 0
      ? valeur.trim()
      : CONDITIONS_OFFRE_DEFAUT[champ];
  };

  return {
    livraison: lire('livraison'),
    paiement: lire('paiement'),
    garantie: lire('garantie'),
  };
}

/** Lit un paramètre booléen (workflow), avec repli. */
export async function lireDrapeau(
  tenant: string,
  cle: string,
  defaut: boolean,
): Promise<boolean> {
  const { data } = await clientAdmin()
    .from('parametres')
    .select('valeur')
    .eq('tenant_id', tenant)
    .eq('cle', cle)
    .maybeSingle();

  if (!data?.valeur) return optionnel(cle.toUpperCase(), String(defaut)) === 'true';
  return data.valeur.trim().toLowerCase() === 'true';
}
