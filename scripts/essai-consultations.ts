/**
 * Prépare les consultations d'une demande et affiche le résultat.
 *
 * Exerce le même chemin que la Server Action « Préparer les consultations »,
 * sans passer par le navigateur.
 *
 * Usage : npm run essai:consultations -- [id_demande]
 */
import { clientAdmin, genererConsultations, tenantId } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

async function main(): Promise<void> {
  chargerEnv();

  const db = clientAdmin();
  const tenant = await tenantId();
  const argId = Number.parseInt(process.argv[2] ?? '', 10);

  const { data: demande } = Number.isFinite(argId)
    ? await db.from('demandes').select('id, code').eq('id', argId).maybeSingle()
    : await db
        .from('demandes')
        .select('id, code')
        .eq('tenant_id', tenant)
        .in('statut', ['specs_extraites', 'en_validation_rfq'])
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

  if (!demande) {
    console.log('Aucune demande éligible.');
    return;
  }

  const { data: articles } = await db
    .from('demande_items')
    .select('id, designation, reference, marque, quantite')
    .eq('demande_id', demande.id);

  if (!articles || articles.length === 0) {
    console.log(`Demande ${demande.code} sans article.`);
    return;
  }

  console.log(`Demande ${demande.code} — ${articles.length} article(s)\n`);
  const debut = Date.now();

  const resultat = await genererConsultations({
    demandeId: demande.id,
    tenant,
    articles: articles.map((a) => ({
      // `id` est requis depuis que les articles consultés sont persistés dans
      // `consultation_items` : sans lui, le formulaire de réponse en ligne
      // n'aurait aucun article à présenter au fournisseur.
      id: a.id,
      designation: a.designation,
      reference: a.reference,
      marque: a.marque,
      quantite: Number(a.quantite),
    })),
  });

  console.log(`✓ ${resultat.creees} consultation(s) créée(s)`);
  if (resultat.ignorees > 0) console.log(`– ${resultat.ignorees} déjà existante(s)`);
  for (const n of resultat.nonResolues) {
    console.log(`✗ ${n.marque.padEnd(12)} ${n.motif}`);
  }
  for (const e of resultat.erreurs) {
    console.log(`! ${e.marque.padEnd(12)} ${e.motif}`);
  }

  console.log(`\nDurée : ${Math.round((Date.now() - debut) / 1000)} s`);

  const { data: consultations } = await db
    .from('consultations')
    .select('marque, fournisseur_email, sujet, statut')
    .eq('demande_id', demande.id)
    .order('marque');

  console.log('\nConsultations en base :');
  for (const c of consultations ?? []) {
    console.log(`  [${c.statut}] ${c.marque} -> ${c.fournisseur_email}`);
    console.log(`      « ${c.sujet} »`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
