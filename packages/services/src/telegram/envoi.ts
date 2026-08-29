import { echapperHtml } from '@vigon/shared';

import { estConfigure, requis } from '../env.js';

/**
 * Émetteur Telegram — second transport du circuit de validation, à côté de WhatsApp.
 *
 * POURQUOI IL EXISTE
 *
 * WhatsApp reste bloqué côté Meta au 2026-08-20 : Business Portfolio non
 * vérifié, carte bancaire marocaine refusée sur la vérification récurrente.
 * Rien de tout cela n'existe côté Telegram — un jeton de bot créé via
 * @BotFather suffit, sans vérification d'entreprise ni moyen de paiement.
 *
 * MÊME PATRON QUE `whatsapp/envoi.ts`, délibérément : une garde de
 * configuration qui ne casse rien tant que la clé est absente, un émetteur qui
 * lève une erreur nommée plutôt que de faire planter l'appelant, une
 * vérification qui n'envoie rien. Le contenu du message ne change pas d'un
 * canal à l'autre — `texteValidation` est déjà en texte brut.
 */

const VERSION_API = 'bot';
const DELAI_MS = 20_000;

export class ErreurTelegram extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurTelegram';
  }
}

/** Vrai quand un jeton de bot est présent. Aucun identifiant de compte à part : le jeton EST le bot. */
export function telegramConfigure(): boolean {
  return estConfigure('TELEGRAM_BOT_TOKEN');
}

/**
 * Décrit l'état du canal, pour l'écran d'administration.
 *
 * Sans appel réseau, comme `descriptionWhatsApp` : ces fonctions sont lues à
 * chaque rendu de l'écran, un appel Telegram à chaque affichage serait un
 * gaspillage pour une information qui ne change qu'à la saisie de la clé.
 */
export function descriptionTelegram(): string {
  return telegramConfigure() ? 'Telegram (bot configuré)' : 'non configuré';
}

export type MessageTelegram = {
  /** Identifiant du message envoyé, pour le journal des communications. */
  messageId: number;
  chatId: string;
};

/**
 * Le lien est-il ouvrable depuis un téléphone ?
 *
 * MESURÉ, PAS SUPPOSÉ, le 2026-08-21 : l'API refuse un bouton pointant vers
 * `localhost` — « inline keyboard button URL is invalid: Wrong HTTP URL » — et
 * accepte le même lien dans une ancre HTML. Un bouton posé en développement
 * ferait donc échouer TOUT l'envoi, pas seulement le bouton.
 *
 * Le bouton n'est ajouté qu'au-dessus d'un hôte que Telegram acceptera, ce qui
 * revient à dire : en production. En développement, l'ancre suffit.
 */
