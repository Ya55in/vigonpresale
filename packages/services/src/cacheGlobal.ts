/**
 * Ancrage des caches de module sur `globalThis`.
 *
 * Next bundle les Server Components et les Server Actions dans deux graphes
 * distincts : un même fichier y est instancié DEUX FOIS, avec deux jeux de
 * variables de module. Un cache déclaré en portée de module est donc invisible
 * d'un graphe à l'autre — vider celui de l'action ne vide pas celui que lit la
 * page, qui continue d'afficher l'ancienne valeur jusqu'à expiration.
 *
 * Le symptôme est trompeur : l'écran affiche « enregistré » puis remontre l'état
 * d'avant, y compris après rechargement. On ancre donc les caches sur
 * `globalThis`, partagé par tous les graphes du même processus.
 *
 * Sans effet sur le worker, qui n'a qu'un seul graphe — mais sans coût non plus.
 */

/** Boîte partagée : un conteneur par clé, créé à la première demande. */
export function boiteGlobale<T>(cle: string, valeurInitiale: T): { valeur: T } {
  const registre = globalThis as typeof globalThis & {
    __vigonCaches?: Map<string, { valeur: unknown }>;
  };

  registre.__vigonCaches ??= new Map();

  const existante = registre.__vigonCaches.get(cle);
  if (existante) return existante as { valeur: T };

  const creee = { valeur: valeurInitiale };
  registre.__vigonCaches.set(cle, creee);
  return creee;
}
