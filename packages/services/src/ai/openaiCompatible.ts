import { estConfigure, nombreOptionnel, optionnel, requis } from '../env.js';
import { choisirModele } from './detection.js';
import { ErreurIA, type DiagnosticErreur, type FournisseurIA } from './types.js';

/**
 * Adaptateur générique pour toute API parlant le protocole OpenAI.
 *
 * La quasi-totalité des fournisseurs l'expose aujourd'hui — OpenAI, DeepSeek,
 * Mistral, Together, OpenRouter, xAI, Fireworks, Perplexity, ainsi que les
 * serveurs locaux (Ollama, vLLM, LM Studio). Un seul adaptateur paramétré les
 * couvre donc tous : changer de modèle revient à changer trois variables, pas
 * à écrire du code.
 *
 * `fetch` plutôt que le SDK openai : trois champs de la requête sont utilisés,
 * et une dépendance de plus se paierait à chaque montée de version.
 */

type ReponseChat = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string; type?: string; code?: string };
};

/** Erreur HTTP conservant le statut : indispensable pour diagnostiquer le 429. */
export class ErreurHttpChat extends Error {
  constructor(
    readonly statut: number,
    message: string,
    readonly retryApresMs: number | null,
  ) {
    super(message);
    this.name = 'ErreurHttpChat';
  }
}

export type ReglagesOpenAI = {
  /** Nom journalisé, ex. « openai ». */
  nom: string;
  /** Préfixe des variables : `OPENAI` donne OPENAI_API_KEY, OPENAI_MODEL… */
  prefixe: string;
  /** URL par défaut ; vide impose de renseigner `{PREFIXE}_API_URL`. */
  baseDefaut: string;
  /** Modèle par défaut ; vide impose de renseigner `{PREFIXE}_MODEL`. */
  modeleDefaut: string;
};

export function creerFournisseurOpenAI(reglages: ReglagesOpenAI): FournisseurIA {
  const { nom, prefixe, baseDefaut, modeleDefaut } = reglages;

  const varCle = `${prefixe}_API_KEY`;
  const varUrl = `${prefixe}_API_URL`;
  const varModele = `${prefixe}_MODEL`;
  const varTemperature = `${prefixe}_TEMPERATURE`;

  /** L'URL et le modèle sont requis quand aucun défaut n'est fourni. */
  const requises = [varCle, ...(baseDefaut ? [] : [varUrl]), ...(modeleDefaut ? [] : [varModele])];

  return {
    nom,

    modeleUtilise: () => optionnel(varModele, modeleDefaut || '(non défini)'),

    estConfigure: () => estConfigure(...requises),

    async completer(prompt, options) {
      const env = requis(...(requises as [string, ...string[]]));
      const base = optionnel(varUrl, baseDefaut).replace(/\/+$/, '');
      const modele = optionnel(varModele, modeleDefaut);

      // `response_format: json_object` est refusé par plusieurs fournisseurs si
      // le mot « json » n'apparaît pas dans les messages. On le garantit ici
      // plutôt que de dépendre de la formulation de chaque prompt.
      const promptEnvoye =
        options.json && !/json/i.test(prompt)
          ? `${prompt}\n\nRéponds uniquement avec du JSON valide.`
          : prompt;

      const reponse = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env[varCle]}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modele,
          messages: [{ role: 'user', content: promptEnvoye }],
          temperature: nombreOptionnel(varTemperature, options.json ? 0.1 : 0.4),
          ...(options.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!reponse.ok) {
        const detail = await reponse.text().catch(() => '');
        const entete = reponse.headers.get('retry-after');
        const retryApresMs = entete ? Math.ceil(Number(entete) * 1000) : null;

        throw new ErreurHttpChat(
          reponse.status,
          `${nom} a répondu ${reponse.status} : ${detail.slice(0, 400)}`,
          Number.isFinite(retryApresMs) ? retryApresMs : null,
        );
      }

      const corps = (await reponse.json()) as ReponseChat;
      const contenu = corps.choices?.[0]?.message?.content;

      if (!contenu) {
        throw new ErreurIA(`${nom} n'a renvoyé aucun contenu.`, {
          erreur: corps.error?.message,
        });
      }

      return contenu;
    },

    analyserErreur: (e) => diagnostiquerHttp(e),
  };
}

/**
 * Diagnostic commun : 429 = quota, et un dépassement journalier ne se résorbe
 * pas dans la fenêtre de réessai, contrairement à une limite par minute.
 */
