/**
 * Crée les buckets Supabase Storage attendus par la plateforme.
 *
 * Idempotent : un bucket déjà présent est laissé tel quel. Tous sont privés —
 * les pièces jointes et les offres contiennent des données commerciales, l'accès
 * passe par des URLs signées à durée limitée.
 *
 * Usage : npm run init:storage
 */
import { clientAdmin } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

const BUCKETS = [
  { nom: 'pieces-jointes', tailleMaxMo: 25 },
  { nom: 'offres', tailleMaxMo: 50 },
  { nom: 'logos', tailleMaxMo: 5 },
] as const;

async function main(): Promise<void> {
  chargerEnv();

  const storage = clientAdmin().storage;

  const { data: existants, error } = await storage.listBuckets();
  if (error) {
    throw new Error(`Impossible de lister les buckets : ${error.message}`);
  }

  const deja = new Set((existants ?? []).map((b) => b.name));

  for (const { nom, tailleMaxMo } of BUCKETS) {
    if (deja.has(nom)) {
      console.log(`– ${nom.padEnd(16)} déjà présent`);
      continue;
    }

    const { error: creation } = await storage.createBucket(nom, {
      public: false,
      fileSizeLimit: `${tailleMaxMo}MB`,
    });

    if (creation) {
      throw new Error(`Création de « ${nom} » impossible : ${creation.message}`);
    }
    console.log(`✓ ${nom.padEnd(16)} créé (privé, ${tailleMaxMo} Mo max)`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
