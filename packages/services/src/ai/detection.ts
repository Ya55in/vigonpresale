import { ErreurIA } from './types.js';

/**
 * Reconnaît le fournisseur à partir de la clé, sans qu'on ait à le déclarer.
 *
 * POURQUOI CE MODULE EXISTE
 *
 * L'écran des clés a compté jusqu'à douze emplacements : un par fournisseur,
 * plus son modèle, plus le trio d'une API tierce. Le 2026-08-19 une clé OpenAI
 * s'est retrouvée dans l'emplacement Groq — la plateforme appelait api.groq.com
 * avec une clé `sk-` et recevait « Invalid API Key », message qui accuse le
 * fournisseur quand le tort est à l'emplacement.
 *
 * Le défaut n'était pas la clé mal rangée : c'était de DEMANDER de la ranger.
 * Une clé porte déjà son émetteur dans son préfixe. Deux emplacements suffisent
 * donc — un principal, un secours — et la plateforme déduit le reste.
 *
 * Gemini garde son emplacement à part : il n'est pas là comme modèle de
 * conversation mais comme source des vecteurs de la recherche sémantique, qui
 * n'en a pas d'autre. Mélanger les deux rôles ferait perdre la recherche le
 * jour où l'on change de modèle de conversation.
 */

export type NomFournisseur =
  | 'openai'
  | 'openrouter'
  | 'anthropic'
  | 'groq'
  | 'gemini'
  | 'compatible';

export type Signature = {
  nom: NomFournisseur;
  /** Base compatible OpenAI ; `null` quand le fournisseur a son propre SDK. */
  base: string | null;
  /** Modèle retenu tant qu'aucun n'est imposé ni découvert. */
  modeleDefaut: string;
};

/**
 * Signatures reconnues, dans un ordre qui compte.
 *
 * `sk-or-v1-` et `sk-ant-` doivent précéder `sk-` : les trois commencent
 * pareil, et tester le motif générique en premier attribuerait toute clé à
 * OpenAI. C'est le genre d'ordre qu'une relecture distraite inverse.
 */
const SIGNATURES: { motif: RegExp; signature: Signature }[] = [
  {
    motif: /^sk-or-v1-/i,
    signature: {
      nom: 'openrouter',
      base: 'https://openrouter.ai/api/v1',
      modeleDefaut: 'meta-llama/llama-3.3-70b-instruct',
    },
  },
  {
    motif: /^sk-ant-/i,
    signature: { nom: 'anthropic', base: null, modeleDefaut: 'claude-sonnet-4-20250514' },
  },
  {
    motif: /^gsk_/i,
    signature: {
      nom: 'groq',
      base: 'https://api.groq.com/openai/v1',
      modeleDefaut: 'llama-3.3-70b-versatile',
    },
  },
  {
    // `AIza` est le format historique, `AQ.` celui des clés récentes.
    motif: /^(AIza|AQ\.)/,
    signature: { nom: 'gemini', base: null, modeleDefaut: 'gemini-flash-latest' },
  },
  {
    // En dernier : tout ce qui commence par `sk-` sans autre marqueur. OpenAI
    // l'emploie, mais aussi DeepSeek et plusieurs passerelles — d'où la
    // vérification par appel quand le doute subsiste.
    motif: /^sk-/i,
    signature: {
      nom: 'openai',
      base: 'https://api.openai.com/v1',
      modeleDefaut: 'gpt-4o-mini',
    },
  },
];

/** Bases interrogées quand un `sk-` ne dit pas de qui il vient. */
const BASES_AMBIGUES: { nom: NomFournisseur; base: string; modeleDefaut: string }[] = [
  { nom: 'openai', base: 'https://api.openai.com/v1', modeleDefaut: 'gpt-4o-mini' },
  {
    nom: 'openrouter',
    base: 'https://openrouter.ai/api/v1',
    modeleDefaut: 'meta-llama/llama-3.3-70b-instruct',
  },
  { nom: 'compatible', base: 'https://api.deepseek.com/v1', modeleDefaut: 'deepseek-chat' },
];

/**
 * Fournisseur déduit du seul préfixe.
 *
 * Suffit dans l'immense majorité des cas et ne coûte aucun appel réseau. Rend
 * `null` quand la clé ne ressemble à rien de connu — l'appelant tranchera par
 * `identifier()`, qui interroge les API.
 */
export function detecterParPrefixe(cle: string): Signature | null {
  const propre = cle.trim();
  for (const { motif, signature } of SIGNATURES) {
    if (motif.test(propre)) return signature;
  }
  return null;
}

/** Réponse minimale de `/models`, commune aux API compatibles OpenAI. */
type ReponseModeles = { data?: { id?: string }[] };

/**
 * Demande à une base compatible OpenAI si elle reconnaît la clé.
 *
 * `/models` est le seul point qu'exposent tous ces fournisseurs sans facturer
 * ni produire d'effet de bord — le bon endroit pour poser la question.
 */
async function baseAccepte(base: string, cle: string): Promise<string[] | null> {
  try {
    const reponse = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${cle}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!reponse.ok) return null;

    const corps = (await reponse.json()) as ReponseModeles;
    return (corps.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id));
  } catch {
    return null;
  }
}

