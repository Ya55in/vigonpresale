/**
 * Point d'entrée du worker : polling IMAP et jobs planifiés.
 *
 * Chaque job est protégé contre le chevauchement — un cycle plus lent que son
 * intervalle ne doit jamais s'exécuter deux fois en parallèle, sous peine de
 * traiter le même message concurremment.
 */
import cron from 'node-cron';

import {
  assurerChaine,
  chargerSecrets,
  descriptionEnvoi,
  descriptionIA,
  envoiConfigure,
  imapConfigure,
  tenantId,
} from '@vigon/services';

import { chargerEnv } from './env.js';
import { pollClientMailbox } from './jobs/pollClientMailbox.js';
import { expireOffres } from './jobs/expireOffres.js';
import { processRelances } from './jobs/processRelances.js';
import { rappelOffresNonConsultees } from './jobs/rappelOffresNonConsultees.js';
import { relanceClientExpiration } from './jobs/relanceClientExpiration.js';
import { reprendreExtractions } from './jobs/reprendreExtractions.js';
import { sendScheduledRfq } from './jobs/sendScheduledRfq.js';

/** Jobs en cours, par nom : garde anti-chevauchement. */
const enCours = new Set<string>();

async function executer(nom: string, job: () => Promise<number>): Promise<void> {
  if (enCours.has(nom)) {
    console.warn(`[${nom}] cycle précédent encore en cours, passage ignoré.`);
    return;
  }

  enCours.add(nom);
  const debut = Date.now();

  try {
    // Les clés modifiées depuis l'application deviennent actives sans
    // redémarrage : le cache interne borne le coût à une requête par minute.
    await chargerSecrets(await tenantId());

    const traites = await job();
    if (traites > 0) {
      console.info(`[${nom}] ${traites} message(s) traité(s) en ${Date.now() - debut} ms.`);
    }
  } catch (e) {
    console.error(`[${nom}] ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    enCours.delete(nom);
  }
}

async function demarrer(): Promise<void> {
  chargerEnv();

  console.info('[vigon-worker] Démarrage');

  try {
    // Les deux temps sont indispensables et dans cet ordre : les clés vivent
    // dans /admin, et la chaîne s'en déduit. Sans eux, `descriptionIA()`
    // retombait sur l'ancien `AI_PROVIDER` et annonçait au démarrage un
    // fournisseur qui n'était pas celui qui allait servir.
    await chargerSecrets(await tenantId());
    await assurerChaine();
    console.info(`[vigon-worker] Fournisseur IA : ${descriptionIA()}`);
  } catch (e) {
    console.error(
      `[vigon-worker] Aucun fournisseur IA utilisable : ${e instanceof Error ? e.message : e}`,
    );
  }

  // Flux étape 1 : relève de la boîte avant-vente toutes les 60 secondes.
  if (imapConfigure()) {
    cron.schedule('* * * * *', () => {
      void executer('reception', pollClientMailbox);
    });
    console.info('[vigon-worker] Job « reception » planifié (toutes les 60 s).');

    // Premier passage immédiat : évite d'attendre une minute au démarrage.
    void executer('reception', pollClientMailbox);
  } else {
    console.error(
      '[vigon-worker] IMAP non configuré (IMAP_CLIENT_*) — réception désactivée.',
    );
  }

  // Reprise des extractions restées en plan : quota épuisé au passage précédent,
  // ou déblocage demandé depuis l'écran de la demande.
  //
  // Planifié même sans IMAP : les demandes à reprendre sont déjà en base, et
  // rien dans ce job ne dépend de la boîte.
  cron.schedule('*/2 * * * *', () => {
    void executer('reprise', reprendreExtractions);
  });
  console.info('[vigon-worker] Job « reprise » planifié (toutes les 2 min).');

  void executer('reprise', reprendreExtractions);

  // Flux étape 5 : envoi des demandes de devis dont l'heure est venue.
  if (envoiConfigure('fournisseur')) {
    cron.schedule('* * * * *', () => {
      void executer('envoi-rfq', sendScheduledRfq);
    });
    console.info(
      `[vigon-worker] Job « envoi-rfq » planifié (toutes les 60 s) — ${descriptionEnvoi('fournisseur')}.`,
    );

    void executer('envoi-rfq', sendScheduledRfq);
  } else {
    console.error(
      '[vigon-worker] Aucun transport fournisseur (SMTP_FOURNISSEUR_* / IMAP_CLIENT_* / GMAIL_FOURNISSEUR_*) — envoi des RFQ désactivé.',
    );
  }

  // Flux étape 6 : relances toutes les 5 minutes.
  //
  // Planifié même sans Gmail : le passage à « sans_reponse » après épuisement
  // des rappels ne dépend d'aucun envoi et doit continuer de fonctionner.
  cron.schedule('*/5 * * * *', () => {
    void executer('relances', processRelances);
  });
  console.info('[vigon-worker] Job « relances » planifié (toutes les 5 min).');

  void executer('relances', processRelances);

  // Flux étape 12 : expiration des offres, une fois par jour à 7 h.
  //
  // Tôt le matin plutôt qu'à minuit : PRESALE trouve les notifications en
  // arrivant, et une offre expirée dans la nuit n'attend pas une journée.
  cron.schedule('0 7 * * *', () => {
    void executer('expiration', expireOffres);
  });
  console.info('[vigon-worker] Job « expiration » planifié (chaque jour à 7 h).');

  void executer('expiration', expireOffres);

  // Rappel des offres jamais ouvertes, à 8 h — après l'expiration, pour ne pas
  // alerter sur une offre que le cycle précédent vient de clore.
  cron.schedule('0 8 * * *', () => {
    void executer('rappel-offres', rappelOffresNonConsultees);
  });
  console.info('[vigon-worker] Job « rappel-offres » planifié (chaque jour à 8 h).');

  void executer('rappel-offres', rappelOffresNonConsultees);

  // Relance du client à l'approche de l'échéance, à 9 h — après « rappel-offres »
  // dont elle dépend : une offre jamais ouverte n'est relancée qu'une fois
  // l'administration prévenue, et cet ordre le garantit dès le premier jour.
  cron.schedule('0 9 * * *', () => {
    void executer('relance-client', relanceClientExpiration);
  });
  console.info('[vigon-worker] Job « relance-client » planifié (chaque jour à 9 h).');

  void executer('relance-client', relanceClientExpiration);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.info(`[vigon-worker] ${signal} reçu, arrêt.`);
    process.exit(0);
  });
}

// `void` assumé : `demarrer` capture déjà ses propres échecs, et une promesse
// rejetée ici tuerait le processus au lieu de laisser les jobs planifiés vivre.
void demarrer();
