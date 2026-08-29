import { estConfigure, optionnel, requis } from '../env.js';

export class ErreurFirecrawl extends Error {
  constructor(
    message: string,
    readonly contexte: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ErreurFirecrawl';
  }
}

export function firecrawlConfigure(): boolean {
  return estConfigure('FIRECRAWL_API_KEY');
}

export type ResultatRecherche = {
  url: string;
  titre: string;
  description: string;
  /** Contenu markdown de la page, si demandé au scraping. */
  contenu: string | null;
};

async function appel<T>(
  chemin: string,
  corps: unknown,
  contexte: Record<string, unknown>,
): Promise<T> {
  const { FIRECRAWL_API_KEY } = requis('FIRECRAWL_API_KEY');
  const base = optionnel('FIRECRAWL_API_URL', 'https://api.firecrawl.dev');

  let reponse: Response;
  try {
    reponse = await fetch(`${base}${chemin}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new ErreurFirecrawl(
      `Appel Firecrawl impossible : ${e instanceof Error ? e.message : String(e)}`,
      contexte,
    );
  }

  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => '');
    throw new ErreurFirecrawl(
      `Firecrawl a répondu ${reponse.status} : ${detail.slice(0, 300)}`,
      contexte,
    );
  }

  return (await reponse.json()) as T;
}

type ReponseRecherche = {
  success?: boolean;
  data?: {
    url?: string;
    title?: string;
    description?: string;
    markdown?: string;
  }[];
};

/**
 * Recherche web (flux étape 3b : sourcing fournisseur, étape 9a : photos).
 *
 * `scraper` demande le markdown des pages trouvées — nécessaire pour en
 * extraire un contact, inutile (et coûteux) pour un simple listing d'URL.
 */
export async function rechercher(
  requete: string,
  options: { limite?: number; scraper?: boolean } = {},
): Promise<ResultatRecherche[]> {
  const corps: Record<string, unknown> = {
    query: requete,
    limit: options.limite ?? 5,
  };
  if (options.scraper) {
    corps.scrapeOptions = { formats: ['markdown'], onlyMainContent: true };
  }

  const reponse = await appel<ReponseRecherche>('/v1/search', corps, { requete });

  return (reponse.data ?? [])
    .filter((r): r is { url: string } & typeof r => Boolean(r.url))
    .map((r) => ({
      url: r.url,
      titre: r.title ?? '',
      description: r.description ?? '',
      contenu: r.markdown ?? null,
    }));
}

type ReponseScrape = {
  success?: boolean;
  data?: { markdown?: string; html?: string };
};

/** Récupère le contenu markdown d'une URL précise. */
export async function scraper(url: string): Promise<string | null> {
  const reponse = await appel<ReponseScrape>(
    '/v1/scrape',
    { url, formats: ['markdown'], onlyMainContent: true },
    { url },
  );
  return reponse.data?.markdown ?? null;
}
