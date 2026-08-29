import { estConfigure, optionnel, requis } from '../env.js';

/**
 * Émetteur WhatsApp Business — le transport qui manquait au circuit de validation.
 *
 * Le circuit d'approbation est entier depuis le 2026-08-16 : demande, jeton,
 * page publique, décision, idempotence. Seul son émetteur manquait, et le
 * courriel en tenait lieu. Ce module est cet émetteur.
 *
 * POURQUOI IL PEUT ÊTRE ÉCRIT AVANT D'AVOIR LA CLÉ
 *
 * Le contenu du message ne dépend pas du support : `texteValidation` a été
 * rédigé d'emblée en texte brut, précisément pour un canal sans HTML. Il n'y a
 * donc rien à réécrire le jour où le compte Business existe — seulement une clé
 * à saisir dans `/admin`, comme n'importe quelle autre.
 *
 * `whatsappConfigure()` est la garde : tant qu'elle rend `false`, l'appelant
 * retombe sur le courriel. Aucun appel réseau n'est tenté, aucune erreur n'est
 * levée, et rien ne change pour l'utilisateur.
 */

/** Version figée : l'API Graph casse entre versions majeures, jamais dans l'une d'elles. */
const VERSION_API = 'v21.0';

/** 20 s : au-delà, l'appelant a déjà rendu la main et le lien part autrement. */
const DELAI_MS = 20_000;

export class ErreurWhatsApp extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurWhatsApp';
  }
}

/**
 * Vrai quand le compte est utilisable.
 *
 * Les deux valeurs sont nécessaires : le jeton authentifie, l'identifiant de
 * numéro dit QUI envoie. Un compte Business en porte plusieurs, et l'API refuse
 * un envoi sans savoir lequel.
 */
export function whatsappConfigure(): boolean {
  return estConfigure('WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID');
}

/** Décrit l'état du canal, pour l'écran d'administration. */
export function descriptionWhatsApp(): string {
  if (!whatsappConfigure()) return 'non configuré';
  const id = optionnel('WHATSAPP_PHONE_NUMBER_ID', '');
  return `WhatsApp Business (numéro ${id.slice(-4).padStart(id.length, '•')})`;
}

/**
 * Numéro au format attendu par l'API : chiffres seuls, indicatif compris.
 *
 * L'API refuse `+212 6 12 34 56 78` et accepte `212612345678`. Un numéro saisi
 * à la main par un humain porte presque toujours des espaces ou un `+` : les
 * retirer ici évite un refus que l'appelant ne saurait pas interpréter.
 *
 * LE `00` DE TÊTE EST RETIRÉ AUSSI.
 *
 * C'est le préfixe d'accès international, l'autre façon d'écrire le `+` — et de
 * loin la plus répandue dans un carnet d'adresses marocain. Ne garder que les
 * chiffres transformait `00212612345678` en un numéro que Meta refuse, avec un
 * message qui ne nomme pas la cause.
 *
 * Aucune ambiguïté : aucun indicatif pays ne commence par zéro, un `00` de tête
 * ne peut donc être que ce préfixe.
 *
 * Ce qui reste volontairement NON deviné : un numéro national, `0612345678`.
 * Lui coller un indicatif supposerait le pays de l'approbateur, que rien ne dit.
 * `envoyerWhatsApp` le refuse en le nommant, plutôt que d'envoyer au hasard.
 */
export function normaliserNumero(brut: string): string {
  return brut.replace(/[^\d]/g, '').replace(/^00/, '');
}

export type MessageWhatsApp = {
  /** Identifiant Meta du message, pour le journal des communications. */
  messageId: string;
  destinataire: string;
};

/**
 * Envoie un message texte.
 *
 * Message libre et non gabarit : Meta n'autorise le texte libre que dans les
 * 24 h suivant un message de l'utilisateur. Au-delà, il faut un gabarit
 * approuvé — c'est une contrainte de la plateforme, pas du code, et elle se
 * règle côté compte Business. L'erreur remontée par l'API le dit explicitement,
 * et elle est propagée telle quelle plutôt que traduite : le message de Meta
 * nomme le gabarit manquant, une reformulation le perdrait.
 */
export async function envoyerWhatsApp(params: {
  destinataire: string;
  texte: string;
}): Promise<MessageWhatsApp> {
  if (!whatsappConfigure()) {
    throw new ErreurWhatsApp(
      'WhatsApp non configuré : renseigner WHATSAPP_TOKEN et ' +
        'WHATSAPP_PHONE_NUMBER_ID depuis /admin.',
    );
  }

  const env = requis('WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID');
  const destinataire = normaliserNumero(params.destinataire);

  if (destinataire.length < 8) {
    throw new ErreurWhatsApp(`Numéro inexploitable : « ${params.destinataire} ».`);
  }

  // Un zéro de tête après normalisation = format national, indicatif absent.
  // Meta le refuse par un « Invalid parameter » qui ne dit pas lequel. Le
  // nommer ici épargne une enquête sur la fiche de l'approbateur.
  if (destinataire.startsWith('0')) {
    throw new ErreurWhatsApp(
      `Numéro sans indicatif pays : « ${params.destinataire} ». ` +
        'Attendu au format international, par exemple 212612345678.',
    );
  }

  const reponse = await fetch(
    `https://graph.facebook.com/${VERSION_API}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: destinataire,
        type: 'text',
        // `preview_url` désactivé : l'aperçu irait chercher la page de
        // validation, ce qui la marquerait consultée avant que l'humain
        // ne l'ouvre.
        text: { preview_url: false, body: params.texte },
      }),
      signal: AbortSignal.timeout(DELAI_MS),
    },
  );

  const corps = (await reponse.json().catch(() => null)) as {
    messages?: { id: string }[];
    error?: { message?: string; code?: number };
  } | null;

  if (!reponse.ok) {
    const motif = corps?.error?.message ?? `HTTP ${reponse.status}`;
    throw new ErreurWhatsApp(`Envoi refusé par Meta : ${motif}`);
  }

  const messageId = corps?.messages?.[0]?.id;

  if (!messageId) {
    throw new ErreurWhatsApp('Réponse de Meta sans identifiant de message.');
  }

  return { messageId, destinataire };
}

/**
 * Vérifie que le jeton et le numéro répondent, sans envoyer de message.
 *
 * Interroge la fiche du numéro : c'est le seul appel qui éprouve à la fois
 * l'authentification et l'existence du numéro, sans déranger personne.
 */
export async function verifierAccesWhatsApp(): Promise<string> {
  if (!whatsappConfigure()) throw new ErreurWhatsApp('WhatsApp non configuré.');

  const env = requis('WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID');

  const reponse = await fetch(
    `https://graph.facebook.com/${VERSION_API}/${env.WHATSAPP_PHONE_NUMBER_ID}` +
      '?fields=display_phone_number,verified_name,quality_rating',
    {
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` },
      signal: AbortSignal.timeout(DELAI_MS),
    },
  );

  const corps = (await reponse.json().catch(() => null)) as {
    display_phone_number?: string;
    verified_name?: string;
    quality_rating?: string;
    error?: { message?: string };
  } | null;

  if (!reponse.ok) {
    throw new ErreurWhatsApp(corps?.error?.message ?? `HTTP ${reponse.status}`);
  }

  return [
    corps?.verified_name ?? 'compte sans nom vérifié',
    corps?.display_phone_number ?? '',
    corps?.quality_rating ? `qualité ${corps.quality_rating}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
