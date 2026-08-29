/**
 * Éprouve la planification puis la sélection faite par le job d'envoi.
 *
 * Reproduit les transitions de la Server Action « planifierEnvoi », puis rejoue
 * la requête de sendScheduledRfq pour montrer ce qui partirait — sans appeler
 * Gmail. Restaure l'état initial à la fin.
 *
 * Usage : npm run essai:planification -- [id_demande] [minutes]
 */
import { clientAdmin, gmailConfigure, tenantId } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

async function main(): Promise<void> {
  chargerEnv();

  const db = clientAdmin();
  const tenant = await tenantId();

  const argId = Number.parseInt(process.argv[2] ?? '', 10);
  const minutes = Number.parseInt(process.argv[3] ?? '0', 10) || 0;

  const { data: demande } = Number.isFinite(argId)
    ? await db.from('demandes').select('id, code, statut').eq('id', argId).maybeSingle()
    : await db
        .from('demandes')
        .select('id, code, statut')
        .eq('tenant_id', tenant)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

  if (!demande) {
    console.log('Aucune demande.');
    return;
  }

  const quand = new Date(Date.now() + minutes * 60_000);
  console.log(`Demande ${demande.code} — planification à ${quand.toLocaleString('fr-FR')}\n`);

  // --- 1. Planification (mêmes transitions que la Server Action) ---
  const { data: planifiees, error } = await db
    .from('consultations')
    .update({
      statut: 'planifiee',
      envoi_immediat: minutes === 0,
      date_envoi_prevue: quand.toISOString(),
    })
    .eq('demande_id', demande.id)
    .eq('tenant_id', tenant)
    .eq('statut', 'en_validation')
    .select('id, marque');

  if (error) throw new Error(error.message);
  console.log(`✓ ${planifiees?.length ?? 0} consultation(s) planifiée(s)`);
  for (const c of planifiees ?? []) console.log(`    ${c.marque}`);

  await db
    .from('demandes')
    .update({ statut: 'planifiee' })
    .eq('id', demande.id)
    .eq('tenant_id', tenant);

  // --- 2. Sélection du job d'envoi ---
  const { data: dues } = await db
    .from('consultations')
    .select('id, marque, fournisseur_email, sujet, date_envoi_prevue')
    .eq('tenant_id', tenant)
    .eq('statut', 'planifiee')
    .lte('date_envoi_prevue', new Date().toISOString())
    .order('date_envoi_prevue', { ascending: true })
    .limit(10);

  console.log(`\n=== Ce que le worker enverrait maintenant (${dues?.length ?? 0}) ===`);
  for (const c of dues ?? []) {
    console.log(`  -> ${c.fournisseur_email}`);
    console.log(`     « ${c.sujet} »`);
  }

  if ((dues?.length ?? 0) === 0 && minutes > 0) {
    console.log('  (aucune : échéance dans le futur, comportement attendu)');
  }

  console.log(
    `\nGmail fournisseur configuré : ${gmailConfigure('fournisseur') ? 'oui' : 'NON — envoi impossible'}`,
  );

  // --- 3. Restauration ---
  await db
    .from('consultations')
    .update({ statut: 'en_validation', date_envoi_prevue: null, envoi_immediat: true })
    .eq('demande_id', demande.id)
    .eq('tenant_id', tenant)
    .eq('statut', 'planifiee');

  await db
    .from('demandes')
    .update({ statut: demande.statut })
    .eq('id', demande.id)
    .eq('tenant_id', tenant);

  console.log('\nÉtat initial restauré.');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
