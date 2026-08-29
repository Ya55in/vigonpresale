/**
 * Supprime les demandes bloquées, après sauvegarde sur disque.
 *
 * POURQUOI CE SCRIPT EXISTE
 *
 * Une demande bloquée n'est pas toujours récupérable : un accusé automatique,
 * une notification de service, un message d'essai n'ont aucun contenu à extraire
 * et se rebloqueront au même motif à chaque reprise. Les laisser encombre la
 * liste et fausse le compteur du tableau de bord.
 *
 * `relancer-bloquees` couvre le cas inverse — une demande réelle, bloquée par
 * une panne depuis réparée. **Essayer la relance avant la purge** : ce script-ci
 * ne rend rien.
 *
 * CE QU'IL FAIT AVANT DE SUPPRIMER
 *
 * Il écrit l'intégralité de ce qu'il va détruire — demandes, communications,
 * notifications — dans un fichier JSON horodaté. Une suppression en base est
 * définitive ; le coût d'une sauvegarde est de trois secondes, celui d'un
 * regret est une consultation client perdue.
 *
 * L'ORDRE COMPTE : les lignes filles d'abord. Une suppression de demande dont
 * les communications subsistent échoue sur la contrainte de clé étrangère, et
 * l'échec arrive à mi-parcours, sur une base à moitié nettoyée.
 *
 * Usage :
 *   npm run purger:bloquees              # liste ce qui serait supprimé
 *   APPLIQUER=1 npm run purger:bloquees  # sauvegarde puis supprime
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chargerEnv, ROOT } from './charger-env.js';

const APPLIQUER = process.env.APPLIQUER === '1';

/** Tables portant une `demande_id`, filles d'abord. */
const TABLES_FILLES = ['communications', 'notifications'] as const;

async function main(): Promise<void> {
  chargerEnv();

  const { clientAdmin, tenantId } = await import('@vigon/services');

  const tenant = await tenantId();
  const db = clientAdmin();

  const { data: bloquees, error } = await db
    .from('demandes')
    .select('*')
    .eq('tenant_id', tenant)
    .eq('statut', 'bloquee')
    .order('id');

  if (error) throw new Error(`Lecture des demandes bloquées : ${error.message}`);
  if (!bloquees || bloquees.length === 0) {
    console.log('\nAucune demande bloquée.\n');
    return;
  }

  const ids = bloquees.map((d) => d.id);

  console.log(`\n${bloquees.length} demande(s) bloquée(s) :\n`);
  for (const d of bloquees) {
    console.log(
      `  #${String(d.id).padStart(3)} ${d.code}  ${(d.sujet_original ?? '').slice(0, 60)}`,
    );
  }

  // Relevé des filles avant tout, pour la sauvegarde comme pour le décompte.
  const filles: Record<string, unknown[]> = {};
  console.log('\nLignes liées :');
  for (const table of TABLES_FILLES) {
    const { data } = await db.from(table).select('*').in('demande_id', ids);
    filles[table] = data ?? [];
    console.log(`  ${table.padEnd(16)} ${(data ?? []).length}`);
  }

  if (!APPLIQUER) {
    console.log('\nSimulation. Relancer avec APPLIQUER=1 pour supprimer.\n');
    return;
  }

  const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
  const sauvegarde = resolve(ROOT, `sauvegarde-demandes-bloquees-${horodatage}.json`);

  writeFileSync(
    sauvegarde,
    JSON.stringify({ genere_le: new Date().toISOString(), tenant, demandes: bloquees, ...filles }, null, 2),
    'utf8',
  );
  console.log(`\nSauvegarde écrite : ${sauvegarde}`);

  console.log('\n--- Suppression ---');

  for (const table of TABLES_FILLES) {
    const { error: e } = await db.from(table).delete().in('demande_id', ids);
    if (e) throw new Error(`Suppression dans ${table} : ${e.message}`);
    console.log(`  ${table.padEnd(16)} ${filles[table]!.length} ligne(s) supprimée(s)`);
  }

  // L'audit référence la demande par `entite_id`, sans clé étrangère : les
  // événements survivent volontairement à la ligne. Un journal qui disparaît
  // avec ce qu'il journalise ne sert à rien — c'est la trace de la suppression
  // elle-même qu'on veut pouvoir relire.
  await db.from('audit_events').insert(
    bloquees.map((d) => ({
      tenant_id: tenant,
      entite: 'demandes',
      entite_id: d.id,
      action: 'demande.supprimee',
      acteur_type: 'worker',
      details: {
        code: d.code,
        sujet: d.sujet_original,
        motif_blocage: d.motif_blocage,
        sauvegarde,
      },
    })),
  );

  const { error: eDemandes } = await db
    .from('demandes')
    .delete()
    .eq('tenant_id', tenant)
    .in('id', ids)
    // Garde : seules les lignes encore bloquées partent. Une demande relancée
    // entre le relevé et la suppression n'est plus du bruit.
    .eq('statut', 'bloquee');

  if (eDemandes) throw new Error(`Suppression des demandes : ${eDemandes.message}`);
  console.log(`  demandes         ${ids.length} ligne(s) supprimée(s)`);

  const { data: restantes } = await db
    .from('demandes')
    .select('code')
    .eq('tenant_id', tenant)
    .eq('statut', 'bloquee');

  console.log(
    `\n--- État final ---\n  demandes bloquées restantes : ${(restantes ?? []).length}\n`,
  );
}

main().catch((e) => {
  console.error('\n✗ Échec :', e);
  process.exit(1);
});