function lienJoignable(lien: string): boolean {
  try {
    const hote = new URL(lien).hostname;
    return !['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hote) && !hote.endsWith('.local');
  } catch {
    return false;
  }
}

/**
 * Envoie un message texte à un chat déjà ouvert avec le bot.
 *
 * Le destinataire doit avoir démarré une conversation avec le bot au
 * préalable : Telegram interdit à un bot d'écrire le premier à un utilisateur,
 * exactement le même principe que la fenêtre de 24 h de WhatsApp, mais sans
 * délai — une fois la conversation ouverte, elle reste ouverte.
 */
export async function envoyerTelegram(params: {
  chatId: string;
  texte: string;
  /**
   * Adresse à rendre CLIQUABLE dans le message.
   *
   * Telegram n'autolie que ce qu'il reconnaît comme une adresse publique : un
   * `http://localhost:3000/...` posé en texte brut reste du texte mort, et
   * l'approbateur doit le recopier à la main.
   *
   * Fournie, elle bascule le message en `parse_mode: HTML` et remplace
   * l'occurrence brute par une ancre. ABSENTE, le message part exactement comme
   * avant — texte brut, sans mode d'analyse, donc sans aucun risque nouveau sur
   * les envois qui n'en ont pas besoin.
   */
  lien?: string;
}): Promise<MessageTelegram> {
  if (!telegramConfigure()) {
    throw new ErreurTelegram(
      'Telegram non configuré : renseigner le jeton du bot depuis /admin.',
    );
  }

  const chatId = params.chatId.trim();
  if (!chatId) {
    throw new ErreurTelegram('Identifiant de chat Telegram manquant.');
  }

  const { TELEGRAM_BOT_TOKEN: jeton } = requis('TELEGRAM_BOT_TOKEN');

  /*
   * Tout le texte est échappé AVANT d'y réinjecter la seule balise voulue.
   *
   * Il porte des valeurs venues de la base — nom du client, objet de l'affaire —
   * qu'aucun contrôle en amont ne rend sûres. `echapperHtml` est l'implémentation
   * UNIQUE du projet, et ses entités sont celles que Telegram accepte.
   *
   * L'ancre remplace l'adresse brute plutôt que de s'y ajouter : la voir deux
   * fois n'aide personne.
   */
  const charge: Record<string, unknown> = { chat_id: chatId, text: params.texte };

  /*
   * L'ENRICHISSEMENT N'A LIEU QUE SUR UN HÔTE JOIGNABLE.
   *
   * Première version, le 2026-08-21 : l'ancre était posée dans tous les cas, en
   * REMPLAÇANT l'adresse brute. L'API l'acceptait — d'où l'illusion que ça
   * marchait — mais le client Telegram SUPPRIME une ancre vers un hôte qu'il ne
   * peut pas ouvrir. Résultat sur localhost : plus d'ancre, et plus d'adresse
   * non plus, puisqu'elle avait été remplacée. Le message devenait inutilisable,
   * là où le texte brut restait au moins copiable.
   *
   * La leçon : l'API accepte une charge que le client rend autrement. Un contrôle
   * qui s'arrête à « Telegram a répondu ok » ne prouve rien sur l'affichage.
   *
   * Sur un hôte public, les deux enrichissements tiennent — ancre et bouton — et
   * le remplacement est alors sans risque.
   */
  if (params.lien && lienJoignable(params.lien)) {
    const echappe = echapperHtml(params.texte);
    const lienEchappe = echapperHtml(params.lien);

    charge.text = echappe.replace(
      lienEchappe,
      `<a href="${lienEchappe}">Ouvrir la demande de validation</a>`,
    );
    charge.parse_mode = 'HTML';
    charge.reply_markup = {
      inline_keyboard: [[{ text: 'Ouvrir la demande', url: params.lien }]],
    };
  }

  const reponse = await fetch(
    `https://api.telegram.org/${VERSION_API}${jeton}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(charge),
      signal: AbortSignal.timeout(DELAI_MS),
    },
  );

  const corps = (await reponse.json().catch(() => null)) as {
    ok?: boolean;
    result?: { message_id: number };
    description?: string;
    error_code?: number;
  } | null;

  if (!reponse.ok || !corps?.ok) {
    // Le message de Telegram nomme déjà la cause la plus fréquente : « Forbidden:
    // bot was blocked by the user » ou « chat not found » — le propager tel
    // quel évite de le retraduire moins précisément.
    throw new ErreurTelegram(
      `Envoi refusé par Telegram : ${corps?.description ?? `HTTP ${reponse.status}`}`,
    );
  }

  const messageId = corps.result?.message_id;
  if (messageId === undefined) {
    throw new ErreurTelegram('Réponse de Telegram sans identifiant de message.');
  }

  return { messageId, chatId };
}

/**
 * Vérifie que le jeton répond, sans envoyer de message.
 *
 * `getMe` n'exige aucun destinataire : c'est le seul appel qui éprouve
 * l'authentification du bot sans déranger personne, l'équivalent de
 * `verifierAccesWhatsApp` qui interroge la fiche du numéro plutôt que d'écrire.
 */
export async function verifierAccesTelegram(): Promise<string> {
  if (!telegramConfigure()) throw new ErreurTelegram('Telegram non configuré.');

  const { TELEGRAM_BOT_TOKEN: jeton } = requis('TELEGRAM_BOT_TOKEN');

  const reponse = await fetch(`https://api.telegram.org/${VERSION_API}${jeton}/getMe`, {
    signal: AbortSignal.timeout(DELAI_MS),
  });

  const corps = (await reponse.json().catch(() => null)) as {
    ok?: boolean;
    result?: { username?: string; first_name?: string };
    description?: string;
  } | null;

  if (!reponse.ok || !corps?.ok) {
    throw new ErreurTelegram(corps?.description ?? `HTTP ${reponse.status}`);
  }

  const nom = corps.result?.username ? `@${corps.result.username}` : corps.result?.first_name;
  return nom ?? 'bot sans nom';
}
