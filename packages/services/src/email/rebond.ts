import type { MessageEntrant } from './imap.js';

/**
 * Reconnaissance des avis de non-remise (bounces).
 *
 * Détection **déterministe**, jamais confiée au modèle : un rebond est une
 * propriété structurelle du message, pas une nuance de rédaction. Le modèle,
 * lui, voit un texte qui cite notre demande de devis et le classe volontiers
 * comme une réponse du fournisseur — la consultation passe alors pour répondue
 * alors que personne ne l'a jamais reçue.
 */

/** Comptes techniques qui émettent les rapports de remise. */
const EXPEDITEURS_TECHNIQUES = ['mailer-daemon', 'postmaster'];

/**
 * Motifs d'objet des principaux serveurs, en repli quand les en-têtes
 * manquent. Volontairement ancrés sur des formulations de rapport, pour ne pas
 * attraper un fournisseur qui parlerait d'un « échec de livraison » de matériel.
 */
const OBJETS_REBOND = [
  'delivery status notification',
  'undelivered mail returned to sender',
  'mail delivery failed',
  'delivery has failed',
  'returned mail',
  'undeliverable',
  'échec de la remise',
  'echec de la remise',
  'avis de non-remise',
];

/**
 * Vrai si le message est un avis de non-remise.
 *
 * Trois signaux, du plus fiable au moins fiable :
 *  1. `Content-Type: multipart/report; report-type=delivery-status` — la
 *     définition même d'un rapport de remise (RFC 3464) ;
 *  2. l'expéditeur est un compte technique (`MAILER-DAEMON`, `postmaster`) ;
 *  3. l'objet correspond à un rapport connu **et** le message se déclare
 *     automatique — les deux ensemble, pour éviter les faux positifs.
 */
export function estRebond(message: MessageEntrant): boolean {
  if (message.typeContenu === 'multipart/report' && message.typeRapport === 'delivery-status') {
    return true;
  }

  const partieLocale = message.expediteur.toLowerCase().split('@')[0] ?? '';
  if (EXPEDITEURS_TECHNIQUES.includes(partieLocale)) return true;

  const objet = message.sujet.toLowerCase();
  const objetConnu = OBJETS_REBOND.some((motif) => objet.includes(motif));

  return objetConnu && message.autoSoumis !== null && message.autoSoumis !== 'no';
}
