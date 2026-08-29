import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

import { estConfigure, nombreOptionnel, optionnel, requis } from '../env.js';

export class ErreurImap extends Error {
  constructor(
    message: string,
    readonly contexte: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ErreurImap';
  }
}

export function imapConfigure(): boolean {
  return estConfigure('IMAP_CLIENT_HOST', 'IMAP_CLIENT_USER', 'IMAP_CLIENT_PASSWORD');
}

export type PieceJointeBrute = {
  nom: string;
  typeMime: string;
  contenu: Buffer;
};

export type MessageEntrant = {
  uid: number;
  messageId: string | null;
  /** En-tête References/In-Reply-To : sert à retrouver la consultation. */
  inReplyTo: string | null;
  /** En-tête References : porte toute la chaîne du fil, pas seulement le parent. */
  references: string[];
  expediteur: string;
  expediteurBrut: string;
  sujet: string;
  corpsTexte: string;
  corpsHtml: string | null;
  date: Date;
  piecesJointes: PieceJointeBrute[];
  /** Type MIME du message, ex. « multipart/report » sur un avis de non-remise. */
  typeContenu: string | null;
  /** Paramètre `report-type`, ex. « delivery-status » (RFC 3464). */
  typeRapport: string | null;
  /** En-tête `Auto-Submitted` (RFC 3834), ex. « auto-replied ». */
  autoSoumis: string | null;
  /** En-tête `Precedence`, ex. « bulk » sur un envoi de masse. */
  preseance: string | null;
  /** `List-Id` ou `List-Unsubscribe` présents : diffusion, pas correspondance. */
  listeDiffusion: boolean;
  /** En-tête `X-Auto-Response-Suppress` : « ne me réponds pas automatiquement ». */
  reponsesAutoSupprimees: boolean;
};

/** En-tête `Content-Type` tel que mailparser le restitue. */
type EnTeteContenu = { value?: string; params?: Record<string, string> };

function connexion(): ImapFlow {
  const env = requis('IMAP_CLIENT_HOST', 'IMAP_CLIENT_USER', 'IMAP_CLIENT_PASSWORD');

  const client = new ImapFlow({
    host: env.IMAP_CLIENT_HOST,
    port: nombreOptionnel('IMAP_CLIENT_PORT', 993),
    secure: optionnel('IMAP_CLIENT_SECURE', 'true') !== 'false',
    auth: { user: env.IMAP_CLIENT_USER, pass: env.IMAP_CLIENT_PASSWORD },
    logger: false,
  });

  // ImapFlow est un EventEmitter : il signale les coupures réseau par un
  // événement « error » ASYNCHRONE, hors de toute pile try/catch. Sans écouteur,
  // Node applique sa règle par défaut et termine le processus — le worker
  // mourait donc à chaque expiration du socket, réception comprise.
  //
  // Journalisé au niveau debug : l'échec réel est déjà remonté par l'appelant
  // sous forme d'ErreurImap, et le cycle suivant rouvrira une connexion.
  client.on('error', (e: unknown) => {
    console.debug(
      `[imap] connexion perdue : ${e instanceof Error ? e.message : String(e)}`,
    );
  });

  return client;
}

/**
 * Ferme la connexion sans jamais relancer.
 *
 * `logout()` échoue quand le socket est déjà tombé, et cet échec-là n'apprend
 * rien : le motif de la coupure a déjà été signalé.
 */
async function fermer(client: ImapFlow): Promise<void> {
  try {
    await client.logout();
  } catch {
    try {
      client.close();
    } catch {
      /* socket déjà fermé */
    }
  }
}

/**
 * Récupère les messages non lus et les marque comme lus.
 *
 * Le marquage est ce qui rend le polling idempotent : sans lui, chaque cycle
 * recréerait les mêmes demandes. Il n'a lieu qu'après traitement réussi du
 * message par `traiter`, pour ne pas perdre un message sur une erreur.
 */
