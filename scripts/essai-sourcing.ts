/**
 * Éprouve le sourcing des fournisseurs sur de vraies marques.
 *
 * Usage : npm run essai:sourcing -- Cisco APC Ubiquiti
 * Sans argument, reprend les marques des articles de la dernière demande.
 */
import { clientAdmin, resoudreFournisseurs, tenantId } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

async function marquesParDefaut(): Promise<string[]> {
  const db = clientAdmin();

  const { data: demande } = await db
    .from('demandes')
    .select('id, code')
    .eq('statut', 'specs_extraites')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!demande) return [];

  const { data: articles } = await db
    .from('demande_items')
    .select('marque')
    .eq('demande_id', demande.id);

  console.log(`Marques de la demande ${demande.code} :`);
  return [...new Set((articles ?? []).map((a) => a.marque).filter((m): m is string => Boolean(m)))];
}

async function main(): Promise<void> {
  chargerEnv();

  const tenant = await tenantId();
  const marques = process.argv.slice(2).length
    ? process.argv.slice(2)
    : await marquesParDefaut();

  if (marques.length === 0) {
    console.log('Aucune marque à résoudre.');
    return;
  }

  console.log(`${marques.join(', ')}\n`);
  const debut = Date.now();
  const resultat = await resoudreFournisseurs(tenant, marques);

  for (const f of resultat.resolus) {
    console.log(`✓ ${f.marque.padEnd(12)} ${f.nom} <${f.email}>  [${f.source}]`);
  }
  for (const n of resultat.nonResolues) {
    console.log(`✗ ${n.marque.padEnd(12)} ${n.motif}`);
  }

  console.log(
    `\n${resultat.resolus.length} résolue(s), ${resultat.nonResolues.length} en échec — ${Math.round((Date.now() - debut) / 1000)} s.`,
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
