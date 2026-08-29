import nodemailer, { type Transporter } from 'nodemailer';

import { estConfigure, nombreOptionnel, optionnel, requis } from '../env.js';
import type { CompteGmail, MessageEnvoye, PieceJointeEnvoi } from './gmail.js';

/**
 * Envoi par SMTP, avec un mot de passe d'application.
 *
 * Alternative à l'API Gmail, qui exige un `refresh_token` obtenu par un flux
 * OAuth complet. Un mot de passe d'application suffit ici — le même que celui
 * qui donne déjà accès à la boîte en IMAP.
 *
 * Contrepartie assumée : SMTP ne pose pas de label Gmail et ne renvoie pas de
 * `threadId`. L'appariement des réponses se fait donc sur les en-têtes
 * `Message-ID` / `In-Reply-To`, qui sont universels et non propres à Gmail.
 */

export class ErreurSmtp extends Error {
  constructor(
    message: string,
    readonly contexte: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ErreurSmtp';
  }
}

const PREFIXE: Record<CompteGmail, string> = {
  principal: 'SMTP_PRINCIPAL',
  fournisseur: 'SMTP_FOURNISSEUR',
};

/**
 * Repli sur les identifiants IMAP du compte client.
 *
 * Une installation modeste n'a qu'une boîte : la même adresse reçoit les
 * demandes et envoie les consultations. Exiger une configuration SMTP séparée
 * pour ce cas courant serait une friction inutile.
 */
function identifiants(compte: CompteGmail): {
  hote: string;
  port: number;
  utilisateur: string;
  motDePasse: string;
  adresse: string;
} | null {
  const p = PREFIXE[compte];

  if (estConfigure(`${p}_USER`, `${p}_PASSWORD`)) {
    const env = requis(`${p}_USER`, `${p}_PASSWORD`);
    return {
      hote: optionnel(`${p}_HOST`, 'smtp.gmail.com'),
      port: nombreOptionnel(`${p}_PORT`, 465),
      utilisateur: env[`${p}_USER`]!,
      motDePasse: env[`${p}_PASSWORD`]!,
      adresse: optionnel(`${p}_FROM`, env[`${p}_USER`]!),
    };
  }

  if (estConfigure('IMAP_CLIENT_USER', 'IMAP_CLIENT_PASSWORD')) {
    const env = requis('IMAP_CLIENT_USER', 'IMAP_CLIENT_PASSWORD');
    return {
      hote: optionnel('SMTP_HOST', 'smtp.gmail.com'),
      port: nombreOptionnel('SMTP_PORT', 465),
      utilisateur: env.IMAP_CLIENT_USER,
      motDePasse: env.IMAP_CLIENT_PASSWORD,
      adresse: optionnel('SMTP_FROM', env.IMAP_CLIENT_USER),
    };
  }

  return null;
}

export function smtpConfigure(compte: CompteGmail): boolean {
  return identifiants(compte) !== null;
}

/** Adresse expéditrice effective, pour l'afficher dans l'interface. */
export function smtpAdresse(compte: CompteGmail): string | null {
  return identifiants(compte)?.adresse ?? null;
}

function transport(compte: CompteGmail): { envoi: Transporter; adresse: string } {
  const ids = identifiants(compte);
  if (!ids) {
    throw new ErreurSmtp(
      `Aucun identifiant SMTP pour le compte « ${compte} » (${PREFIXE[compte]}_USER / _PASSWORD, ou IMAP_CLIENT_*).`,
    );
  }

  return {
    envoi: nodemailer.createTransport({
      host: ids.hote,
      port: ids.port,
      // 465 impose TLS d'emblée ; 587 démarre en clair puis passe en STARTTLS.
      secure: ids.port === 465,
      auth: { user: ids.utilisateur, pass: ids.motDePasse },
    }),
    adresse: ids.adresse,
  };
}

/**
 * Envoie un message. `inReplyTo` place la réponse dans le fil d'origine.
 *
 * Le `messageId` renvoyé est celui généré par le serveur SMTP : c'est lui qu'il
 * faut conserver pour apparier la réponse du fournisseur.
 */
export async function envoyerEmailSmtp(
  compte: CompteGmail,
  params: {
    a: string;
    cc?: string[];
    sujet: string;
    html: string;
    texte?: string;
    inReplyTo?: string;
    references?: string;
    piecesJointes?: PieceJointeEnvoi[];
    entetes?: Record<string, string>;
  },
): Promise<MessageEnvoye> {
  const { envoi, adresse } = transport(compte);

  try {
    const resultat = await envoi.sendMail({
      from: adresse,
      to: params.a,
      subject: params.sujet,
      html: params.html,
      text: params.texte,
      // Absente par défaut : un appelant qui ne passe pas `cc` produit
      // exactement le même message qu'avant.
      ...(params.cc && params.cc.length > 0 ? { cc: params.cc } : {}),
      ...(params.inReplyTo ? { inReplyTo: params.inReplyTo } : {}),
      ...(params.references ? { references: params.references } : {}),
      ...(params.entetes ? { headers: params.entetes } : {}),
      // Même principe : sans pièce jointe, nodemailer produit le message d'avant.
      ...(params.piecesJointes && params.piecesJointes.length > 0
        ? {
            attachments: params.piecesJointes.map((pj) => ({
              filename: pj.nom,
              content: pj.contenu,
              contentType: pj.typeMime,
            })),
          }
        : {}),
    });

    if (!resultat.messageId) {
      throw new ErreurSmtp("Le serveur SMTP n'a pas renvoyé de Message-ID.");
    }

    return {
      messageId: resultat.messageId,
      // Sans Gmail, le fil est identifié par le Message-ID du premier message :
      // les réponses le citeront dans leur In-Reply-To.
      threadId: params.references ?? resultat.messageId,
    };
  } catch (e) {
    if (e instanceof ErreurSmtp) throw e;
    throw new ErreurSmtp(
      `Envoi SMTP échoué : ${e instanceof Error ? e.message : String(e)}`,
      { compte, destinataire: params.a },
    );
  } finally {
    envoi.close();
  }
}

/** Vérifie que le serveur accepte les identifiants (script de test). */
export async function verifierAccesSmtp(compte: CompteGmail): Promise<string> {
  const { envoi, adresse } = transport(compte);
  try {
    await envoi.verify();
    return adresse;
  } catch (e) {
    throw new ErreurSmtp(
      `Connexion SMTP refusée : ${e instanceof Error ? e.message : String(e)}`,
      { compte },
    );
  } finally {
    envoi.close();
  }
}
