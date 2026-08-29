import { estConfigure, nombreOptionnel, optionnel, requis } from '../env.js';
import { ErreurHttpChat, diagnostiquerHttp } from './openaiCompatible.js';
import { ErreurIA, type FournisseurIA } from './types.js';

/**
 * Claude (Anthropic).
 *
 * Adaptateur distinct parce que le protocole diffère de celui d'OpenAI :
 * en-tête `x-api-key` plutôt que `Authorization`, `max_tokens` obligatoire,
 * contenu renvoyé dans un tableau `content[]`, et aucun mode JSON déclaratif.
 *
 * Faute de `response_format`, la sortie structurée est obtenue en préremplissant
 * la réponse de l'assistant avec « { » : le modèle ne peut plus commencer par
 * une phrase d'introduction. L'accolade est réinjectée au retour, puisqu'elle
 * ne fait pas partie de ce que le modèle a produit.
 */

const BASE_DEFAUT = 'https://api.anthropic.com/v1';
const MODELE_DEFAUT = 'claude-sonnet-4-20250514';
const VERSION_API = '2023-06-01';

type ReponseMessages = {
  content?: { type?: string; text?: string }[];
  error?: { message?: string; type?: string };
};

export const fournisseurAnthropic: FournisseurIA = {
  nom: 'anthropic',

  modeleUtilise: () => optionnel('ANTHROPIC_MODEL', MODELE_DEFAUT),

  estConfigure: () => estConfigure('ANTHROPIC_API_KEY'),

  async completer(prompt, options) {
    const { ANTHROPIC_API_KEY } = requis('ANTHROPIC_API_KEY');
    const base = optionnel('ANTHROPIC_API_URL', BASE_DEFAUT).replace(/\/+$/, '');

    const messages: { role: 'user' | 'assistant'; content: string }[] = [
      { role: 'user', content: prompt },
    ];

    // Préremplissage : force la réponse à démarrer sur l'objet JSON.
    if (options.json) messages.push({ role: 'assistant', content: '{' });

    const reponse = await fetch(`${base}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': VERSION_API,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: optionnel('ANTHROPIC_MODEL', MODELE_DEFAUT),
        max_tokens: nombreOptionnel('ANTHROPIC_MAX_TOKENS', 8_192),
        temperature: nombreOptionnel('ANTHROPIC_TEMPERATURE', options.json ? 0.1 : 0.4),
        messages,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!reponse.ok) {
      const detail = await reponse.text().catch(() => '');
      const entete = reponse.headers.get('retry-after');
      const retryApresMs = entete ? Math.ceil(Number(entete) * 1000) : null;

      throw new ErreurHttpChat(
        reponse.status,
        `anthropic a répondu ${reponse.status} : ${detail.slice(0, 400)}`,
        Number.isFinite(retryApresMs) ? retryApresMs : null,
      );
    }

    const corps = (await reponse.json()) as ReponseMessages;
    const contenu = corps.content
      ?.filter((bloc) => bloc.type === 'text' && bloc.text)
      .map((bloc) => bloc.text)
      .join('');

    if (!contenu) {
      throw new ErreurIA("anthropic n'a renvoyé aucun contenu.", {
        erreur: corps.error?.message,
      });
    }

    // L'accolade du préremplissage vient de nous, pas du modèle : elle manque
    // dans sa réponse, il faut la remettre pour obtenir un JSON complet.
    return options.json ? `{${contenu}` : contenu;
  },

  analyserErreur: (e) => diagnostiquerHttp(e),
};
