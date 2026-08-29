/**
 * Exécute le job de relance client sur l'état courant de la base.
 *
 * N'envoie que ce que le job déciderait d'envoyer : la garde d'alerte
 * préalable et la fenêtre d'échéance s'appliquent normalement.
 *
 * Usage : npm run essai:relance-client
 */
import { relanceClientExpiration } from '../apps/worker/src/jobs/relanceClientExpiration.js';

import { chargerEnv } from './charger-env.js';

async function main(): Promise<void> {
  chargerEnv();
  const envois = await relanceClientExpiration();
  console.log(`\n→ ${envois} relance(s) envoyée(s).\n`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
