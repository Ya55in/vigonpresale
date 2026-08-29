import { GoogleGenerativeAI } from '@google/generative-ai';

import { estConfigure, nombreOptionnel, optionnel, requis } from '../env.js';
import type { DiagnosticErreur, FournisseurIA } from './types.js';

/**
 * Alias plutôt qu'une version figée, et c'est un choix.
 *
 * `gemini-2.0-flash` était le défaut jusqu'au 2026-08-19, jour où Google l'a
 * retiré : chaque appel répondait 404 « no longer available ». Un défaut épinglé
 * périme sans prévenir, et le jour où il périme la plateforme s'arrête.
 *
 * `gemini-flash-latest` suit le catalogue. La contrepartie est réelle — le
 * modèle peut changer sous les pieds, donc les sorties aussi — mais elle est
 * préférable ici : Gemini est un secours et l'indexeur de la recherche
 * sémantique, deux rôles où la disponibilité prime sur la reproductibilité.
 * `GEMINI_MODEL` reste là pour épingler une version quand ce compromis ne
 * convient pas.
 */
const MODELE_DEFAUT = 'gemini-flash-latest';

export const fournisseurGemini: FournisseurIA = {
  nom: 'gemini',

  modeleUtilise: () => optionnel('GEMINI_MODEL', MODELE_DEFAUT),

  estConfigure: () => estConfigure('GEMINI_API_KEY'),

  async completer(prompt, options) {
    const { GEMINI_API_KEY } = requis('GEMINI_API_KEY');

    const client = new GoogleGenerativeAI(GEMINI_API_KEY).getGenerativeModel({
      model: optionnel('GEMINI_MODEL', MODELE_DEFAUT),
      generationConfig: {
        // Supprime les ```json et le bavardage autour de la réponse.
        ...(options.json ? { responseMimeType: 'application/json' } : {}),
        temperature: nombreOptionnel(
          'GEMINI_TEMPERATURE',
          options.json ? 0.1 : 0.4,
        ),
      },
    });

    const reponse = await client.generateContent(prompt);
    return reponse.response.text();
  },

  analyserErreur(e): DiagnosticErreur {
    const message = e instanceof Error ? e.message : String(e);
    const quota = /\[429|RESOURCE_EXHAUSTED|Too Many Requests|quota/i.test(message);

    // « limit: 0 » = aucune allocation sur le projet Google : réessayer est vain.
    const permanent = quota && /limit:\s*0\b/i.test(message);

    const retry = message.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
    const delaiMs = retry?.[1] ? Math.ceil(Number(retry[1]) * 1000) : 2_000;

    return { quota, permanent, delaiMs };
  },
};
