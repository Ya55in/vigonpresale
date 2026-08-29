import type { MessageEntrant } from './imap.js';

/**
 * Reconnaissance du courrier automatique : notifications, infolettres, envois
 * de masse — tout ce qui arrive dans la boîte sans qu'un humain l'ait écrit.
 *
 * POURQUOI CE MODULE EXISTE
 *
 * La boîte avant-vente reçoit aussi le courrier de service des comptes qu'on y
 * a inscrits. Trois demandes bloquées l'ont montré le 19/08 : « Welcome to
 * Facebook », « Did you just add this phone number? », « Welcome to Meta for
 * Developers » sont devenues des demandes, ont consommé un appel au modèle,
 * n'ont produit aucun article, et se sont bloquées. Chacune réclamait ensuite
 * une décision humaine pour rien.
 *
 * `estRebond` couvrait déjà les avis de non-remise. Ce module couvre l'autre
 * famille, et suit la même règle : la décision repose sur ce que l'EXPÉDITEUR
 * DÉCLARE dans ses en-têtes, jamais sur une lecture du texte. Un modèle à qui
 * l'on demande « est-ce une demande commerciale ? » répondra un jour oui sur
 * une infolettre de distributeur qui liste des références produit.
 *
 * LE RISQUE ASSUMÉ, ET SA BORNE
 *
 * Un message écarté ici ne crée pas de demande : s'il s'agissait d'une vraie
 * consultation, elle est perdue. Le risque est borné en n'utilisant que des
 * signaux qu'aucun correspondant humain ne pose sur un message rédigé à la
 * main — un client qui envoie un appel d'offres depuis son client de messagerie
 * n'a ni `List-Unsubscribe`, ni `Precedence: bulk`, ni `Auto-Submitted`.
 *
 * Volontairement ABSENT de la liste : l'adresse en `noreply@`. Certains portails
 * d'achat publient leurs consultations depuis une adresse de ce type, et elles
 * sont parfaitement réelles.
 *
 * L'écart est journalisé avec l'expéditeur et l'objet : un tri qu'on ne peut
 * pas relire est un tri qu'on ne peut pas corriger.
 */

/** Valeurs de `Precedence` qui désignent un envoi non individuel (usage établi). */
const PRESEANCES_MASSE = ['bulk', 'list', 'junk', 'auto_reply'];

export type VerdictAutomatique = {
  /** Vrai si le message ne doit pas devenir une demande. */
  automatique: boolean;
  /** L'en-tête qui a tranché, pour le journal. */
  motif: string;
};

/**
 * Le message est-il émis par une machine plutôt que par un correspondant ?
 *
 * Trois signaux, tous déclaratifs :
 *  1. `Auto-Submitted` autre que `no` — la définition même d'un message généré
 *     sans intervention humaine (RFC 3834) ;
 *  2. `List-Id` ou `List-Unsubscribe` — le message appartient à une diffusion,
 *     et un envoi qu'on peut « désabonner » n'est pas une consultation ;
 *  3. `Precedence` de masse — convention antérieure aux deux précédentes, encore
 *     posée par la plupart des plateformes de notification ;
 *  4. `X-Auto-Response-Suppress` — « ne génère aucune réponse automatique à ce
 *     message ». Ajouté le 2026-08-20 sur preuve : « Confirm your business
 *     email », de `notification@facebookmail.com`, a franchi les trois premiers
 *     signaux. Ses en-têtes ont été relus dans la boîte — ni `Auto-Submitted`,
 *     ni `Precedence`, ni `List-*`, mais bien `X-Auto-Response-Suppress: All`.
 *
 *     Une confirmation d'adresse n'a pas de lien de désabonnement : on ne se
 *     désabonne pas d'un message de sécurité. C'est ce qui la faisait passer,
 *     et c'est pourquoi il fallait un quatrième signal plutôt qu'élargir les
 *     trois autres.
 *
 *     L'en-tête vient d'Exchange et s'est répandu. Il est posé sur le courrier
 *     émis par une machine, jamais par quelqu'un qui écrit depuis son client de
 *     messagerie : un humain n'a aucune raison de demander qu'on ne lui réponde
 *     pas automatiquement.
 *
 * CE QUE CETTE LISTE NE COUVRIRA JAMAIS
 *
 * Un expéditeur qui ne déclare rien. Aucun en-tête ne trahit alors la machine,
 * et le message deviendra une demande sans article, donc bloquée — ce qui est
 * le comportement correct, seulement bruyant. Le remède est en aval :
 * `relancer:bloquees` et `purger:bloquees`. Élargir le tri par le contenu
 * coûterait de vraies affaires, ce qui est bien plus cher.
 */
export function estCourrierAutomatique(message: MessageEntrant): VerdictAutomatique {
  if (message.autoSoumis !== null && message.autoSoumis !== 'no') {
    return { automatique: true, motif: `Auto-Submitted: ${message.autoSoumis}` };
  }

  if (message.listeDiffusion) {
    return { automatique: true, motif: 'List-Id / List-Unsubscribe' };
  }

  if (message.preseance !== null && PRESEANCES_MASSE.includes(message.preseance)) {
    return { automatique: true, motif: `Precedence: ${message.preseance}` };
  }

  if (message.reponsesAutoSupprimees) {
    return { automatique: true, motif: 'X-Auto-Response-Suppress' };
  }

  return { automatique: false, motif: '' };
}