export type Identification = Signature & {
  /** Modèles annoncés par le fournisseur, quand il sait les lister. */
  modeles: string[];
  /** Vrai quand un appel réseau a confirmé la clé. */
  confirme: boolean;
};

/**
 * Identifie le fournisseur, en interrogeant les API si le préfixe ne suffit pas.
 *
 * Le résultat est mis en cache par l'appelant : cette fonction fait du réseau et
 * n'a aucune raison d'être rappelée à chaque génération.
 */
export async function identifier(cle: string): Promise<Identification> {
  const propre = cle.trim();
  if (!propre) throw new ErreurIA('Clé IA vide.');

  const parPrefixe = detecterParPrefixe(propre);

  // Fournisseurs à SDK propre : le préfixe est sans ambiguïté, et leur
  // catalogue ne s'interroge pas de la même façon.
  if (parPrefixe && parPrefixe.base === null) {
    return { ...parPrefixe, modeles: [], confirme: false };
  }

  /*
   * Un préfixe distinctif désigne son émetteur sans ambiguïté possible :
   * `sk-or-v1-` OpenRouter, `gsk_` Groq, `sk-proj-` et `sk-svcacct-` OpenAI.
   * On lui fait confiance, en profitant de l'appel pour récupérer le catalogue
   * — c'est lui qui permettra de choisir un modèle qui existe vraiment.
   *
   * Seul un `sk-` nu reste ambigu : OpenAI l'emploie, mais aussi DeepSeek et
   * plusieurs passerelles.
   */
  const ambigu = /^sk-/i.test(propre) && !/^sk-(or-v1|ant|proj|svcacct)-/i.test(propre);

  if (!ambigu) {
    const modeles = await baseAccepte(parPrefixe!.base!, propre);
    return { ...parPrefixe!, modeles: modeles ?? [], confirme: modeles !== null };
  }

  /*
   * Cas ambigu : un `sk-` nu. On demande aux candidats lequel reconnaît la
   * clé, en commençant par le plus probable. C'est ce qui permet de coller
   * n'importe quelle clé sans avoir à savoir d'où elle vient.
   */
  const candidats = parPrefixe
    ? [
        BASES_AMBIGUES.find((b) => b.nom === parPrefixe.nom) ?? BASES_AMBIGUES[0]!,
        ...BASES_AMBIGUES.filter((b) => b.nom !== parPrefixe.nom),
      ]
    : BASES_AMBIGUES;

  for (const candidat of candidats) {
    const modeles = await baseAccepte(candidat.base, propre);
    if (modeles === null) continue;

    return {
      nom: candidat.nom,
      base: candidat.base,
      modeleDefaut: candidat.modeleDefaut,
      modeles,
      confirme: true,
    };
  }

  if (parPrefixe) {
    // Aucune base n'a confirmé — réseau coupé, ou fournisseur inhabituel. On
    // garde la déduction du préfixe plutôt que d'échouer : l'appel réel dira.
    return { ...parPrefixe, modeles: [], confirme: false };
  }

  throw new ErreurIA(
    `Clé IA non reconnue (commence par « ${propre.slice(0, 6)}… »). ` +
      'Renseigner l’URL de l’API dans IA_URL_PRINCIPALE si le fournisseur est ' +
      'compatible OpenAI mais inconnu de la plateforme.',
  );
}

/**
 * Choisit un modèle de conversation dans un catalogue.
 *
 * Le tri écarte d'abord ce qui ne sait pas dialoguer — embeddings, audio,
 * images, modération. Ce filtre par le nom est imparfait mais c'est tout ce
 * qu'offrent ces API : aucune n'expose la capacité en clair.
 *
 * Vient ensuite l'ordre de préférence, qui privilégie les modèles bon marché et
 * fiables en sortie structurée. Les prompts de la plateforme exigent du JSON
 * valide : un modèle brillant mais bavard y est moins utile qu'un modèle
 * modeste qui respecte le format.
 */
export function choisirModele(modeles: string[], defaut: string): string {
  const utilisables = modeles.filter(
    (id) =>
      !/embed|whisper|tts|audio|image|dall|moderation|rerank|guard|vision-only/i.test(id),
  );

  if (utilisables.length === 0) return defaut;
  if (utilisables.includes(defaut)) return defaut;

  const preferences = [
    /gpt-4o-mini/i,
    /gpt-4\.1-mini/i,
    /gpt-4o/i,
    /llama-3\.3-70b/i,
    /llama-3\.1-70b/i,
    /qwen.*(72b|32b)/i,
    /mixtral-8x7b/i,
    /deepseek-chat/i,
    /claude.*(sonnet|haiku)/i,
    /gemini.*flash/i,
  ];

  for (const preference of preferences) {
    const trouve = utilisables.find((id) => preference.test(id));
    if (trouve) return trouve;
  }

  // Rien de connu : le premier utilisable vaut mieux qu'un défaut qui n'existe
  // pas chez ce fournisseur — c'est précisément le 404 qu'on veut éviter.
  return utilisables[0]!;
}
