import { estConfigure, nombreOptionnel, optionnel, requis } from '../env.js';
import { ErreurIA, type DiagnosticErreur, type FournisseurIA } from './types.js';

/**
 * Groq expose une API compatible OpenAI : un simple fetch suffit, inutile
 * d'ajouter le SDK openai pour trois champs.
 */
const BASE_DEFAUT = 'https://api.groq.com/openai/v1';
const MODELE_DEFAUT = 'llama-3.3-70b-versatile';

type ReponseChat = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; type?: string; code?: string };
};

/** Erreur HTTP conservant le statut : indispensable pour diagnostiquer le 429. */
class ErreurHttpGroq extends Error {
  constructor(
    readonly statut: number,
    message: string,
    readonly retryApresMs: number | null,
  ) {
    super(message);
    this.name = 'ErreurHttpGroq';
  }
}

export const fournisseurGroq: FournisseurIA = {
  nom: 'groq',

  modeleUtilise: () => optionnel('GROQ_MODEL', MODELE_DEFAUT),

  estConfigure: () => estConfigure('GROQ_API_KEY'),

  async completer(prompt, options) {
    const { GROQ_API_KEY } = requis('GROQ_API_KEY');
    const base = optionnel('GROQ_API_URL', BASE_DEFAUT);

    // response_format json_object est refusé (400) si le mot « json » n'apparaît
    // pas dans les messages. On le garantit ici plutôt que de compter sur la
    // formulation de chaque prompt.
    const promptEnvoye =
      options.json && !/json/i.test(prompt)
        ? `${prompt}\n\nRéponds uniquement avec du JSON valide.`
        : prompt;

    const reponse = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: optionnel('GROQ_MODEL', MODELE_DEFAUT),
        messages: [{ role: 'user', content: promptEnvoye }],
        temperature: nombreOptionnel('GROQ_TEMPERATURE', options.json ? 0.1 : 0.4),
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!reponse.ok) {
      const detail = await reponse.text().catch(() => '');
      // Groq indique l'attente en secondes, parfois fractionnaires.
      const entete = reponse.headers.get('retry-after');
      const retryApresMs = entete ? Math.ceil(Number(entete) * 1000) : null;

      throw new ErreurHttpGroq(
        reponse.status,
        `Groq a répondu ${reponse.status} : ${detail.slice(0, 400)}`,
        Number.isFinite(retryApresMs) ? retryApresMs : null,
      );
    }

    const corps = (await reponse.json()) as ReponseChat;
    const contenu = corps.choices?.[0]?.message?.content;

    if (!contenu) {
      throw new ErreurIA("Groq n'a renvoyé aucun contenu.", {
        erreur: corps.error?.message,
      });
    }

    return contenu;
  },

  analyserErreur(e): DiagnosticErreur {
    if (e instanceof ErreurHttpGroq) {
      const quota = e.statut === 429;

      /*
       * Deux familles que rejouer ne répare pas.
       *
       * Sur quota : un dépassement journalier ne se résorbe pas dans la fenêtre
       * de réessai, contrairement à la limite par minute.
       *
       * Hors quota : clé révoquée (401/403) ou modèle retiré (404). Groq a
       * retiré `llama-3.3-70b-versatile` le 2026-08-19 — trois tentatives
       * identiques étaient perdues avant que le secours ne prenne la main.
       */
      const permanent = quota
        ? /per day|daily|RPD|TPD/i.test(e.message)
        : e.statut === 401 ||
          e.statut === 403 ||
          (e.statut === 404 && /model|does not exist|no longer/i.test(e.message));

      const secondes = e.message.match(/try again in (\d+(?:\.\d+)?)s/i);
      const delaiMs =
        e.retryApresMs ??
        (secondes?.[1] ? Math.ceil(Number(secondes[1]) * 1000) : 2_000);

      return { quota, permanent, delaiMs };
    }

    const message = e instanceof Error ? e.message : String(e);
    const quota = /rate limit|429|quota/i.test(message);
    return { quota, permanent: false, delaiMs: 2_000 };
  },
};

export type ModeleGroq = { id: string; proprietaire: string };

/** Liste les modèles réellement disponibles sur la clé (script de test). */
export async function listerModelesGroq(): Promise<ModeleGroq[]> {
  const { GROQ_API_KEY } = requis('GROQ_API_KEY');
  const base = optionnel('GROQ_API_URL', BASE_DEFAUT);

  const reponse = await fetch(`${base}/models`, {
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!reponse.ok) {
    throw new ErreurIA(`Liste des modèles Groq indisponible (${reponse.status}).`);
  }

  const corps = (await reponse.json()) as {
    data?: { id?: string; owned_by?: string }[];
  };

  return (corps.data ?? [])
    .filter((m): m is { id: string; owned_by?: string } => Boolean(m.id))
    .map((m) => ({ id: m.id, proprietaire: m.owned_by ?? 'inconnu' }));
}
