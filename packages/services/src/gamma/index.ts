import { estConfigure, optionnel, requis } from '../env.js';

export class ErreurGamma extends Error {
  constructor(
    message: string,
    readonly contexte: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ErreurGamma';
  }
}

export function gammaConfigure(): boolean {
  return estConfigure('GAMMA_API_KEY');
}

const BASE = 'https://public-api.gamma.app';

type ReponseGeneration = {
  generationId?: string;
  id?: string;
  status?: string;
  gammaUrl?: string;
  pdfUrl?: string;
  urls?: { gamma?: string; pdf?: string };
};

export type OffreGeneree = {
  generationId: string;
  gammaUrl: string | null;
  pdfUrl: string | null;
};

async function appel<T>(
  chemin: string,
  init: RequestInit,
  contexte: Record<string, unknown>,
): Promise<T> {
  const { GAMMA_API_KEY } = requis('GAMMA_API_KEY');

  let reponse: Response;
  try {
    reponse = await fetch(`${BASE}${chemin}`, {
      ...init,
      headers: {
        'X-API-KEY': GAMMA_API_KEY,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new ErreurGamma(
      `Appel Gamma impossible : ${e instanceof Error ? e.message : String(e)}`,
      contexte,
    );
  }

  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => '');
    throw new ErreurGamma(
      `Gamma a répondu ${reponse.status} : ${detail.slice(0, 300)}`,
      contexte,
    );
  }

  return (await reponse.json()) as T;
}

/**
 * Lance une génération d'offre (flux étape 9c).
 *
 * `inputText` est le BoQ déjà formaté en markdown — il ne doit contenir ni nom
 * de fournisseur, ni prix d'achat, ni taux de marge. textMode "preserve"
 * empêche Gamma de réécrire ce contenu.
 */
export async function lancerGeneration(inputText: string): Promise<string> {
  const reponse = await appel<ReponseGeneration>(
    '/v0.2/generations',
    {
      method: 'POST',
      body: JSON.stringify({
        inputText,
        textMode: 'preserve',
        format: 'document',
        themeName: optionnel('GAMMA_THEME_NAME', 'vigon-systems'),
        exportAs: 'pdf',
      }),
    },
    {},
  );

  const id = reponse.generationId ?? reponse.id;
  if (!id) throw new ErreurGamma("Gamma n'a pas renvoyé d'identifiant de génération.");
  return id;
}

/** Consulte l'état d'une génération. */
export async function consulterGeneration(id: string): Promise<{
  statut: string;
  gammaUrl: string | null;
  pdfUrl: string | null;
}> {
  const reponse = await appel<ReponseGeneration>(
    `/v0.2/generations/${id}`,
    { method: 'GET' },
    { generationId: id },
  );

  return {
    statut: (reponse.status ?? 'unknown').toLowerCase(),
    gammaUrl: reponse.gammaUrl ?? reponse.urls?.gamma ?? null,
    pdfUrl: reponse.pdfUrl ?? reponse.urls?.pdf ?? null,
  };
}

/**
 * Lance puis attend la fin de la génération.
 *
 * L'appelant doit prévoir le repli PDF local (@react-pdf/renderer) si cette
 * fonction lève : une offre ne doit jamais être bloquée par l'indisponibilité
 * d'un service tiers.
 */
export async function genererOffre(
  inputText: string,
  options: { timeoutMs?: number; intervalleMs?: number } = {},
): Promise<OffreGeneree> {
  const timeout = options.timeoutMs ?? 180_000;
  const intervalle = options.intervalleMs ?? 5_000;

  const generationId = await lancerGeneration(inputText);
  const echeance = Date.now() + timeout;

  while (Date.now() < echeance) {
    const etat = await consulterGeneration(generationId);

    if (etat.statut === 'completed' || etat.statut === 'success') {
      return { generationId, gammaUrl: etat.gammaUrl, pdfUrl: etat.pdfUrl };
    }
    if (etat.statut === 'failed' || etat.statut === 'error') {
      throw new ErreurGamma('Génération Gamma en échec.', { generationId });
    }

    await new Promise((r) => setTimeout(r, intervalle));
  }

  throw new ErreurGamma(`Génération Gamma non terminée après ${timeout} ms.`, {
    generationId,
  });
}
