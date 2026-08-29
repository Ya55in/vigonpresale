/**
 * Accès typé aux variables d'environnement des services externes.
 *
 * Aucun service n'est instancié au chargement du module : chaque client lit sa
 * configuration à l'appel. Une clé absente doit produire un message explicite,
 * jamais un `undefined` qui remonte en erreur réseau incompréhensible.
 */

export class ConfigurationManquante extends Error {
  constructor(readonly variables: string[]) {
    super(`Variable(s) d'environnement requise(s) : ${variables.join(', ')}`);
    this.name = 'ConfigurationManquante';
  }
}

/**
 * Valeurs venant de la base, qui priment sur l'environnement.
 *
 * Alimentées par `chargerSecrets()`. La lecture reste synchrone : les appelants
 * — clients HTTP, jobs — ne peuvent pas devenir asynchrones pour aller chercher
 * une clé, c'est le chargement qui est asynchrone, pas la consultation.
 */
let surcharges = new Map<string, string>();

/**
 * Remplace les surcharges d'un bloc, sans jamais laisser la table vide.
 *
 * La version précédente vidait la table PUIS la remplissait. Entre les deux,
 * `lire()` ne trouvait rien et retombait sur l'environnement — où ces clés
 * n'existent justement pas, puisqu'elles viennent de la base.
 *
 * Sans concurrence, l'intervalle est trop court pour se voir. La préparation
 * des consultations traite les marques en parallèle : plusieurs appels
 * rechargeaient les secrets en même temps, et l'un lisait pendant que l'autre
 * avait vidé. Le 2026-08-19, cela donnait « Variable(s) requise(s) :
 * OPENAI_API_KEY » sur une clé pourtant bien enregistrée — une panne
 * intermittente, donc du pire genre à diagnostiquer.
 *
 * La nouvelle table est construite à part puis substituée d'un coup. Un lecteur
 * voit l'ancienne ou la nouvelle, jamais un état intermédiaire.
 */
export function definirSurcharges(valeurs: Record<string, string>): void {
  const suivante = new Map<string, string>();
  for (const [nom, valeur] of Object.entries(valeurs)) {
    if (valeur && valeur.trim()) suivante.set(nom, valeur.trim());
  }
  surcharges = suivante;
}

export function viderSurcharges(): void {
  surcharges = new Map();
}

function lire(nom: string): string | null {
  const surcharge = surcharges.get(nom);
  if (surcharge) return surcharge;

  const valeur = process.env[nom];
  return valeur && valeur.trim() ? valeur.trim() : null;
}

/** Récupère les variables demandées ou lève une erreur nommant les manquantes. */
export function requis<const T extends readonly string[]>(
  ...noms: T
): Record<T[number], string> {
  const manquantes: string[] = [];
  const sortie = {} as Record<T[number], string>;

  for (const nom of noms) {
    const valeur = lire(nom);
    if (!valeur) manquantes.push(nom);
    else sortie[nom as T[number]] = valeur;
  }

  if (manquantes.length > 0) throw new ConfigurationManquante(manquantes);
  return sortie;
}

/** Vrai si toutes les variables sont renseignées — sert au script de test. */
export function estConfigure(...noms: string[]): boolean {
  return noms.every((nom) => lire(nom) !== null);
}

export function optionnel(nom: string, defaut: string): string {
  return lire(nom) ?? defaut;
}

export function nombreOptionnel(nom: string, defaut: number): number {
  const valeur = lire(nom);
  if (!valeur) return defaut;
  const n = Number(valeur);
  return Number.isFinite(n) ? n : defaut;
}