export function diagnostiquerHttp(e: unknown): DiagnosticErreur {
  if (e instanceof ErreurHttpChat) {
    const quota = e.statut === 429;

    /*
     * `permanent` couvre deux familles que rejouer ne répare pas.
     *
     * Sur quota : un dépassement journalier ne se résorbe pas dans la fenêtre
     * de réessai, contrairement à une limite par minute.
     *
     * Hors quota : une clé révoquée (401/403) ou un modèle retiré du catalogue
     * (404) ne redeviendront pas valides à la tentative suivante. Groq a retiré
     * `llama-3.3-70b-versatile` le 2026-08-19 et répondait 404 à chaque appel ;
     * insister coûtait trois tentatives par fournisseur avant le secours.
     */
    const permanent = quota
      ? /per day|daily|RPD|TPD|insufficient_quota|billing/i.test(e.message)
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
}

/**
 * Fournisseur construit sur des valeurs, non sur des variables d'environnement.
 *
 * C'est ce qui permet à l'écran des clés de n'exposer qu'un emplacement : la
 * clé arrive telle quelle, le fournisseur et sa base sont déduits, et rien
 * n'oblige à déclarer où la ranger.
 *
 * AUTO-RÉPARATION DU MODÈLE. Un catalogue bouge sans prévenir : Groq a retiré
 * `llama-3.3-70b-versatile`, Google `gemini-2.0-flash`, et chaque appel
 * répondait alors 404 « model does not exist ». Plutôt que d'échouer, ce
 * fournisseur redemande le catalogue, choisit un modèle disponible et rejoue
 * l'appel — une fois. La substitution est journalisée : changer de modèle
 * change les sorties, et le découvrir six semaines plus tard dans une offre
 * serait pire que la panne.
 */
export function creerFournisseurDirect(reglages: {
  nom: string;
  cle: string;
  base: string;
  modele: string;
  /** Rappelé quand un modèle est remplacé, pour mémoriser le choix. */
  surRemplacement?: (modele: string) => void;
}): FournisseurIA {
  const { nom, cle, base, surRemplacement } = reglages;
  let modele = reglages.modele;

  const appeler = async (prompt: string, json: boolean): Promise<string> => {
    const reponse = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modele,
        messages: [{ role: 'user', content: prompt }],
        temperature: json ? 0.1 : 0.4,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!reponse.ok) {
      const detail = await reponse.text().catch(() => '');
      const entete = reponse.headers.get('retry-after');
      const retryApresMs = entete ? Math.ceil(Number(entete) * 1000) : null;

      throw new ErreurHttpChat(
        reponse.status,
        `${nom} a répondu ${reponse.status} : ${detail.slice(0, 400)}`,
        Number.isFinite(retryApresMs) ? retryApresMs : null,
      );
    }

    const corps = (await reponse.json()) as ReponseChat;
    const contenu = corps.choices?.[0]?.message?.content;

    if (!contenu) {
      throw new ErreurIA(`${nom} n'a renvoyé aucun contenu.`, {
        erreur: corps.error?.message,
      });
    }
    return contenu;
  };

  return {
    nom,
    modeleUtilise: () => modele,
    estConfigure: () => Boolean(cle),

    async completer(prompt, options) {
      // `response_format` est refusé par plusieurs fournisseurs si le mot
      // « json » n'apparaît pas dans les messages. On le garantit ici plutôt
      // que de dépendre de la formulation de chaque prompt.
      const promptEnvoye =
        options.json && !/json/i.test(prompt)
          ? `${prompt}\n\nRéponds uniquement avec du JSON valide.`
          : prompt;

      try {
        return await appeler(promptEnvoye, options.json);
      } catch (e) {
        const modeleAbsent =
          e instanceof ErreurHttpChat &&
          e.statut === 404 &&
          /model|does not exist|not found/i.test(e.message);

        if (!modeleAbsent) throw e;

        const catalogue = await fetch(`${base.replace(/\/+$/, '')}/models`, {
          headers: { Authorization: `Bearer ${cle}` },
          signal: AbortSignal.timeout(15_000),
        })
          .then((r) => (r.ok ? (r.json() as Promise<{ data?: { id?: string }[] }>) : null))
          .catch(() => null);

        const disponibles = (catalogue?.data ?? [])
          .map((m) => m.id)
          .filter((id): id is string => Boolean(id));

        if (disponibles.length === 0) throw e;

        const remplacant = choisirModele(disponibles, modele);
        if (remplacant === modele) throw e;

        console.warn(
          `[ia] ${nom} : « ${modele} » a disparu du catalogue, remplacé par « ${remplacant} ».`,
        );
        modele = remplacant;
        surRemplacement?.(remplacant);

        return appeler(promptEnvoye, options.json);
      }
    },

    analyserErreur: (e) => diagnostiquerHttp(e),
  };
}

/** OpenAI officiel. */
export const fournisseurOpenAI = creerFournisseurOpenAI({
  nom: 'openai',
  prefixe: 'OPENAI',
  baseDefaut: 'https://api.openai.com/v1',
  modeleDefaut: 'gpt-4o-mini',
});

/**
 * OpenRouter — passerelle vers des dizaines de modèles derrière une seule clé.
 *
 * Entrée dédiée plutôt que `compatible` : le modèle par défaut reprend
 * l'équivalent Llama 3.3 70B utilisé sur Groq, pour qu'activer OpenRouter en
 * secours ne change ni le comportement des prompts ni leur coût attendu.
 * `OPENROUTER_MODEL` reste libre si un autre modèle du catalogue convient
 * mieux — la liste évolue, ce défaut n'a pas vocation à suivre indéfiniment.
 */
export const fournisseurOpenRouter = creerFournisseurOpenAI({
  nom: 'openrouter',
  prefixe: 'OPENROUTER',
  baseDefaut: 'https://openrouter.ai/api/v1',
  modeleDefaut: 'meta-llama/llama-3.3-70b-instruct',
});

/**
 * Fournisseur libre : URL et modèle imposés par la configuration.
 *
 * C'est la porte de sortie quand le fournisseur voulu n'a pas d'entrée dédiée —
 * DeepSeek, Mistral, OpenRouter, un serveur local… Aucune modification de code
 * n'est nécessaire, seulement AI_API_URL, AI_API_KEY et AI_MODEL.
 */
export const fournisseurCompatible = creerFournisseurOpenAI({
  nom: 'compatible',
  prefixe: 'AI',
  baseDefaut: '',
  modeleDefaut: '',
});
