import { definirSurcharges, viderSurcharges } from './env.js';
import { clientAdmin } from './supabase.js';

/**
 * Clés de services stockées en base, modifiables depuis l'application.
 *
 * Motivation : changer une clé ne doit pas obliger à éditer un fichier et à
 * redéployer. La valeur en base l'emporte sur la variable d'environnement, qui
 * reste le repli — une installation peut donc ne rien mettre en base.
 *
 * ⚠️ Contrepartie à connaître : une clé en base est lisible par quiconque
 * accède à la base, alors qu'un fichier `.env` reste sur le serveur. L'écriture
 * est réservée à ADMIN et les valeurs ne sont jamais renvoyées en clair à
 * l'interface, mais ce confinement est plus faible qu'un secret de déploiement.
 */

/** Catégorie qui distingue les secrets des paramètres métier. */
export const CATEGORIE_SECRET = 'secret';

/** Clés gérables depuis l'application, avec ce à quoi elles servent. */
export const CLES_GEREES = [
  /*
   * DEUX EMPLACEMENTS, PAS UN PAR FOURNISSEUR.
   *
   * Cet écran en a compté douze : un par fournisseur, plus son modèle, plus le
   * trio d'une API tierce. Le 2026-08-19 une clé OpenAI s'est retrouvée dans
   * l'emplacement Groq — la plateforme appelait api.groq.com avec une clé `sk-`
   * et recevait « Invalid API Key », message qui accuse le fournisseur quand le
   * tort est à l'emplacement.
   *
   * Le défaut n'était pas la clé mal rangée, c'était de DEMANDER de la ranger.
   * Une clé porte son émetteur dans son préfixe : `sk-or-v1-` pour OpenRouter,
   * `gsk_` pour Groq, `sk-ant-` pour Anthropic. La plateforme le déduit, choisit
   * un modèle disponible, et se répare seule si ce modèle disparaît du
   * catalogue. Changer de fournisseur revient donc à coller une autre clé.
   */
  {
    nom: 'IA_CLE_PRINCIPALE',
    libelle: 'IA — clé principale',
    service: 'ia',
    aide:
      'N’importe quelle clé de modèle de conversation : OpenAI, OpenRouter, ' +
      'Anthropic, Groq, DeepSeek… Le fournisseur et le modèle sont déduits.',
  },
  {
    nom: 'IA_CLE_ALTERNATIVE',
    libelle: 'IA — clé alternative',
    service: 'ia',
    aide:
      'Prend le relais si la principale tombe — panne, quota, modèle retiré. ' +
      'Idéalement chez un autre fournisseur, sinon les deux tombent ensemble.',
  },
  {
    nom: 'GEMINI_API_KEY',
    libelle: 'IA — clé de vectorisation (Gemini)',
    service: 'ia',
    /*
     * À part, et pour une raison de fond : ce n'est pas un modèle de
     * conversation interchangeable mais la SEULE source des vecteurs de la
     * recherche sémantique de fournisseurs. La mêler aux deux autres la ferait
     * perdre le jour où l'on change de modèle de conversation.
     */
    aide:
      'Sert uniquement aux vecteurs de la recherche sémantique de fournisseurs, ' +
      'qui n’a pas d’autre source. Console : aistudio.google.com/apikey',
  },
  {
    nom: 'IA_MODELE_PRINCIPAL',
    libelle: 'IA — modèle imposé (facultatif)',
    service: 'ia',
    aide:
      'Vide = choix automatique dans le catalogue du fournisseur. À remplir ' +
      'seulement pour imposer un modèle précis à la clé principale.',
    sensible: false,
  },
  {
    nom: 'FIRECRAWL_API_KEY',
    libelle: 'Firecrawl',
    service: 'firecrawl',
    aide: 'Sourcing des fournisseurs et recherche des photos produits.',
  },
  {
    nom: 'GAMMA_API_KEY',
    libelle: 'Gamma',
    service: 'gamma',
    aide: "Génération de l'offre. Sans elle, un PDF est produit localement.",
  },
  {
    nom: 'IMAP_CLIENT_PASSWORD',
    libelle: 'Boîte mail — mot de passe',
    service: 'imap',
    aide: "Mot de passe d'application, jamais celui du compte. Sert à la lecture et à l'envoi SMTP.",
  },
  {
    nom: 'IMAP_CLIENT_USER',
    libelle: 'Boîte mail — adresse',
    service: 'imap',
    aide: 'Adresse de la boîte avant-vente relevée par le worker.',
    sensible: false,
    // Une adresse mal saisie ne se voyait qu'au premier test de connexion, sous
    // forme de refus d'authentification — un message qui accuse le compte quand
    // le tort est à la frappe.
    format: 'email',
  },
  {
    nom: 'WHATSAPP_TOKEN',
    libelle: 'WhatsApp — jeton',
    service: 'whatsapp',
    aide:
      'Jeton permanent du compte Business. Tant qu’il est vide, la validation ' +
      'part par courriel et rien ne change. Console : developers.facebook.com',
  },
  {
    nom: 'WHATSAPP_PHONE_NUMBER_ID',
    libelle: 'WhatsApp — identifiant du numéro',
    service: 'whatsapp',
    // Ce n'est pas le numéro affiché mais son identifiant interne, et un compte
    // Business en porte plusieurs : sans lui l'API ne sait pas qui envoie.
    aide: 'Identifiant du numéro émetteur (Phone number ID), pas le numéro lui-même.',
    sensible: false,
  },
  {
    nom: 'TELEGRAM_BOT_TOKEN',
    libelle: 'Telegram — jeton du bot',
    service: 'telegram',
    /*
     * Second émetteur du circuit de validation, ajouté le 2026-08-20 pendant
     * que WhatsApp restait bloqué côté Meta (Business Portfolio non vérifié,
     * carte bancaire refusée). Aucune des deux exigences n'existe ici : un
     * jeton créé via @BotFather suffit.
     */
    aide:
      'Jeton du bot créé via @BotFather sur Telegram. Tant qu’il est vide, la ' +
      'validation part par WhatsApp ou courriel.',
  },
] as const;

