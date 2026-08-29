/**
 * Vectorise l'historique des devis déjà en base.
 *
 * À lancer une fois après la migration pgvector, puis après tout changement de
 * modèle d'embedding. L'indexation courante est automatique — chaque devis reçu
 * vectorise ses lignes — donc ce script ne sert qu'au premier remplissage et au
 * rattrapage.
 *
 * Rejouable sans dégât : les lignes déjà vectorisées sont ignorées.
 *
 * Usage : npm run indexer:historique
 */
import { clientAdmin, embeddingsConfigures, indexerHistorique, tenantId } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

async function main(): Promise<void> {
  chargerEnv();

  if (!embeddingsConfigures()) {
    console.error('\n✗ GEMINI_API_KEY absente : impossible de vectoriser.\n');
    process.exit(1);
  }

  const tenant = await tenantId();
  const db = clientAdmin();

  const { count: avant } = await db
    .from('fournisseur_embeddings')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant);

  const { count: lignes } = await db
    .from('lignes_devis')
    .select('id', { count: 'exact', head: true });

  console.log(`\nlignes de devis en base : ${lignes ?? 0}`);
  console.log(`déjà vectorisées        : ${avant ?? 0}`);
  console.log('\nIndexation en cours — un appel par ligne, séquentiel…\n');

  const debut = Date.now();
  const bilan = await indexerHistorique(tenant);
  const duree = ((Date.now() - debut) / 1000).toFixed(1);

  console.log(`  indexées : ${bilan.indexees}`);
  console.log(`  ignorées : ${bilan.ignorees} (déjà vectorisées)`);
  console.log(`  échecs   : ${bilan.echecs}`);
  console.log(`  durée    : ${duree} s`);

  const { count: apres } = await db
    .from('fournisseur_embeddings')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant);

  console.log(`\n${bilan.echecs === 0 ? '✓' : '⚠'} Index : ${apres ?? 0} vecteur(s).\n`);
  if (bilan.echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
