/**
 * Initiales proposées à partir d'un nom d'entreprise.
 *
 * Vit dans `shared` et non dans `services` parce que les deux côtés en ont
 * besoin : le formulaire la propose pendant la saisie, et le serveur peut la
 * réutiliser. `services` tirant imapflow et googleapis, l'importer depuis un
 * composant client chargerait tout cela dans le navigateur — et la dupliquer
 * ouvrirait la porte à deux règles qui divergent, comme l'échappement HTML
 * avant qu'on ne le mutualise.
 *
 * Jamais appliquée d'office : « Medina Networks » et « Maroc Numérique »
 * donnent tous deux « MN ». Une génération automatique produirait des
 * collisions qu'aucun écran ne signalerait — l'interface propose, un humain
 * tranche.
 */

/** Mots outils, français et anglais : les deux langues de correspondance. */
const PARTICULES = new Set([
  'de',
  'du',
  'des',
  'da',
  'le',
  'la',
  'les',
  'et',
  'and',
  'of',
  'the',
  'for',
]);

export function initialesSuggerees(nom: string): string {
  const tous = nom
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((m) => m.length > 0);

  if (tous.length === 0) return '';

  // Les particules ne portent pas de sens : « Société Générale de Distribution
  // Informatique » se lit SGDI, pas SGDD. Sans ce filtre, le « de » consomme
  // une place et évince le mot qui distingue réellement l'entreprise.
  const mots = tous.filter((m) => !PARTICULES.has(m.toLowerCase()));

  // Un nom entièrement composé de particules est improbable, mais retomber sur
  // une chaîne vide le serait davantage.
  const retenus = mots.length > 0 ? mots : tous;

  // Un seul mot : ses trois premières lettres se lisent mieux qu'une seule.
  if (retenus.length === 1) return (retenus[0] ?? '').slice(0, 3).toUpperCase();

  return retenus
    .slice(0, 4)
    .map((m) => m[0] ?? '')
    .join('')
    .toUpperCase();
}
