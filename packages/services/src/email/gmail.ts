import { google, type gmail_v1 } from 'googleapis';

import { estConfigure, optionnel, requis } from '../env.js';

export class ErreurGmail extends Error {
  constructor(
    message: string,
    readonly contexte: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ErreurGmail';
  }
}

/** Deux boîtes distinctes : voir la spec (RFQ/relances vs. envoi client). */
export type CompteGmail = 'principal' | 'fournisseur';

const PREFIXE: Record<CompteGmail, string> = {
  principal: 'GMAIL_PRINCIPAL',
  fournisseur: 'GMAIL_FOURNISSEUR',
};

function variables(compte: CompteGmail): string[] {
  const p = PREFIXE[compte];
  return [`${p}_CLIENT_ID`, `${p}_CLIENT_SECRET`, `${p}_REFRESH_TOKEN`, `${p}_ADDRESS`];
}

export function gmailConfigure(compte: CompteGmail): boolean {
  return estConfigure(...variables(compte));
}

function client(compte: CompteGmail): { api: gmail_v1.Gmail; adresse: string } {
  const p = PREFIXE[compte];
  const env = requis(
    `${p}_CLIENT_ID`,
    `${p}_CLIENT_SECRET`,
    `${p}_REFRESH_TOKEN`,
    `${p}_ADDRESS`,
  );

  const auth = new google.auth.OAuth2(
    env[`${p}_CLIENT_ID`],
    env[`${p}_CLIENT_SECRET`],
  );
  auth.setCredentials({ refresh_token: env[`${p}_REFRESH_TOKEN`] });

  return {
    api: google.gmail({ version: 'v1', auth }),
    adresse: env[`${p}_ADDRESS`] as string,
  };
}

/** Encode un en-tête non-ASCII (RFC 2047) — sujets accentués. */
function encoderEntete(valeur: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(valeur)) return valeur;
  return `=?UTF-8?B?${Buffer.from(valeur, 'utf8').toString('base64')}?=`;
}

/**
 * Découpe une chaîne base64 en lignes de 76 caractères (RFC 2045).
 *
 * Non cosmétique : au-delà de 998 octets par ligne, un message n'est plus
 * conforme, et des passerelles le réécrivent ou le rejettent. Un PDF d'une
 * seule ligne de plusieurs centaines de milliers de caractères tombe dans ce
 * cas.
 */
function replier(base64: string): string {
  return (base64.match(/.{1,76}/g) ?? []).join('\r\n');
}

/**
 * EXPORTÉE POUR LE HARNAIS, et pour une raison sérieuse.
 *
 * Ce MIME est assemblé à la main, chaîne par chaîne. Le transport actif est le
 * SMTP, où nodemailer fait ce travail : cette fonction ne s'exécute donc jamais
 * en service courant, et une faute de frontière ou de repli base64 n'y serait
 * découverte que le jour d'une bascule vers l'API Gmail — c'est-à-dire au pire
 * moment, sur un envoi client.
 *
 * `essai:envoi-offre` fait relire sa sortie par le même analyseur que celui de
 * la réception. Aucun réseau, et le multipart est éprouvé pour de bon.
 */
export function construireMime(params: {
  de: string;
  a: string;
  cc?: string[];
  sujet: string;
  html: string;
  inReplyTo?: string;
  references?: string;
  piecesJointes?: PieceJointeEnvoi[];
  entetes?: Record<string, string>;
}): string {
  const entetes = [
    `From: ${params.de}`,
    `To: ${params.a}`,
    `Subject: ${encoderEntete(params.sujet)}`,
    'MIME-Version: 1.0',
  ];

  // En-têtes libres, posés avant ceux que ce module maîtrise : un appelant ne
  // doit pas pouvoir réécrire From, To ni le Content-Type qu'on vient de
  // construire.
  for (const [nom, valeur] of Object.entries(params.entetes ?? {})) {
    entetes.push(`${nom}: ${encoderEntete(valeur)}`);
  }

  // Copie visible, et non copie cachée : les contacts d'un même fournisseur
  // doivent se voir entre eux, c'est une correspondance commerciale ordinaire.
  // Un Cci laisserait croire à chacun qu'il est seul destinataire.
  if (params.cc && params.cc.length > 0) {
    entetes.push(`Cc: ${params.cc.join(', ')}`);
  }

  // Threading : sans ces en-têtes, la relance ouvre un nouveau fil côté
  // fournisseur au lieu de s'ajouter à la conversation existante.
  if (params.inReplyTo) entetes.push(`In-Reply-To: ${params.inReplyTo}`);
  if (params.references) entetes.push(`References: ${params.references}`);

  const corpsHtml = replier(Buffer.from(params.html, 'utf8').toString('base64'));

  // Sans pièce jointe, le message reste EXACTEMENT celui d'avant : une partie
  // unique, sans enveloppe multipart. Emballer systématiquement changerait la
  // forme de tous les messages du flux pour un besoin qui ne les concerne pas.
  if (!params.piecesJointes || params.piecesJointes.length === 0) {
    entetes.push('Content-Type: text/html; charset="UTF-8"');
    entetes.push('Content-Transfer-Encoding: base64');
    return `${entetes.join('\r\n')}\r\n\r\n${corpsHtml}`;
  }

  // Frontière tirée au hasard : elle ne doit apparaître dans aucune des parties,
  // et le contenu joint est arbitraire.
  const frontiere = `----vigon-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  entetes.push(`Content-Type: multipart/mixed; boundary="${frontiere}"`);

  const parties = [
    [
      `--${frontiere}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      corpsHtml,
    ].join('\r\n'),
  ];

  for (const pj of params.piecesJointes) {
    parties.push(
      [
        `--${frontiere}`,
        `Content-Type: ${pj.typeMime}; name="${encoderEntete(pj.nom)}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${encoderEntete(pj.nom)}"`,
        '',
        replier(pj.contenu.toString('base64')),
      ].join('\r\n'),
    );
  }

  parties.push(`--${frontiere}--`);

  return `${entetes.join('\r\n')}\r\n\r\n${parties.join('\r\n')}\r\n`;
}

