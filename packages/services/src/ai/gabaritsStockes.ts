import { boiteGlobale } from '../cacheGlobal.js';
import { clientAdmin } from '../supabase.js';
import {
  CODES_GABARIT,
  GABARITS,
  cleGabarit,
  type CodeGabarit,
} from './gabarits.js';

/**
 * Lecture des prompts retouchés depuis /admin, avec repli sur le code.
 *
 * Même règle que les paramètres métier : la base fait autorité quand une ligne
 * existe, le code sert de repli. Un prompt illisible ne doit jamais interrompre
 * la réception ni le costing — le défaut est toujours utilisable.
 */

/** Cache court : le worker tourne en continu et doit voir vite une retouche. */
const DUREE_CACHE_MS = 60_000;

type Cache = { tenant: string; expire: number; valeurs: Map<string, string> } | null;

// Ancré sur `globalThis` : sans cela, l'invalidation faite depuis une Server
// Action ne toucherait pas l'instance que lit la page. Voir `cacheGlobal.ts`.
const boite = boiteGlobale<Cache>('gabarits', null);

/** `frais` force la relecture : l'écran d'administration ne doit jamais mentir. */
async function chargerSurcharges(
  tenant: string,
  frais = false,
): Promise<Map<string, string>> {
  const cache = boite.valeur;
  if (!frais && cache && cache.tenant === tenant && cache.expire > Date.now()) {
    return cache.valeurs;
  }

  const valeurs = new Map<string, string>();

  const { data, error } = await clientAdmin()
    .from('parametres')
    .select('cle, valeur')
    .eq('tenant_id', tenant)
    .in('cle', CODES_GABARIT.map(cleGabarit));

  if (error) {
    console.error(`[prompts] lecture impossible, défauts utilisés : ${error.message}`);
  } else {
    for (const ligne of data ?? []) {
      if (ligne.cle && ligne.valeur && ligne.valeur.trim().length > 0) {
        valeurs.set(ligne.cle, ligne.valeur);
      }
    }
  }

  boite.valeur = { tenant, expire: Date.now() + DUREE_CACHE_MS, valeurs };
  return valeurs;
}

/** Texte du gabarit en vigueur : celui de la base s'il existe, sinon celui du code. */
export async function lireGabarit(tenant: string, code: CodeGabarit): Promise<string> {
  const surcharges = await chargerSurcharges(tenant);
  return surcharges.get(cleGabarit(code)) ?? GABARITS[code].defaut;
}

/**
 * Tous les gabarits en vigueur, pour l'écran d'administration.
 *
 * `personnalise` distingue une retouche d'un défaut : c'est ce qui permet à
 * l'écran de proposer « rétablir le texte d'origine » à bon escient.
 *
 * Lecture systématiquement fraîche : c'est l'écran depuis lequel on vient
 * d'enregistrer, il doit montrer ce qui est réellement en base et non un état
 * vieux d'une minute. Le coût est d'une requête par affichage de /admin.
 */
export async function lireTousGabarits(
  tenant: string,
): Promise<{ code: CodeGabarit; texte: string; personnalise: boolean }[]> {
  const surcharges = await chargerSurcharges(tenant, true);

  return CODES_GABARIT.map((code) => {
    const surcharge = surcharges.get(cleGabarit(code));
    return {
      code,
      texte: surcharge ?? GABARITS[code].defaut,
      personnalise: surcharge !== undefined,
    };
  });
}

/** Vide le cache après une écriture depuis l'écran admin. */
export function invaliderCacheGabarits(): void {
  boite.valeur = null;
}
