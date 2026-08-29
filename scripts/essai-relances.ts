/**
 * Éprouve le job de relances sur des consultations fabriquées.
 *
 * Deux cas sont montés puis rejoués par le vrai job :
 *   A. compteur au plafond  -> doit passer « sans_reponse » + notifier PRESALE
 *   B. compteur à 0, échue  -> doit être retenue pour relance
 *
 * Les données de test sont supprimées à la fin, y compris en cas d'échec.
 *
 * Usage : npm run essai:relances
 */
import { clientAdmin, descriptionEnvoi, envoiConfigure, lireParametres, tenantId } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

const MARQUE_A = '__ESSAI_PLAFOND__';
const MARQUE_B = '__ESSAI_DUE__';

async function nettoyer(tenant: string): Promise<void> {
  const db = clientAdmin();
  const { data } = await db
    .from('consultations')
    .select('id')
    .eq('tenant_id', tenant)
    .in('marque', [MARQUE_A, MARQUE_B]);

  for (const c of data ?? []) {
    await db.from('communications').delete().eq('consultation_id', c.id);
    await db.from('audit_events').delete().eq('entite', 'consultations').eq('entite_id', c.id);
    await db.from('consultations').delete().eq('id', c.id);
  }
  await db.from('notifications').delete().in('type', [
    'consultation_sans_reponse',
    'relance_impossible',
    'relance_echouee',
  ]);
}

async function main(): Promise<void> {
  chargerEnv();

  const db = clientAdmin();
  const tenant = await tenantId();
  const parametres = await lireParametres(tenant);

  console.log(
    `Paramètres lus en base : max_relances=${parametres.maxRelances}, ` +
      `delai_relance_heures=${parametres.delaiRelanceHeures}`,
  );
  console.log(
    // Le job décide sur `envoiConfigure`, qui couvre SMTP autant que l'API
    // Gmail : interroger `gmailConfigure` faisait attendre au test un report
    // d'échéance alors que la relance partait bel et bien par SMTP.
    `Transport fournisseur : ${
      envoiConfigure('fournisseur') ? descriptionEnvoi('fournisseur') : 'AUCUN'
    }\n`,
  );

  await nettoyer(tenant);

  const { data: demande } = await db
    .from('demandes')
    .select('id')
    .eq('tenant_id', tenant)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!demande) {
    console.log('Aucune demande pour rattacher les consultations de test.');
    return;
  }

  const echu = new Date(Date.now() - 3_600_000).toISOString();

  const { error: insertion } = await db.from('consultations').insert([
    {
      tenant_id: tenant,
      demande_id: demande.id,
      marque: MARQUE_A,
      fournisseur_nom: 'Fournisseur muet',
      fournisseur_email: 'muet@essai-vigon.test',
      sujet: 'Demande de devis (essai plafond)',
      corps_html: '<p>essai</p>',
      statut: 'relancee',
      thread_id: 'thread-essai-a',
      message_id: 'msg-essai-a',
      relances: parametres.maxRelances,
      prochaine_relance: echu,
    },
    {
      tenant_id: tenant,
      demande_id: demande.id,
      marque: MARQUE_B,
      fournisseur_nom: 'Fournisseur lent',
      fournisseur_email: 'lent@essai-vigon.test',
      sujet: 'Demande de devis (essai due)',
      corps_html: '<p>essai</p>',
      statut: 'envoyee',
      thread_id: 'thread-essai-b',
      message_id: 'msg-essai-b',
      relances: 0,
      prochaine_relance: echu,
    },
  ]);

  if (insertion) throw new Error(`Montage impossible : ${insertion.message}`);
  console.log('Cas montés :');
  console.log(`  A ${MARQUE_A} — relances=${parametres.maxRelances} (plafond), échue`);
  console.log(`  B ${MARQUE_B} — relances=0, échue\n`);

  // Le job réel, pas une réimplémentation.
  const { processRelances } = await import('../apps/worker/src/jobs/processRelances.js');
  const traitees = await processRelances();

  console.log(`\nprocessRelances() a traité ${traitees} consultation(s).\n`);

  const { data: apres } = await db
    .from('consultations')
    .select('marque, statut, relances, prochaine_relance')
    .eq('tenant_id', tenant)
    .in('marque', [MARQUE_A, MARQUE_B])
    .order('marque');

  console.log('=== État après passage ===');
  for (const c of apres ?? []) {
    console.log(
      `  ${c.marque}: statut=${c.statut} relances=${c.relances} ` +
        `prochaine=${c.prochaine_relance ? 'oui' : 'aucune'}`,
    );
  }

  const { data: notifs } = await db
    .from('notifications')
    .select('type, titre')
    .eq('tenant_id', tenant)
    .in('type', ['consultation_sans_reponse', 'relance_impossible', 'relance_echouee']);

  console.log('\n=== Notifications PRESALE ===');
  for (const n of notifs ?? []) console.log(`  [${n.type}] ${n.titre}`);
  if ((notifs ?? []).length === 0) console.log('  (aucune)');

  const a = (apres ?? []).find((c) => c.marque === MARQUE_A);
  const b = (apres ?? []).find((c) => c.marque === MARQUE_B);

  console.log('\n=== Contrôles ===');
  const okA = a?.statut === 'sans_reponse' && a?.prochaine_relance === null;
  console.log(
    `  ${okA ? '✓' : '✗'} A : plafond atteint -> sans_reponse, plus d'échéance`,
  );

  const okB = envoiConfigure('fournisseur')
    ? b?.statut === 'relancee' && (b?.relances ?? 0) === 1
    : b?.statut === 'envoyee' && (b?.relances ?? 0) === 0;
  console.log(
    `  ${okB ? '✓' : '✗'} B : ${
      envoiConfigure('fournisseur')
        ? 'relance envoyée, compteur à 1'
        : 'sans transport, échéance conservée et compteur intact'
    }`,
  );

  await nettoyer(tenant);
  console.log('\nDonnées de test supprimées.');

  if (!okA || !okB) process.exit(1);
}

main().catch(async (e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  try {
    await nettoyer(await tenantId());
    console.error('Données de test supprimées malgré l’échec.');
  } catch {
    console.error('Nettoyage impossible — vérifier les lignes __ESSAI_*__.');
  }
  process.exit(1);
});
