import type { z } from 'zod';

import { optionnel } from '../env.js';
import { chargerSecrets } from '../secrets.js';
import { tenantId } from '../supabase.js';
import { fournisseurAnthropic } from './anthropic.js';
import { choisirModele, identifier } from './detection.js';
import { fournisseurGemini } from './gemini.js';
import { fournisseurGroq } from './groq.js';
import {
  creerFournisseurDirect,
  fournisseurCompatible,
  fournisseurOpenAI,
  fournisseurOpenRouter,
} from './openaiCompatible.js';
import {
  ErreurIA,
  ErreurQuotaIA,
  type FournisseurIA,
} from './types.js';

export { ErreurIA, ErreurQuotaIA, type FournisseurIA } from './types.js';
export { listerModelesGroq, type ModeleGroq } from './groq.js';
export {
  creerFournisseurOpenAI,
  type ReglagesOpenAI,
} from './openaiCompatible.js';

/**
 * Fournisseurs reconnus par `AI_PROVIDER`.
 *
 * `compatible` est la porte de sortie : n'importe quelle API parlant le
 * protocole OpenAI (DeepSeek, Mistral, OpenRouter, Ollama, vLLM…) fonctionne en
 * renseignant AI_API_URL, AI_API_KEY et AI_MODEL, sans toucher au code.
 *
 * Les prompts et la validation zod sont communs à tous : changer de modèle ne
 * change ni les consignes envoyées, ni les garanties sur ce qui revient.
 */
const FOURNISSEURS: Record<string, FournisseurIA> = {
  anthropic: fournisseurAnthropic,
  claude: fournisseurAnthropic,
  compatible: fournisseurCompatible,
  gemini: fournisseurGemini,
  groq: fournisseurGroq,
  openai: fournisseurOpenAI,
  openrouter: fournisseurOpenRouter,
};

/** Fournisseurs acceptés par `AI_PROVIDER`, pour les messages d'aide. */
export const NOMS_FOURNISSEURS = Object.keys(FOURNISSEURS);

/**
 * Fournisseur actif, choisi par AI_PROVIDER.
 *
 * À défaut, on prend le premier fournisseur configuré : le développement reste
 * possible dès qu'une seule clé est renseignée, sans variable supplémentaire.
 */
export function fournisseurActif(): FournisseurIA {
  const demande = optionnel('AI_PROVIDER', '').toLowerCase();

  if (demande) {
    const choisi = FOURNISSEURS[demande];
    if (!choisi) {
      throw new ErreurIA(
        `AI_PROVIDER inconnu : « ${demande} ». Valeurs acceptées : ${Object.keys(FOURNISSEURS).join(', ')}.`,
      );
    }
    return choisi;
  }

  // Dédoublonné : `claude` et `anthropic` désignent le même adaptateur, et le
  // détecter deux fois n'apporte rien.
  const configure = [...new Set(Object.values(FOURNISSEURS))].find((f) =>
    f.estConfigure(),
  );

  if (!configure) {
    throw new ErreurIA(
      'Aucun fournisseur IA configuré. Renseigner une clé parmi ' +
        'ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, GEMINI_API_KEY — ' +
        'ou AI_API_URL + AI_API_KEY + AI_MODEL pour toute API compatible OpenAI.',
    );
  }
  return configure;
}

export function iaConfiguree(): boolean {
  try {
    return fournisseurActif().estConfigure();
  } catch {
    return false;
  }
}

/**
 * Chaîne de fournisseurs : le principal, puis les secours.
 *
 * `AI_PROVIDER_SECOURS` accepte une liste séparée par des virgules, essayée
 * dans l'ordre. Sans elle, tout fournisseur configuré autre que le principal
 * fait office de secours — parce qu'une clé renseignée n'a pas d'autre raison
 * d'être là, et qu'exiger une variable de plus ferait échouer l'application
 * alors qu'une solution était disponible.
 *
 * Seuls les fournisseurs RÉELLEMENT configurés entrent dans la chaîne : un
 * secours sans clé produirait une erreur de configuration au moment précis où
 * l'on cherche à en sortir, et masquerait la panne d'origine.
 *
 * L'ordre est déterministe et le principal reste toujours premier : le secours
 * est un filet, pas une répartition de charge. Basculer silencieusement de
 * modèle à chaque appel rendrait les sorties irreproductibles.
 */
