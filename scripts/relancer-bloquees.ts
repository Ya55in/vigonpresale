/**
 * Remet en flux les demandes bloquées, puis fait tourner le job de reprise.
 *
 * POURQUOI CE SCRIPT EXISTE
 *
 * Le retrait du modèle `llama-3.3-70b-versatile` par Groq a bloqué six demandes
 * d'un coup. La cause a été réparée le jour même — chaîne de secours, choix du
 * modèle dans le catalogue réel — mais rien ne ramenait les demandes : `bloquee`
 * n'avait aucune sortie. Le bouton « Relancer l'extraction » couvre désormais le
 * cas à l'unité ; ce script couvre l'arriéré.
 *
 * IL NE SUPPRIME RIEN. Une demande sans contenu exploitable — notification de
 * service, accusé automatique — se rebloquera au même motif : c'est le
 * comportement attendu, et le filtre `estCourrierAutomatique` empêche les
 * suivantes d'entrer. Le tri de l'existant reste une décision humaine.
 *
 * L'événement d'audit `demande.debloquee` est écrit exactement comme le fait
 * l'application : c'est lui qui rend la demande reprenable sans attendre la
 * temporisation de dix minutes.
 *
 * Usage :
 *   npm run relancer:bloquees              # liste ce qui serait relancé
 *   APPLIQUER=1 npm run relancer:bloquees  # relance réellement
 */
import { chargerEnv } from './charger-env.js';

const APPLIQUER = process.env.APPLIQUER === '1';

async function main(): Promise<void> {
  chargerEnv();

  const { chargerSecrets, clientAdmin, tenantId } = await import('@vigon/services');
  const { reprendreExtractions } = await import(
    '../apps/worker/src/jobs/reprendreExtractions.js'
  );

  const tenant = await tenantId();
  const db = clientAdmin();

  // Les clés vivent dans /admin : sans ce chargement, la reprise appellerait un
  // fournisseur non configuré et rebloquerait tout ce qu'elle vient de libérer.
  await chargerSecrets(tenant);

  const { data: bloquees, error } = await db
    .from('demandes')
    .select('id, code, sujet_original, contenu_consolide, motif_blocage')
    .eq('tenant_id', tenant)
    .eq('statut', 'bloquee')
    .order('id');

  if (error) throw new Error(`Lecture des demandes bloquées : ${error.message}`);
  if (!bloquees || bloquees.length === 0) {
    console.log('\nAucune demande bloquée.\n');
    return;
  }

  console.log(`\n${bloquees.length} demande(s) bloquée(s) :\n`);
  for (const d of bloquees) {
    const taille = d.contenu_consolide?.trim().length ?? 0;
    console.log(
      `  ${d.code}  ${String(taille).padStart(5)} car.  ${(d.sujet_original ?? '').slice(0, 58)}`,
    );
  }

  if (!APPLIQUER) {
    console.log('\nSimulation. Relancer avec APPLIQUER=1 pour agir.\n');
    return;
  }

  console.log('\n--- Remise en « nouvelle » ---');

  let remises = 0;
  for (const d of bloquees) {
    const { data: repris } = await db
      .from('demandes')
      .update({ statut: 'nouvelle', motif_blocage: null })
      .eq('id', d.id)
      .eq('tenant_id', tenant)
      .eq('statut', 'bloquee')
      .select('id');

    if (!repris || repris.length === 0) {
      console.log(`  ${d.code} : déjà repris ailleurs, ignoré.`);
      continue;
    }

    await db.from('audit_events').insert({
      tenant_id: tenant,
      entite: 'demandes',
      entite_id: d.id,
      action: 'demande.debloquee',
      acteur_type: 'worker',
      details: { code: d.code, origine: 'relancer-bloquees', motif_precedent: d.motif_blocage },
    });

    console.log(`  ${d.code} : remise en flux.`);
    remises += 1;
  }

  console.log(`\n--- Reprise des ${remises} demande(s), par lots ---`);

  // Boucle jusqu'à épuisement : le job traite un petit lot par appel, comme il
  // le fait toutes les deux minutes dans le worker. On l'appelle LUI, pas une
  // copie — un chemin d'essai qui diverge du chemin réel ne prouve rien.
  let total = 0;
  for (let cycle = 1; cycle <= 20; cycle += 1) {
    const traites = await reprendreExtractions();
    if (traites === 0) break;
    total += traites;
    console.log(`  cycle ${cycle} : ${traites} extraction(s)`);
  }

  console.log(`\n${total} extraction(s) tentée(s).\n--- État final ---`);

  const { data: apres } = await db
    .from('demandes')
    .select('code, statut, motif_blocage')
    .eq('tenant_id', tenant)
    .in('id', bloquees.map((d) => d.id))
    .order('code');

  for (const d of apres ?? []) {
    console.log(
      `  ${d.code}  ${d.statut.padEnd(16)} ${(d.motif_blocage ?? '').slice(0, 70)}`,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error('\n✗ Échec :', e);
  process.exit(1);
});