export async function relverMessagesNonLus(
  traiter: (message: MessageEntrant) => Promise<void>,
  options: { boite?: string; limite?: number } = {},
): Promise<number> {
  const client = connexion();
  const boite = options.boite ?? optionnel('IMAP_CLIENT_MAILBOX', 'INBOX');
  const limite = options.limite ?? 20;

  try {
    await client.connect();
  } catch (e) {
    throw new ErreurImap(
      `Connexion IMAP impossible : ${e instanceof Error ? e.message : String(e)}`,
      { boite },
    );
  }

  let traites = 0;

  // Le verrou est pris DANS le try : s'il échoue — boîte absente, connexion
  // tombée entre-temps — la connexion doit être refermée malgré tout, sinon
  // chaque cycle en fuite laisse un socket ouvert.
  let verrou: Awaited<ReturnType<ImapFlow['getMailboxLock']>> | null = null;

  try {
    verrou = await client.getMailboxLock(boite);

    const uids = await client.search({ seen: false }, { uid: true });
    if (!uids || uids.length === 0) return 0;

    for (const uid of uids.slice(0, limite)) {
      const message = await client.fetchOne(
        String(uid),
        { source: true, envelope: true },
        { uid: true },
      );
      if (!message || !message.source) continue;

      const parse = await simpleParser(message.source);

      const enTeteContenu = parse.headers.get('content-type') as
        | EnTeteContenu
        | undefined;
      const autoSoumis = parse.headers.get('auto-submitted');
      const preseance = parse.headers.get('precedence');

      const entrant: MessageEntrant = {
        uid,
        messageId: parse.messageId ?? null,
        inReplyTo: parse.inReplyTo ?? null,
        references: Array.isArray(parse.references)
          ? parse.references
          : parse.references
            ? [parse.references]
            : [],
        expediteur: parse.from?.value?.[0]?.address ?? '',
        expediteurBrut: parse.from?.text ?? '',
        sujet: parse.subject ?? '(sans objet)',
        corpsTexte: parse.text ?? '',
        corpsHtml: typeof parse.html === 'string' ? parse.html : null,
        date: parse.date ?? new Date(),
        piecesJointes: (parse.attachments ?? []).map((pj) => ({
          nom: pj.filename ?? 'piece-jointe',
          typeMime: pj.contentType ?? 'application/octet-stream',
          contenu: pj.content,
        })),
        typeContenu: enTeteContenu?.value?.toLowerCase() ?? null,
        typeRapport: enTeteContenu?.params?.['report-type']?.toLowerCase() ?? null,
        autoSoumis: typeof autoSoumis === 'string' ? autoSoumis.toLowerCase() : null,
        preseance: typeof preseance === 'string' ? preseance.toLowerCase() : null,
        listeDiffusion:
          parse.headers.has('list-id') || parse.headers.has('list-unsubscribe'),
        reponsesAutoSupprimees: parse.headers.has('x-auto-response-suppress'),
      };

      await traiter(entrant);

      // Après succès seulement : une erreur laisse le message non lu, donc rejoué.
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      traites += 1;
    }
  } finally {
    verrou?.release();
    await fermer(client);
  }

  return traites;
}

/** Vérifie que la boîte est joignable : renvoie le nombre de messages. */
export async function verifierAcces(): Promise<number> {
  const client = connexion();
  const boite = optionnel('IMAP_CLIENT_MAILBOX', 'INBOX');

  try {
    await client.connect();
    const verrou = await client.getMailboxLock(boite);
    try {
      const statut = await client.status(boite, { messages: true });
      return statut.messages ?? 0;
    } finally {
      verrou.release();
    }
  } catch (e) {
    throw new ErreurImap(
      `Accès IMAP impossible : ${e instanceof Error ? e.message : String(e)}`,
      { boite },
    );
  } finally {
    await fermer(client);
  }
}
