import { optionnel } from '../env.js';

/**
 * Vecteurs sémantiques, pour la recherche de fournisseurs.
 *
 * Gemini et non le fournisseur IA courant : Groq, actif sur ce projet, n'expose
 * aucune API d'embeddings. Les deux quotas sont distincts, donc un Gemini épuisé
 * côté génération reste utilisable ici — c'est vérifié, pas supposé.
 */

/**
 * Modèle courant.
 *
 * Exporté et stocké sur chaque vecteur : deux embeddings produits par des
 * modèles différents ne vivent pas dans le même espace, et les comparer donne
 * des distances qui n'ont aucun sens. C'est ce qui permet de détecter un
 * historique à recalculer après un changement.
 */
export const MODELE_EMBEDDING = 'gemini-embedding-001';

const MODELE = MODELE_EMBEDDING;

/**
 * 1536 et non 3072, le défaut du modèle.
 *
 * pgvector plafonne ivfflat et hnsw à 2000 dimensions : un vecteur plus large
 * ne serait pas indexable et chaque recherche deviendrait un balayage complet.
 * La troncature Matryoshka conserve l'essentiel du signal.
 */
export const DIMENSIONS = 1536;

const URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Coupe les textes trop longs : une désignation produit tient largement. */
const LONGUEUR_MAX = 8_000;

export class ErreurEmbedding extends Error {
  constructor(
    message: string,
    readonly statut?: number,
  ) {
    super(message);
    this.name = 'ErreurEmbedding';
  }
}

export function embeddingsConfigures(): boolean {
  return Boolean(optionnel('GEMINI_API_KEY', ''));
}

/**
 * Ramène le vecteur à la norme unitaire.
 *
 * Obligatoire en dimensions réduites : la troncature Matryoshka casse la norme
 * que le modèle garantit en 3072. Sans cette étape, la distance cosinus reste
 * juste — elle est invariante à l'échelle — mais tout passage ultérieur au
 * produit scalaire ou à la distance L2 donnerait des classements faux.
 */
function normaliser(vecteur: number[]): number[] {
  let somme = 0;
  for (const v of vecteur) somme += v * v;

  const norme = Math.sqrt(somme);
  if (norme === 0) return vecteur;

  return vecteur.map((v) => v / norme);
}

async function appeler(texte: string, cle: string): Promise<number[]> {
  const reponse = await fetch(`${URL_BASE}/${MODELE}:embedContent?key=${cle}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${MODELE}`,
      content: { parts: [{ text: texte.slice(0, LONGUEUR_MAX) }] },
      outputDimensionality: DIMENSIONS,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!reponse.ok) {
    const corps = await reponse.text().catch(() => '');
    throw new ErreurEmbedding(
      `Gemini embeddings ${reponse.status} : ${corps.slice(0, 200)}`,
      reponse.status,
    );
  }

  const donnees = (await reponse.json()) as { embedding?: { values?: number[] } };
  const valeurs = donnees.embedding?.values;

  if (!Array.isArray(valeurs) || valeurs.length !== DIMENSIONS) {
    throw new ErreurEmbedding(
      `Réponse inattendue : ${valeurs?.length ?? 0} dimensions au lieu de ${DIMENSIONS}.`,
    );
  }

  return normaliser(valeurs);
}

/** Vecteur d'un texte unique. */
export async function embedder(texte: string): Promise<number[]> {
  const cle = optionnel('GEMINI_API_KEY', '');
  if (!cle) throw new ErreurEmbedding('GEMINI_API_KEY absente.');

  const propre = texte.trim();
  if (!propre) throw new ErreurEmbedding('Texte vide.');

  return appeler(propre, cle);
}

/**
 * Vecteurs d'un lot, séquentiellement.
 *
 * Le palier gratuit de Gemini limite le débit : paralléliser déclencherait des
 * 429 sur un lot d'une trentaine de lignes, et un rattrapage interrompu à
 * mi-course laisse un historique à moitié vectorisé — donc un classement
 * silencieusement faux.
 *
 * `surErreur` reçoit les échecs sans interrompre le lot : une désignation
 * illisible ne doit pas priver les autres de leur vecteur.
 */
export async function embedderLot(
  textes: string[],
  surErreur?: (index: number, erreur: unknown) => void,
): Promise<(number[] | null)[]> {
  const resultats: (number[] | null)[] = [];

  for (const [index, texte] of textes.entries()) {
    try {
      resultats.push(await embedder(texte));
    } catch (e) {
      surErreur?.(index, e);
      resultats.push(null);
    }
  }

  return resultats;
}

/**
 * Représentation textuelle d'une ligne de devis.
 *
 * La référence est incluse : « C9200L-48P-4G-E » n'a pas de sens sémantique
 * propre, mais un fournisseur qui cote des références Cisco se rapproche des
 * besoins qui en mentionnent. La marque est répétée pour la même raison.
 */
export function texteLigneDevis(params: {
  designation: string;
  reference?: string | null;
  marque?: string | null;
}): string {
  return [params.designation, params.reference, params.marque]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(' · ');
}