export function chaineFournisseurs(): FournisseurIA[] {
  // Deux clés renseignées suffisent : le fournisseur est déduit de chacune, et
  // l'ancien mécanisme par `AI_PROVIDER` n'a plus à être consulté.
  if (chaineCourante) return chaineCourante;

  const principal = fournisseurActif();
  const chaine = [principal];

  const declares = optionnel('AI_PROVIDER_SECOURS', '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);

  const candidats = declares.length
    ? declares.map((nom) => {
        const f = FOURNISSEURS[nom];
        if (!f) {
          throw new ErreurIA(
            `AI_PROVIDER_SECOURS contient « ${nom} », inconnu. ` +
              `Valeurs acceptées : ${Object.keys(FOURNISSEURS).join(', ')}.`,
          );
        }
        return f;
      })
    : [...new Set(Object.values(FOURNISSEURS))];

  for (const candidat of candidats) {
    if (chaine.includes(candidat)) continue;
    if (!candidat.estConfigure()) continue;
    chaine.push(candidat);
  }

  return chaine;
}

/**
 * Nom et modèle du fournisseur actif, suivi des secours disponibles.
 *
 * Les secours sont nommés : c'est la seule façon de voir depuis l'écran
 * d'administration qu'un repli existe, avant d'en avoir besoin.
 */
export function descriptionIA(): string {
  const [principal, ...secours] = chaineFournisseurs();
  const tete = `${principal!.nom} · ${principal!.modeleUtilise()}`;

  if (secours.length === 0) return `${tete} (aucun secours)`;
  return `${tete} — secours : ${secours.map((f) => f.nom).join(', ')}`;
}

/**
 * Retire un éventuel encadrement ```json que le modèle ajoute malgré le mode
 * JSON, et isole le premier objet/tableau du texte.
 */
function isolerJson(brut: string): string {
  let texte = brut.trim();

  const fence = texte.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) texte = fence[1].trim();

  const debut = texte.search(/[[{]/);
  if (debut === -1) return texte;

  const ouvrant = texte[debut];
  const fermant = ouvrant === '{' ? '}' : ']';
  const fin = texte.lastIndexOf(fermant);

  return fin > debut ? texte.slice(debut, fin + 1) : texte.slice(debut);
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Garantit que les clés stockées en base sont visibles avant tout appel.
 *
 * LE BUG QUE CECI SUPPRIME : les clés gérées depuis `/admin` vivent dans la
 * table `parametres`, pas dans l'environnement. `estConfigure()` les ignore
 * tant que `chargerSecrets()` n'a pas tourné — donc un fournisseur parfaitement
 * configuré était **absent de la chaîne**, sans le moindre message.
 *
 * Constaté le 2026-08-19 : la clé OpenRouter était en base, le worker la voyait
 * (il charge les secrets à chaque cycle), mais la préparation des consultations
 * non. La chaîne y valait `groq → gemini` au lieu de `groq → gemini →
 * openrouter`, et les deux premiers étant morts, tout échouait — alors que le
 * secours qui aurait sauvé l'appel était configuré.
 *
 * Six fichiers appelaient l'IA sans charger les secrets. Les corriger un par un
 * aurait laissé le septième réintroduire le défaut : c'est donc la couche IA
 * qui garantit sa propre configuration, une fois pour toutes.
 *
 * IMPORTS STATIQUES, ET C'EST ESSENTIEL. Une première version les faisait en
 * dynamique, par prudence contre un cycle qui n'existe pas — ni `secrets.ts` ni
 * `supabase.ts` ne dépendent de cette couche. Sous tsx, le spécificateur
 * dynamique se résolvait vers une AUTRE instance du module d'environnement :
 * `chargerSecrets` remplissait une table de surcharges, et `requis()` en lisait
 * une seconde, restée vide. La trace était sans appel — la clé était visible
 * juste après le chargement, et introuvable trois lignes plus loin.
 *
 * L'échec reste avalé : base injoignable ou tenant introuvable ne doit pas
 * empêcher un appel qui fonctionnerait avec les seules variables
 * d'environnement.
 */
async function assurerSecrets(): Promise<void> {
  try {
    // Le cache interne borne le coût à une requête par minute.
    await chargerSecrets(await tenantId());
  } catch (e) {
    console.warn(
      `[ia] clés de la base non chargées, on s'en tient à l'environnement : ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

/* ------------------------------------------------------------------------- */
/* Chaîne déduite des clés, sans emplacement à choisir                        */
/* ------------------------------------------------------------------------- */

/**
 * Fournisseurs construits à partir des deux clés, mis en cache par clé.
 *
 * L'identification peut coûter un appel réseau — on ne la refait pas à chaque
 * génération. La clé sert d'identifiant de cache : la remplacer dans `/admin`
 * produit une entrée neuve, donc une redétection, sans redémarrage.
 */
const cacheFournisseurs = new Map<string, FournisseurIA>();

/** Modèles retenus après auto-réparation, pour ne pas la refaire à chaque appel. */
const modelesMemorises = new Map<string, string>();

async function fournisseurDepuisCle(
  cle: string,
  role: 'principal' | 'alternatif',
): Promise<FournisseurIA | null> {
  const propre = cle.trim();
  if (!propre) return null;

  const enCache = cacheFournisseurs.get(propre);
  if (enCache) return enCache;

  let identite;
  try {
    identite = await identifier(propre);
  } catch (e) {
    console.warn(
      `[ia] clé ${role} non identifiée : ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }

  const modeleImpose = optionnel(
    role === 'principal' ? 'IA_MODELE_PRINCIPAL' : 'IA_MODELE_ALTERNATIF',
    '',
  );

  /*
   * Anthropic et Gemini ont leur propre SDK : on réutilise leur adaptateur en
   * posant la clé là où il la lit, plutôt que de réécrire deux clients HTTP.
   * `process.env` et non les surcharges — celles-ci sont remplacées d'un bloc
   * à chaque `chargerSecrets`, ce qui effacerait la valeur posée ici.
   */
  if (identite.base === null) {
    if (identite.nom === 'anthropic') {
      process.env.ANTHROPIC_API_KEY = propre;
      if (modeleImpose) process.env.ANTHROPIC_MODEL = modeleImpose;
      cacheFournisseurs.set(propre, fournisseurAnthropic);
      return fournisseurAnthropic;
    }
    process.env.GEMINI_API_KEY = propre;
    if (modeleImpose) process.env.GEMINI_MODEL = modeleImpose;
    cacheFournisseurs.set(propre, fournisseurGemini);
    return fournisseurGemini;
  }

  const base = optionnel(
    role === 'principal' ? 'IA_URL_PRINCIPALE' : 'IA_URL_ALTERNATIVE',
    identite.base,
  );

  const modele =
    modeleImpose ||
    modelesMemorises.get(propre) ||
    (identite.modeles.length > 0
      ? choisirModele(identite.modeles, identite.modeleDefaut)
      : identite.modeleDefaut);

  const fournisseur = creerFournisseurDirect({
    nom: identite.nom,
    cle: propre,
    base,
    modele,
    surRemplacement: (m) => modelesMemorises.set(propre, m),
  });

  cacheFournisseurs.set(propre, fournisseur);
  return fournisseur;
}

/** Chaîne courante, recalculée à chaque chargement de clés. */
let chaineCourante: FournisseurIA[] | null = null;

/**
 * Construit la chaîne à partir des deux emplacements de clé.
 *
 * Rend `null` quand aucun des deux n'est renseigné : l'appelant retombe alors
 * sur l'ancien mécanisme par `AI_PROVIDER`, ce qui évite de casser une
 * installation configurée avant ce changement.
 *
 * EXPORTÉE pour les appelants qui veulent CONNAÎTRE la chaîne sans s'en servir :
 * la ligne de démarrage du worker, le harnais de secours. Sans elle,
 * `chaineFournisseurs()` retombe sur `AI_PROVIDER` tant qu'aucune génération
 * n'a eu lieu, et annonce une configuration qui n'est pas celle qui servira —
 * « openai, aucun secours » là où la plateforme utilise openrouter puis openai.
 *
 * Appeler `chargerSecrets` AVANT : les deux clés vivent dans `/admin`.
 */
export async function assurerChaine(): Promise<FournisseurIA[] | null> {
  const principale = optionnel('IA_CLE_PRINCIPALE', '');
  const alternative = optionnel('IA_CLE_ALTERNATIVE', '');

  if (!principale && !alternative) {
    chaineCourante = null;
    return null;
  }

  const construits = await Promise.all([
    fournisseurDepuisCle(principale, 'principal'),
    fournisseurDepuisCle(alternative, 'alternatif'),
  ]);

  const chaine = construits.filter((f): f is FournisseurIA => f !== null);
  chaineCourante = chaine.length > 0 ? chaine : null;
  return chaineCourante;
}

export type OptionsGeneration = {
  /** Nombre total de tentatives par fournisseur (la 1re incluse). */
  tentatives?: number;
  /** Contexte métier joint aux logs d'erreur. */
  contexte?: Record<string, unknown>;
  /** Force un fournisseur unique, sans aucun secours. */
  fournisseur?: FournisseurIA;
  /**
   * Impose la chaîne au lieu de la déduire de la configuration.
   *
   * Existe pour les harnais : éprouver la bascule demande des fournisseurs qui
   * tombent à la demande, ce qu'aucune clé réelle ne permet de provoquer.
   */
  chaine?: FournisseurIA[];
};

/**
 * Un seul fournisseur, avec ses tentatives de correction.
 *
 * Extrait de `genererJson` pour que la boucle de secours reste lisible : le
 * réessai corrige une sortie mal formée par le MÊME modèle, le secours change
 * de modèle. Mélanger les deux dans une boucle unique rendait indistinguables
 * « ce modèle bafouille » et « ce fournisseur est tombé ».
 */
async function tenterAvec<T extends z.ZodTypeAny>(
  fournisseur: FournisseurIA,
  prompt: string,
  schema: T,
  tentativesMax: number,
  contexte: Record<string, unknown>,
): Promise<z.infer<T>> {
  let derniereErreur: unknown = null;
  let promptCourant = prompt;

  for (let tentative = 1; tentative <= tentativesMax; tentative += 1) {
    let brut = '';
    try {
      brut = await fournisseur.completer(promptCourant, { json: true });
    } catch (e) {
      derniereErreur = e;
      const { quota, permanent, delaiMs } = fournisseur.analyserErreur(e);

      if (quota) {
        const detail = e instanceof Error ? e.message.split('\n')[0] : String(e);
        // Quota structurellement épuisé : insister sur CE fournisseur ne sert à
        // rien, on remonte pour laisser la chaîne passer au suivant.
        if (permanent) {
          throw new ErreurQuotaIA(
            `Quota ${fournisseur.nom} indisponible — vérifier le plan et la facturation. ${detail}`,
            true,
            contexte,
          );
        }
        if (tentative < tentativesMax) await attendre(delaiMs);
        continue;
      }

      /*
       * Panne définitive hors quota : clé révoquée, modèle retiré du catalogue.
       *
       * Rejouer le MÊME appel trois fois ne peut pas donner autre chose — le
       * modèle n'existera pas davantage à la troisième tentative. Mesuré le
       * 2026-08-19 : Groq répondait 404 « model does not exist » et Gemini 404
       * « model no longer available », soit six appels perdus et 8,5 s avant
       * que le secours ne prenne la main sur chaque extraction.
       *
       * On remonte donc immédiatement pour laisser la chaîne changer de
       * fournisseur, ce qui est la seule action qui puisse aboutir.
       */
      if (permanent) {
        throw new ErreurIA(
          `${fournisseur.nom} définitivement indisponible : ${
            e instanceof Error ? e.message.split('\n')[0] : String(e)
          }`,
          contexte,
        );
      }

      if (tentative < tentativesMax) await attendre(1_000);
      continue;
    }

    let parse: unknown;
    try {
      parse = JSON.parse(isolerJson(brut));
    } catch (e) {
      derniereErreur = e;
      promptCourant = `${prompt}\n\nTa réponse précédente n'était pas du JSON valide. Réponds UNIQUEMENT avec un objet JSON, sans texte autour.`;
      continue;
    }

    const resultat = schema.safeParse(parse);
    if (resultat.success) return resultat.data;

    derniereErreur = resultat.error;
    const details = resultat.error.issues
      .map((i) => `- ${i.path.join('.') || '(racine)'} : ${i.message}`)
      .join('\n');
    promptCourant = `${prompt}\n\nTa réponse précédente ne respectait pas le format attendu :\n${details}\n\nCorrige-la et réponds UNIQUEMENT avec le JSON valide.`;
  }

  const message =
    derniereErreur instanceof Error ? derniereErreur.message : String(derniereErreur);
  throw new ErreurIA(
    `Sortie ${fournisseur.nom} invalide après ${tentativesMax} tentative(s) : ${message}`,
    contexte,
  );
}

/**
 * Appelle l'IA et valide la sortie contre un schéma zod.
 *
 * Ne fait jamais confiance au modèle : le JSON est isolé, parsé dans un
 * try/catch puis validé. En cas d'échec, on retente en réinjectant l'erreur de
 * validation dans le prompt — c'est ce qui redresse la plupart des sorties mal
 * formées.
 *
 * SECOURS : si le fournisseur principal échoue de bout en bout — panne, quota
 * épuisé, sorties inexploitables — les suivants de la chaîne sont essayés. Une
 * clé tombée ne doit pas arrêter la plateforme : les demandes continuent
 * d'entrer, les devis d'être lus.
 *
 * Le repli est journalisé en avertissement, jamais silencieux. Une dégradation
 * qu'on ne voit pas devient un état permanent : on découvre trois semaines plus
 * tard qu'on paie un fournisseur de secours pendant que le principal est mort.
 *
 * `options.fournisseur` court-circuite la chaîne : un appelant qui nomme son
 * fournisseur a une raison de le faire, et lui en substituer un autre
 * trahirait sa demande.
 */
export async function genererJson<T extends z.ZodTypeAny>(
  prompt: string,
  schema: T,
  options: OptionsGeneration = {},
): Promise<z.infer<T>> {
  const tentativesMax = options.tentatives ?? 2;
  const contexte = options.contexte ?? {};

  // Avant de composer la chaîne : sans cela, un fournisseur dont la clé est en
  // base en serait absent, et l'appel échouerait avec un secours disponible.
  if (!options.fournisseur && !options.chaine) {
    await assurerSecrets();
    await assurerChaine();
  }

  const chaine = options.fournisseur
    ? [options.fournisseur]
    : (options.chaine ?? chaineFournisseurs());

  let derniereErreur: unknown = null;

  for (const [rang, fournisseur] of chaine.entries()) {
    try {
      const resultat = await tenterAvec(fournisseur, prompt, schema, tentativesMax, contexte);

      if (rang > 0) {
        console.warn(
          `[ia] ${chaine[0]!.nom} indisponible — traité par le secours « ${fournisseur.nom} ».`,
        );
      }
      return resultat;
    } catch (e) {
      derniereErreur = e;

      const reste = chaine.length - rang - 1;
      if (reste > 0) {
        const detail = e instanceof Error ? e.message.split('\n')[0] : String(e);
        console.warn(`[ia] ${fournisseur.nom} en échec, passage au secours : ${detail}`);
      }
    }
  }

  // Toute la chaîne est tombée. Le type de la dernière erreur est conservé :
  // un quota épuisé partout laisse la demande récupérable — l'extraction la
  // reprendra —, là où une sortie invalide exige une intervention.
  if (derniereErreur instanceof ErreurQuotaIA) throw derniereErreur;

  const message =
    derniereErreur instanceof Error ? derniereErreur.message : String(derniereErreur);

  throw new ErreurIA(
    `Aucun fournisseur IA n'a abouti (${chaine.map((f) => f.nom).join(' → ')}) : ${message}`,
    contexte,
  );
}

/**
 * Génération de texte libre (descriptions commerciales, synthèses).
 *
 * Même chaîne de secours que `genererJson` : ces textes partent dans les offres
 * envoyées aux clients, et une panne de fournisseur ne doit pas bloquer une
 * génération d'offre en cours.
 */
export async function genererTexte(
  prompt: string,
  options: { fournisseur?: FournisseurIA; chaine?: FournisseurIA[] } = {},
): Promise<string> {
  if (!options.fournisseur && !options.chaine) {
    await assurerSecrets();
    await assurerChaine();
  }

  const chaine = options.fournisseur
    ? [options.fournisseur]
    : (options.chaine ?? chaineFournisseurs());

  let derniereErreur: unknown = null;

  for (const [rang, fournisseur] of chaine.entries()) {
    try {
      const texte = (await fournisseur.completer(prompt, { json: false })).trim();

      if (rang > 0) {
        console.warn(
          `[ia] ${chaine[0]!.nom} indisponible — texte produit par « ${fournisseur.nom} ».`,
        );
      }
      return texte;
    } catch (e) {
      derniereErreur = e;

      if (chaine.length - rang - 1 > 0) {
        const detail = e instanceof Error ? e.message.split('\n')[0] : String(e);
        console.warn(`[ia] ${fournisseur.nom} en échec, passage au secours : ${detail}`);
      }
    }
  }

  throw new ErreurIA(
    `Génération de texte échouée sur toute la chaîne (${chaine.map((f) => f.nom).join(' → ')}) : ` +
      `${derniereErreur instanceof Error ? derniereErreur.message : String(derniereErreur)}`,
  );
}