const encoderUrlSafe = (mime: string): string =>
  Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export type MessageEnvoye = {
  messageId: string;
  threadId: string;
};

/**
 * Fichier joint à un message sortant.
 *
 * Le contenu est porté en mémoire, pas par un chemin : les documents de la
 * plateforme vivent dans Supabase Storage, jamais sur le disque du serveur — et
 * un hébergement de conteneurs n'a de toute façon pas de disque durable.
 */
export type PieceJointeEnvoi = {
  nom: string;
  contenu: Buffer;
  typeMime: string;
};

/**
 * Envoie un e-mail HTML. Fournir `threadId` + `inReplyTo` pour répondre dans
 * un fil existant (relances, flux étape 6).
 */
export async function envoyerEmail(
  compte: CompteGmail,
  params: {
    a: string;
    /**
     * Était ABSENTE de cette signature alors que `construireMime` la gérait :
     * `envoyer` transmettait `cc`, ce transport-ci le laissait tomber sans rien
     * dire. Invisible tant que le SMTP est actif, et perdu le jour de la
     * bascule vers l'API.
     */
    cc?: string[];
    sujet: string;
    html: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    piecesJointes?: PieceJointeEnvoi[];
    entetes?: Record<string, string>;
  },
): Promise<MessageEnvoye> {
  const { api, adresse } = client(compte);

  const raw = encoderUrlSafe(
    construireMime({
      de: adresse,
      a: params.a,
      cc: params.cc,
      sujet: params.sujet,
      html: params.html,
      inReplyTo: params.inReplyTo,
      references: params.references,
      piecesJointes: params.piecesJointes,
      entetes: params.entetes,
    }),
  );

  try {
    const reponse = await api.users.messages.send({
      userId: 'me',
      requestBody: { raw, ...(params.threadId ? { threadId: params.threadId } : {}) },
    });

    const { id, threadId } = reponse.data;
    if (!id || !threadId) {
      throw new ErreurGmail("Gmail n'a pas renvoyé d'identifiant de message.");
    }
    return { messageId: id, threadId };
  } catch (e) {
    if (e instanceof ErreurGmail) throw e;
    throw new ErreurGmail(
      `Envoi échoué : ${e instanceof Error ? e.message : String(e)}`,
      { compte, destinataire: params.a },
    );
  }
}

/**
 * Ajoute ou retire le label de suivi (flux étapes 5 et 7).
 * Le retrait du label sort la consultation du périmètre de relance.
 */
export async function modifierLabelSuivi(
  compte: CompteGmail,
  messageId: string,
  action: 'ajouter' | 'retirer',
): Promise<void> {
  const { api } = client(compte);
  const label = optionnel('GMAIL_LABEL_SUIVI', '');
  if (!label) return;

  try {
    await api.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody:
        action === 'ajouter'
          ? { addLabelIds: [label] }
          : { removeLabelIds: [label] },
    });
  } catch (e) {
    throw new ErreurGmail(
      `Modification du label échouée : ${e instanceof Error ? e.message : String(e)}`,
      { compte, messageId, action },
    );
  }
}

/** Vérifie l'accès au compte : renvoie l'adresse résolue par l'API. */
export async function verifierAcces(compte: CompteGmail): Promise<string> {
  const { api } = client(compte);
  try {
    const profil = await api.users.getProfile({ userId: 'me' });
    return profil.data.emailAddress ?? '(adresse inconnue)';
  } catch (e) {
    throw new ErreurGmail(
      `Accès refusé : ${e instanceof Error ? e.message : String(e)}`,
      { compte },
    );
  }
}
