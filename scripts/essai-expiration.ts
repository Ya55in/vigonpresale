/**
 * Éprouve le job d'expiration des offres.
 *
 * Deux cas montés puis rejoués par le vrai job :
 *   A. offre jamais consultée, échue -> perdue, motif « Offre non consultée »
 *   B. offre consultée sans décision -> perdue, motif distinct
 * Un troisième cas contrôle qu'une offre approuvée n'est PAS expirée.
 *
 * Les données de test sont supprimées à la fin, même en cas d'échec.
 *
 * Usage : npm run essai:expiration
 */
import { clientAdmin, tenantId } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

const PREFIXE = 'PR-ESSAI-EXP';

async function nettoyer(tenant: string): Promise<void> {
  const db = clientAdmin();

  const { data: offres } = await db
    .from('offres')
    .select('id, demande_id')
    .eq('tenant_id', tenant)
    .like('numero', `${PREFIXE}%`);

  for (const o of offres ?? []) {
    await db.from('offre_consultations').delete().eq('offre_id', o.id);
    await db.from('notifications').delete().eq('offre_id', o.id);
    await db.from('audit_events').delete().eq('entite', 'offres').eq('entite_id', o.id);
    await db.from('offres').delete().eq('id', o.id);
  }
}

async function main(): Promise<void> {
  chargerEnv();

  const db = clientAdmin();
  const tenant = await tenantId();

  await nettoyer(tenant);

  const { data: demande } = await db
    .from('demandes')
    .select('id, statut, motif_perte')
    .eq('tenant_id', tenant)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!demande) {
    console.log('Aucune demande pour rattacher les offres de test.');
    return;
  }

  // On mémorise l'état de la demande pour le restaurer : le job va le modifier.
  const etatInitial = { statut: demande.statut, motif: demande.motif_perte };

  const hier = new Date(Date.now() - 86_400_000).toISOString();
  const jeton = (suffixe: string) => `essai-expiration-token-${suffixe}-${Date.now()}`;

  const cas = [
    {
      numero: `${PREFIXE}-A`,
      statut: 'envoyee' as const,
      date_consultation: null,
      attendu: 'Offre non consultée',
    },
    {
      numero: `${PREFIXE}-B`,
      statut: 'consultee' as const,
      date_consultation: hier,
      attendu: 'Offre consultée mais sans décision avant expiration',
    },
    {
      numero: `${PREFIXE}-C`,
      statut: 'approuvee' as const,
      date_consultation: hier,
      attendu: null, // ne doit PAS expirer
    },
  ];

  for (const c of cas) {
    const { error } = await db.from('offres').insert({
      tenant_id: tenant,
      demande_id: demande.id,
      numero: c.numero,
      version: 1,
      titre: 'Offre de test expiration',
      token_public: jeton(c.numero),
      statut: c.statut,
      date_expiration: hier,
      date_consultation: c.date_consultation,
      source_json: { referenceOffre: c.numero },
    });
    if (error) throw new Error(`Montage ${c.numero} : ${error.message}`);
  }

  console.log('Cas montés (tous échus depuis hier) :');
  for (const c of cas) {
    console.log(`  ${c.numero} — statut ${c.statut}${c.attendu ? '' : ' (ne doit pas expirer)'}`);
  }
  console.log();

  const { expireOffres } = await import('../apps/worker/src/jobs/expireOffres.js');
  const closes = await expireOffres();

  console.log(`expireOffres() a clos ${closes} offre(s).\n`);

  const { data: apres } = await db
    .from('offres')
    .select('numero, statut')
    .eq('tenant_id', tenant)
    .like('numero', `${PREFIXE}%`)
    .order('numero');

  const { data: notifs } = await db
    .from('notifications')
    .select('titre, message')
    .eq('tenant_id', tenant)
    .eq('type', 'offre_expiree');

  const { data: audits } = await db
    .from('audit_events')
    .select('details')
    .eq('tenant_id', tenant)
    .eq('action', 'offre.expiree');

  console.log('=== État après passage ===');
  for (const o of apres ?? []) console.log(`  ${o.numero} : ${o.statut}`);

  console.log('\n=== Motifs enregistrés ===');
  for (const a of audits ?? []) {
    const d = a.details as { numero?: string; motif?: string; consultee?: boolean } | null;
    console.log(`  ${d?.numero} : « ${d?.motif} » (consultée : ${d?.consultee})`);
  }

  console.log('\n=== Notifications PRESALE ===');
  for (const n of notifs ?? []) console.log(`  ${n.titre} — ${n.message}`);

  console.log('\n=== Contrôles ===');
  const etat = new Map((apres ?? []).map((o) => [o.numero, o.statut]));
  const motifs = new Map(
    (audits ?? []).map((a) => {
      const d = a.details as { numero?: string; motif?: string } | null;
      return [d?.numero ?? '', d?.motif ?? ''];
    }),
  );

  let echecs = 0;
  for (const c of cas) {
    const statut = etat.get(c.numero);
    const ok = c.attendu
      ? statut === 'expiree' && motifs.get(c.numero) === c.attendu
      : statut === 'approuvee';
    if (!ok) echecs += 1;
    console.log(
      `  ${ok ? '✓' : '✗'} ${c.numero} : ${
        c.attendu ? `expirée, motif « ${c.attendu} »` : 'approuvée, non expirée'
      } — obtenu ${statut}`,
    );
  }

  // La demande a été marquée perdue par le job : on restaure son état réel.
  await db
    .from('demandes')
    .update({ statut: etatInitial.statut, motif_perte: etatInitial.motif })
    .eq('id', demande.id);

  await nettoyer(tenant);
  console.log(
    `\nDonnées de test supprimées, demande restaurée en « ${etatInitial.statut} ».`,
  );

  if (echecs > 0) process.exit(1);
}

main().catch(async (e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  try {
    await nettoyer(await tenantId());
    console.error('Données de test supprimées malgré l’échec.');
  } catch {
    console.error('Nettoyage impossible — vérifier les offres PR-ESSAI-EXP.');
  }
  process.exit(1);
});
