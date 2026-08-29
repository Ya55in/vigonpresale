/**
 * Lance l'application web et le worker ensemble.
 *
 * APPELÉ EXPLICITEMENT SEULEMENT — `npm run dev` ne lance plus que le web
 * depuis le 2026-08-27. Le worker fait de vrais envois (RFQ, relances,
 * courriels) dès qu'il tourne ; le lancer sans le vouloir a produit une
 * relance réelle vers quatre fournisseurs pendant une session de travail sur
 * l'interface, personne ne surveillant la boîte. Voir
 * docs/RAPPORT-DEVELOPPEMENT.md#lancement-separe.
 *
 * Le worker reste indispensable en usage réel — sans lui aucune demande
 * n'entre, aucune RFQ ne part — mais c'est désormais un geste voulu
 * (`npm run dev:worker`), jamais un effet de bord de `npm run dev`.
 *
 * Superviseur écrit à la main plutôt que `concurrently` : la dépendance
 * n'apporterait que le préfixage, et surtout ne relancerait pas le worker après
 * un plantage — c'est précisément ce qu'on attend ici, pour qui choisit
 * délibérément de lancer les deux ensemble.
 *
 * Usage : npm run dev:tout     (les deux, avec relance automatique du worker)
 *         npm run dev          (web seule)
 *         npm run dev:worker   (worker seul, sans relance automatique)
 */
import { spawn, spawnSync } from 'node:child_process';

/** Délai avant relance, en millisecondes, doublé à chaque échec consécutif. */
const ATTENTE_INITIALE = 1_000;
const ATTENTE_MAX = 30_000;

/**
 * Au-delà de ce délai en fonctionnement, on considère le processus reparti sain
 * et la temporisation repart de zéro. Sans ça, un plantage isolé après des
 * heures de service hériterait du délai d'un incident ancien.
 */
const DUREE_STABLE = 60_000;

const COULEURS = { web: '\x1b[36m', worker: '\x1b[35m' };
const NEUTRE = '\x1b[0m';

const SERVICES = [
  { nom: 'web', args: ['run', 'dev', '--workspace=@vigon/web'], relancer: false },
  { nom: 'worker', args: ['run', 'dev', '--workspace=@vigon/worker'], relancer: true },
];

const processus = new Map();
let arretDemande = false;

/**
 * Workers déjà en cours, hors de cette session.
 *
 * Un worker survit à son lanceur dès que celui-ci meurt sans passer par
 * `tout_arreter` — fermeture du terminal, `kill -9`, veille de la machine. Il
 * continue alors de relever la boîte et d'envoyer des RFQ, invisible.
 *
 * Le laisser cohabiter avec un nouveau, c'est faire tourner chaque job en
 * double : deux demandes de devis au même fournisseur, deux relances, deux
 * courriels au client. Les gardes d'idempotence reposent sur une lecture puis
 * une écriture, et deux workers synchronisés sur la même minute passent entre
 * les deux.
 */
function workersOrphelins() {
  const r = spawnSync('pgrep', ['-f', 'tsx watch src/index.ts'], { encoding: 'utf8' });

  return (r.stdout ?? '')
    .split('\n')
    .map((l) => Number(l.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

/** Nom lisible d'un processus, pour que le message dise de quoi il s'agit. */
function decrire(pid) {
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
  const depuis = (r.stdout ?? '').trim();
  return depuis ? `pid ${pid}, démarré ${depuis}` : `pid ${pid}`;
}

function verifierInstanceUnique() {
  const orphelins = workersOrphelins();
  if (orphelins.length === 0) return;

  console.error(
    `\n[dev] ${orphelins.length} worker(s) déjà en cours :\n` +
      orphelins.map((p) => `        ${decrire(p)}`).join('\n') +
      `\n
      Un worker survit à son lanceur quand le terminal est fermé sans Ctrl-C.
      En démarrer un second ferait tourner chaque job en double : deux RFQ au
      même fournisseur, deux relances, deux courriels au client.

      Arrêtez-le puis relancez :
        kill ${orphelins.join(' ')}\n`,
  );

  process.exit(1);
}

function ecrire(nom, flux, donnees) {
  const prefixe = `${COULEURS[nom] ?? ''}[${nom}]${NEUTRE} `;
  for (const ligne of donnees.toString().split('\n')) {
    if (ligne.trim()) flux.write(`${prefixe}${ligne}\n`);
  }
}

function demarrer(service, attente = ATTENTE_INITIALE) {
  const enfant = spawn('npm', service.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  processus.set(service.nom, enfant);
  const demarreA = Date.now();

  enfant.stdout.on('data', (d) => ecrire(service.nom, process.stdout, d));
  enfant.stderr.on('data', (d) => ecrire(service.nom, process.stderr, d));

  enfant.on('exit', (code, signal) => {
    processus.delete(service.nom);
    if (arretDemande) return;

    const raison = signal ? `signal ${signal}` : `code ${code}`;

    // Le serveur Next qui s'arrête est un arrêt volontaire : le relancer
    // masquerait une erreur de compilation derrière une boucle silencieuse.
    if (!service.relancer) {
      console.error(`[dev] « ${service.nom} » s'est arrêté (${raison}).`);
      tout_arreter(typeof code === 'number' ? code : 1);
      return;
    }

    const stable = Date.now() - demarreA > DUREE_STABLE;
    const prochaine = stable
      ? ATTENTE_INITIALE
      : Math.min(attente * 2, ATTENTE_MAX);

    console.error(
      `[dev] « ${service.nom} » s'est arrêté (${raison}) — relance dans ${Math.round(prochaine / 1000)} s.`,
    );

    setTimeout(() => {
      if (!arretDemande) demarrer(service, prochaine);
    }, prochaine).unref();
  });

  enfant.on('error', (e) => {
    console.error(`[dev] « ${service.nom} » injoignable : ${e.message}`);
  });
}

function tout_arreter(code) {
  if (arretDemande) return;
  arretDemande = true;

  for (const [nom, enfant] of processus) {
    // SIGTERM : le worker l'intercepte pour terminer proprement son cycle.
    enfant.kill('SIGTERM');
    void nom;
  }

  // Filet de sécurité si un enfant ignore SIGTERM.
  setTimeout(() => {
    for (const [, enfant] of processus) enfant.kill('SIGKILL');
    process.exit(code);
  }, 5_000).unref();

  const attendre = setInterval(() => {
    if (processus.size === 0) {
      clearInterval(attendre);
      process.exit(code);
    }
  }, 100);
}

// SIGHUP est le signal du terminal qu'on ferme, et c'est LE cas qui produisait
// des workers orphelins : Node le traite par défaut en terminant le processus
// sur-le-champ, donc `tout_arreter` n'était jamais exécuté et les enfants
// survivaient. SIGQUIT (Ctrl-\) a le même effet.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
  process.on(signal, () => {
    console.info(`\n[dev] ${signal} reçu, arrêt des deux services.`);
    tout_arreter(0);
  });
}

// Dernier filet : `kill -9` et une panne de courant ne laissent aucune chance
// d'exécuter quoi que ce soit. `exit` couvre au moins les sorties non signalées
// — exception non rattrapée, `process.exit()` appelé ailleurs.
process.on('exit', () => {
  for (const [, enfant] of processus) {
    try {
      enfant.kill('SIGKILL');
    } catch {
      // Le processus a déjà disparu : rien à faire.
    }
  }
});

verifierInstanceUnique();

console.info('[dev] Démarrage de l\'application web et du worker.');
for (const service of SERVICES) demarrer(service);