export type CleGeree = (typeof CLES_GEREES)[number];

const NOMS_GERES = new Set(CLES_GEREES.map((c) => c.nom));

/** Cache court : le worker tourne en continu, un changement doit prendre vite. */
const DUREE_CACHE_MS = 60_000;

let expiration = 0;
let tenantCharge: string | null = null;

/**
 * Charge les clés stockées en base et les rend visibles aux services.
 *
 * À appeler avant toute opération utilisant un service externe. Le cache évite
 * une requête par appel ; passer `force` après une écriture pour la voir
 * immédiatement.
 */
export async function chargerSecrets(
  tenant: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!options.force && tenantCharge === tenant && expiration > Date.now()) return;

  const { data, error } = await clientAdmin()
    .from('parametres')
    .select('cle, valeur')
    .eq('tenant_id', tenant)
    .eq('categorie', CATEGORIE_SECRET);

  if (error) {
    // On garde les surcharges précédentes : perdre une clé en cours de route
    // casserait des jobs qui fonctionnaient.
    console.error(`[secrets] lecture impossible : ${error.message}`);
    return;
  }

  const surcharges: Record<string, string> = {};
  for (const ligne of data ?? []) {
    if (ligne.cle && ligne.valeur && NOMS_GERES.has(ligne.cle as never)) {
      surcharges[ligne.cle] = ligne.valeur;
    }
  }

  definirSurcharges(surcharges);
  tenantCharge = tenant;
  expiration = Date.now() + DUREE_CACHE_MS;
}

/** Oublie les clés chargées : utile en test et après suppression. */
export function oublierSecrets(): void {
  viderSurcharges();
  tenantCharge = null;
  expiration = 0;
}

export type EtatCle = {
  nom: string;
  libelle: string;
  service: string;
  aide: string;
  /** D'où vient la valeur réellement utilisée. */
  source: 'base' | 'environnement' | 'absente';
  /** Aperçu masqué — jamais la valeur complète. */
  apercu: string | null;
  /**
   * Faux pour les valeurs qui ne sont pas des secrets — une adresse, un
   * identifiant de numéro.
   *
   * L'information existait ici mais s'arrêtait à `masquer()` : l'interface
   * n'en savait rien et présentait TOUS les champs en `type="password"`. On
   * saisissait donc une adresse de boîte à l'aveugle, en points, sans pouvoir
   * se relire — alors qu'elle est ensuite affichée en clair dans la liste.
   * Combiné à l'absence de contrôle de format, une faute de frappe ne se
   * voyait qu'au premier test de connexion.
   */
  sensible: boolean;
};

/** Masque une valeur : de quoi la reconnaître, pas de quoi la réutiliser. */
export function masquer(valeur: string, sensible = true): string {
  if (!sensible) return valeur;
  if (valeur.length <= 8) return '•'.repeat(valeur.length);
  return `${valeur.slice(0, 3)}${'•'.repeat(8)}${valeur.slice(-4)}`;
}

/**
 * État de chaque clé gérée, pour l'écran de paramétrage.
 *
 * Ne renvoie jamais de valeur complète : l'interface n'a besoin que de savoir
 * si la clé est là et d'où elle vient.
 */
export async function etatDesCles(tenant: string): Promise<EtatCle[]> {
  const { data } = await clientAdmin()
    .from('parametres')
    .select('cle, valeur')
    .eq('tenant_id', tenant)
    .eq('categorie', CATEGORIE_SECRET);

  const enBase = new Map(
    (data ?? [])
      .filter((l) => l.cle && l.valeur)
      .map((l) => [l.cle as string, l.valeur as string]),
  );

  return CLES_GEREES.map((cle) => {
    const sensible = !('sensible' in cle) || cle.sensible !== false;
    const valeurBase = enBase.get(cle.nom);
    const valeurEnv = process.env[cle.nom]?.trim();

    const commun = {
      nom: cle.nom,
      libelle: cle.libelle,
      service: cle.service,
      aide: cle.aide,
      sensible,
    };

    if (valeurBase) {
      return { ...commun, source: 'base' as const, apercu: masquer(valeurBase, sensible) };
    }
    if (valeurEnv) {
      return {
        ...commun,
        source: 'environnement' as const,
        apercu: masquer(valeurEnv, sensible),
      };
    }
    return { ...commun, source: 'absente' as const, apercu: null };
  });
}

export function estCleGeree(nom: string): boolean {
  return NOMS_GERES.has(nom as never);
}
