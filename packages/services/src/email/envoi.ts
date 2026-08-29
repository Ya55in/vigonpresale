import {
  envoyerEmail as envoyerViaGmail,
  gmailConfigure,
  modifierLabelSuivi,
  type CompteGmail,
  type MessageEnvoye,
  type PieceJointeEnvoi,
} from './gmail.js';
import {
  envoyerEmailSmtp,
  smtpAdresse,
  smtpConfigure,
  verifierAccesSmtp,
} from './smtp.js';

/**
 * Point d'entrée unique pour l'envoi de courriels.
 *
 * Deux transports possibles, choisis automatiquement :
 *
 *  - **Gmail API** si un `refresh_token` est disponible. Seul transport capable
 *    de poser le label de suivi et de renvoyer un vrai `threadId`.
 *  - **SMTP** sinon, avec un mot de passe d'application. Suffisant pour tout le
 *    flux : l'appariement des réponses repose sur `Message-ID` / `In-Reply-To`,
 *    des en-têtes standards que Gmail respecte comme tout autre serveur.
 *
 * L'appelant n'a pas à savoir lequel est actif : c'est ce qui permet de démarrer
 * avec un simple mot de passe d'application et de passer à l'API plus tard sans
 * toucher aux jobs.
 */

export type Transport = 'gmail' | 'smtp';

export function transportActif(compte: CompteGmail): Transport | null {
  if (gmailConfigure(compte)) return 'gmail';
  if (smtpConfigure(compte)) return 'smtp';
  return null;
}

export function envoiConfigure(compte: CompteGmail): boolean {
  return transportActif(compte) !== null;
}

/** Décrit le transport actif, pour l'interface et les scripts de test. */
export function descriptionEnvoi(compte: CompteGmail): string {
  const transport = transportActif(compte);
  if (!transport) return 'non configuré';
  if (transport === 'gmail') return 'Gmail API';
  return `SMTP (${smtpAdresse(compte) ?? '?'})`;
}

export async function envoyer(
  compte: CompteGmail,
  params: {
    a: string;
    /**
     * Contacts en copie visible, en plus du destinataire principal.
     *
     * Optionnelle : un appelant qui l'ignore produit exactement le message
     * d'avant. Visible et non cachée — les contacts d'un même fournisseur
     * doivent se voir entre eux, c'est une correspondance commerciale ordinaire.
     */
    cc?: string[];
    sujet: string;
    html: string;
    texte?: string;
    /** Identifiant de fil Gmail ; ignoré en SMTP. */
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    /**
     * Fichiers joints, portés en mémoire.
     *
     * Les deux transports les gèrent — Gmail par une enveloppe multipart, SMTP
     * par nodemailer. Sans pièce jointe, chacun produit exactement le message
     * qu'il produisait avant : le flux existant n'est pas emballé pour rien.
     */
    piecesJointes?: PieceJointeEnvoi[];
    /**
     * En-têtes supplémentaires.
     *
     * Existe pour les HARNAIS D'ESSAI, qui écrivent dans la boîte de la
     * plateforme elle-même : sans `Auto-Submitted: auto-generated`, leur message
     * revient par la relève, devient une demande, consomme un appel au modèle et
     * se bloque faute d'articles. Quatre demandes fantômes sont nées ainsi.
     *
     * Le stamper est plus honnête qu'un cas particulier dans `pollClientMailbox` :
     * ces messages SONT générés sans intervention humaine, et `estCourrierAutomatique`
     * n'a aucune raison de les traiter autrement que les autres.
     */
    entetes?: Record<string, string>;
  },
): Promise<MessageEnvoye & { transport: Transport }> {
  const transport = transportActif(compte);

  if (!transport) {
    throw new Error(
      `Aucun transport pour le compte « ${compte} » : renseigner un mot de passe ` +
        `d'application SMTP ou un refresh token Gmail.`,
    );
  }

  const message =
    transport === 'gmail'
      ? await envoyerViaGmail(compte, params)
      : await envoyerEmailSmtp(compte, params);

  return { ...message, transport };
}

/**
 * Pose ou retire le label de suivi, quand le transport le permet.
 *
 * En SMTP le label n'existe pas : l'absence n'est pas une erreur, car le
 * périmètre de relance est déjà déterminé par le statut de la consultation.
 * Renvoie `false` quand rien n'a été fait.
 */
export async function marquerSuivi(
  compte: CompteGmail,
  messageId: string,
  action: 'ajouter' | 'retirer',
): Promise<boolean> {
  if (!gmailConfigure(compte)) return false;

  await modifierLabelSuivi(compte, messageId, action);
  return true;
}

/** Vérifie que le transport actif répond (script de test). */
export async function verifierEnvoi(compte: CompteGmail): Promise<string> {
  const transport = transportActif(compte);
  if (!transport) throw new Error(`Compte « ${compte} » non configuré.`);

  if (transport === 'smtp') return `SMTP — ${await verifierAccesSmtp(compte)}`;

  const { verifierAcces } = await import('./gmail.js');
  return `Gmail API — ${await verifierAcces(compte)}`;
}
