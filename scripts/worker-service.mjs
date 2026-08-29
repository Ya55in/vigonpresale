/**
 * Installe le worker comme service macOS (launchd), ou le retire.
 *
 * `npm run dev` suffit pendant le développement. Ce service répond à un autre
 * besoin : la boîte avant-vente continue de recevoir des demandes quand
 * personne ne développe. Sans lui, fermer le terminal arrête la réception, et
 * les messages s'accumulent sans que rien ne le signale.
 *
 * launchd plutôt qu'un cron : il relance le processus s'il meurt (`KeepAlive`)
 * et le démarre à l'ouverture de session, ce que cron ne sait pas faire.
 *
 * Usage : npm run worker:service          (installer et démarrer)
 *         npm run worker:service -- stop  (arrêter et désinstaller)
 *         npm run worker:service -- etat  (état et journaux)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ETIQUETTE = 'ma.vigon.presale.worker';
const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS = resolve(homedir(), 'Library/LaunchAgents');
const PLIST = resolve(AGENTS, `${ETIQUETTE}.plist`);
const JOURNAL = resolve(RACINE, 'logs');

const action = process.argv[2] ?? 'start';

/** `launchctl` renvoie un code non nul quand le service est absent : c'est légitime. */
function launchctl(...args) {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8' }).trim();
  } catch (e) {
    return e.stdout?.toString().trim() ?? '';
  }
}

function cheminNpm() {
  try {
    return execFileSync('which', ['npm'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error("npm introuvable dans le PATH — impossible d'écrire le service.");
  }
}

function installer() {
  const npm = cheminNpm();
  mkdirSync(AGENTS, { recursive: true });
  mkdirSync(JOURNAL, { recursive: true });

  // `start` et non `dev` : pas de rechargement à chaud pour un service, et
  // surtout pas de surveillance de fichiers qui tournerait en permanence.
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${ETIQUETTE}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${npm}</string>
    <string>run</string>
    <string>start</string>
    <string>--workspace=@vigon/worker</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${RACINE}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  <string>${JOURNAL}/worker.log</string>
  <key>StandardErrorPath</key>
  <string>${JOURNAL}/worker.err.log</string>
</dict>
</plist>
`;

  writeFileSync(PLIST, plist);

  // Rechargement systématique : réinstaller doit prendre en compte un chemin
  // de projet qui aurait changé.
  launchctl('bootout', `gui/${process.getuid()}/${ETIQUETTE}`);
  launchctl('bootstrap', `gui/${process.getuid()}`, PLIST);

  console.info(`✓ Service « ${ETIQUETTE} » installé et démarré.`);
  console.info(`  Démarre à l'ouverture de session, se relance s'il plante.`);
  console.info(`  Journaux : ${JOURNAL}/worker.log`);
  console.info(`  Arrêter  : npm run worker:service -- stop`);
}

function desinstaller() {
  launchctl('bootout', `gui/${process.getuid()}/${ETIQUETTE}`);
  if (existsSync(PLIST)) unlinkSync(PLIST);
  console.info(`✓ Service « ${ETIQUETTE} » arrêté et retiré.`);
}

function etat() {
  const sortie = launchctl('print', `gui/${process.getuid()}/${ETIQUETTE}`);

  if (!sortie || /could not find/i.test(sortie)) {
    console.info('Service non installé. Pour l\'installer : npm run worker:service');
    return;
  }

  const pid = sortie.match(/\bpid = (\d+)/)?.[1];
  const dernier = sortie.match(/last exit code = (\d+)/)?.[1];

  console.info(`Service « ${ETIQUETTE} »`);
  console.info(`  état          : ${pid ? `en cours (PID ${pid})` : 'arrêté'}`);
  if (dernier) console.info(`  dernier code  : ${dernier}`);
  console.info(`  journaux      : ${JOURNAL}/worker.log`);
}

if (process.platform !== 'darwin') {
  console.error('Ce script cible macOS (launchd). Sur Linux, utiliser systemd.');
  process.exit(1);
}

try {
  if (action === 'stop') desinstaller();
  else if (action === 'etat') etat();
  else installer();
} catch (e) {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
