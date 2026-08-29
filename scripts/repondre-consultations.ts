/**
 * Simule la réponse des fournisseurs à une demande, pour dérouler la suite.
 *
 * POURQUOI CE SCRIPT EXISTE
 *
 * Éprouver le costing, l'offre et les documents suppose des devis reçus. Or
 * les obtenir pour de vrai demanderait d'écrire à de vraies entreprises et
 * d'attendre leur réponse — ce que la règle du projet interdit, et ce qu'un
 * essai ne peut pas se permettre d'attendre.
 *
 * `injecter-devis-essai` existait déjà, mais ses références sont écrites en dur
 * pour une seule affaire. Celui-ci lit les articles RÉELLEMENT consultés et
 * chiffre ce qu'il y trouve : il fonctionne sur n'importe quelle demande.
 *
 * IL N'ENVOIE RIEN. Il écrit exactement ce qu'écrit le formulaire fournisseur
 * (`/devis/[token]`) : un devis, ses lignes, le passage de la consultation en
 * « devis_recu », la notification et la trace d'audit. Le chemin d'après —
 * comparatif, marge, offre — ne voit aucune différence.
 *
 * AUCUN PRIX N'EST CALCULÉ ICI au-delà du prix d'achat unitaire : les montants
 * nets et les totaux sont des colonnes générées en base, et deux calculs
 * concurrents divergent au premier arrondi.
 *
 * Usage :
 *   npm run essai:repondre                       # dernière demande consultée
 *   npm run essai:repondre -- DM-2026-000032
 *   npm run essai:repondre -- DM-2026-000032 --supprimer
 */
import { chargerEnv } from './charger-env.js';

/** Marque les devis simulés, pour pouvoir les retirer sans ambiguïté. */
const MARQUEUR = 'SIM';

/**
 * Prix d'achat de référence, en MAD, par famille de matériel.
 *
 * Ordres de grandeur du marché marocain, à la louche assumée : ce qui compte
 * pour éprouver le comparatif n'est pas leur exactitude mais leur DISPERSION —
 * un onduleur ne doit pas coûter le prix d'un commutateur, sinon la sélection
 * ligne par ligne n'a rien à départager.
 */
const PRIX_REFERENCE: { motif: RegExp; prix: number }[] = [
  { motif: /pare-?feu|firewall|fortigate/i, prix: 42_000 },
  { motif: /commutateur|switch/i, prix: 21_500 },
  { motif: /borne|point d.acc|access point|wifi/i, prix: 3_800 },
  { motif: /enregistreur|nvr|dvr/i, prix: 14_000 },
  { motif: /cam[ée]ra/i, prix: 1_650 },
  { motif: /onduleur|ups/i, prix: 27_000 },
  { motif: /portable|laptop|thinkpad/i, prix: 9_400 },
  { motif: /poste|desktop|station|thinkcentre/i, prix: 6_800 },
  { motif: /baie|stockage|nas|serveur/i, prix: 38_000 },
  { motif: /licence|abonnement|maintenance/i, prix: 5_200 },
];

const PRIX_DEFAUT = 4_500;

function prixReference(designation: string): number {
  return PRIX_REFERENCE.find((p) => p.motif.test(designation))?.prix ?? PRIX_DEFAUT;
}

/**
 * Écart appliqué au prix de référence, dérivé de l'identifiant de consultation
 * ET de celui de l'article.
 *
 * Déterministe : deux exécutions produisent les mêmes prix, sinon le comparatif
 * changerait de gagnant à chaque relance et rien ne serait reproductible.
 *
 * Croisé sur les deux identifiants pour qu'AUCUN FOURNISSEUR NE GAGNE SUR TOUTE
 * LA LIGNE. C'est ce que la plateforme doit savoir montrer : le meilleur prix
 * se choisit article par article, pas devis par devis.
 */
function ecart(consultationId: number, articleId: number): number {
  const graine = (consultationId * 31 + articleId * 17) % 23;
  return 0.88 + (graine / 23) * 0.28; // entre −12 % et +16 %
}

const DELAIS = ['15 jours ouvrés', '3 semaines', '10 jours ouvrés', '4 semaines'];
const PAIEMENTS = ['30 jours fin de mois', '50 % commande, solde livraison', 'Comptant'];
const GARANTIES = ['3 ans retour atelier', '3 ans sur site J+1', '5 ans constructeur'];

async function main(): Promise<void> {
  chargerEnv();

  const args = process.argv.slice(2);
  const supprimer = args.includes('--supprimer');
  const code = args.find((a) => /^DM-/i.test(a));

  const { clientAdmin, tenantId } = await import('@vigon/services');
  const db = clientAdmin();
  const tenant = await tenantId();

  /* --- La demande visée ---------------------------------------------------- */

  const requete = db
    .from('demandes')
    .select('id, code, titre, statut')
    .eq('tenant_id', tenant);

  const { data: demande } = code
    ? await requete.eq('code', code.toUpperCase()).maybeSingle()
    : await requete
        .in('statut', ['envoyee_fournisseurs', 'devis_partiels'])
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

  if (!demande) {
    console.error(
      `\n✗ ${code ? `Demande ${code} introuvable.` : 'Aucune demande au stade « envoyée aux fournisseurs ».'}\n`,
    );
    process.exit(1);
  }

  console.log(`\n${demande.code} — ${demande.titre ?? ''}`);
  console.log(`statut : ${demande.statut}\n`);

  /* --- Retrait ------------------------------------------------------------- */

  if (supprimer) {
    const { data: devis } = await db
      .from('devis_fournisseur')
      .select('id, numero_devis')
      .eq('demande_id', demande.id)
      .like('numero_devis', `DV-${MARQUEUR}-%`);

    if (!devis || devis.length === 0) {
      console.log('Aucun devis simulé à retirer.\n');
      return;
    }

    const ids = devis.map((d) => d.id);

    // Les lignes d'abord : la clé étrangère refuserait la suppression du devis.
    await db.from('lignes_devis').delete().in('devis_id', ids);
    await db.from('devis_fournisseur').delete().in('id', ids);

    // Les consultations retournent à l'état d'attente, sinon la demande resterait
    // « devis reçus » sans aucun devis.
    await db
      .from('consultations')
      .update({ statut: 'envoyee', date_reponse: null })
      .eq('demande_id', demande.id)
      .eq('statut', 'devis_recu');

    console.log(`${ids.length} devis simulé(s) retiré(s), consultations remises en attente.\n`);
    return;
  }

  /* --- Consultations à honorer --------------------------------------------- */

  const { data: consultations } = await db
    .from('consultations')
    .select('id, marque, fournisseur_nom, statut')
    .eq('demande_id', demande.id)
    .eq('tenant_id', tenant)
    .in('statut', ['envoyee', 'relancee', 'precision_demandee'])
    .order('id');

  if (!consultations || consultations.length === 0) {
    console.log('Aucune consultation en attente de réponse.\n');
    return;
  }

  let devisCrees = 0;
  let lignesCrees = 0;

  for (const consultation of consultations) {
    // Les articles réellement soumis à CE fournisseur, pas ceux de la demande :
    // un devis qui chiffre ce qu'on ne lui a pas demandé n'existe pas.
    const { data: liens } = await db
      .from('consultation_items')
      .select('demande_item_id')
      .eq('consultation_id', consultation.id);

    const ids = (liens ?? []).map((l) => l.demande_item_id);
    if (ids.length === 0) {
      console.log(`  ${consultation.marque} : aucun article rattaché, ignorée.`);
      continue;
    }

    const { data: articles } = await db
      .from('demande_items')
      .select('id, designation, reference, marque, quantite, unite')
      .in('id', ids);

    if (!articles || articles.length === 0) continue;

    const numero = `DV-${MARQUEUR}-${consultation.id}`;

    const { data: devis, error: erreurDevis } = await db
      .from('devis_fournisseur')
      .insert({
        tenant_id: tenant,
        consultation_id: consultation.id,
        demande_id: demande.id,
        numero_devis: numero,
        date_devis: new Date().toISOString().slice(0, 10),
        devise: 'MAD',
        validite_offre: '30 jours',
        delai_livraison: DELAIS[consultation.id % DELAIS.length]!,
        conditions_paiement: PAIEMENTS[consultation.id % PAIEMENTS.length]!,
        garantie: GARANTIES[consultation.id % GARANTIES.length]!,
        source: 'formulaire',
        statut_extraction: 'ok',
        // Comme le formulaire : le fournisseur a saisi lui-même, rien n'a été
        // deviné, donc aucune ligne à relire pour doute d'extraction.
        confiance_globale: 1,
      })
      .select('id')
      .single();

    if (erreurDevis || !devis) {
      console.log(`  ${consultation.marque} : échec — ${erreurDevis?.message}`);
      continue;
    }

    const lignes = articles.map((article) => ({
      devis_id: devis.id,
      demande_item_id: article.id,
      designation_fournisseur: article.designation,
      reference: article.reference,
      fabricant: article.marque,
      quantite: Number(article.quantite),
      unite: article.unite ?? 'u',
      // Seul prix posé ici. Le net et les totaux sont des colonnes générées.
      prix_achat_ht:
        Math.round(prixReference(article.designation) * ecart(consultation.id, article.id) * 100) /
        100,
      remise_pct: consultation.id % 3 === 0 ? 5 : 0,
      disponibilite: article.id % 4 === 0 ? 'Sur commande' : 'En stock',
      mapping_type: 'exact',
      confiance_ia: 1,
    }));

    const { error: erreurLignes } = await db.from('lignes_devis').insert(lignes);

    if (erreurLignes) {
      // Un devis sans lignes bloque toute nouvelle réponse : on le retire,
      // exactement comme le fait le formulaire.
      await db.from('devis_fournisseur').delete().eq('id', devis.id);
      console.log(`  ${consultation.marque} : lignes refusées — ${erreurLignes.message}`);
      continue;
    }

    await db
      .from('consultations')
      .update({ statut: 'devis_recu', date_reponse: new Date().toISOString() })
      .eq('id', consultation.id);

    await db.from('notifications').insert({
      tenant_id: tenant,
      role_cible: 'presale',
      type: 'devis_recu',
      severite: 'info',
      titre: `Devis simulé — ${consultation.fournisseur_nom ?? consultation.marque}`,
      message: `${lignes.length} ligne(s) chiffrée(s) par ${MARQUEUR}.`,
      lien: `/demandes/${demande.id}/costing`,
      demande_id: demande.id,
    });

    await db.from('audit_events').insert({
      tenant_id: tenant,
      entite: 'devis_fournisseur',
      entite_id: devis.id,
      action: 'devis.saisi_formulaire',
      acteur_type: 'fournisseur',
      details: { consultation_id: consultation.id, lignes: lignes.length, simule: true },
    });

    // Vectorisation, comme le fait le formulaire : ce que ce fournisseur vient
    // de chiffrer enrichit la recherche sémantique des prochaines demandes.
    //
    // Oubliée à la première écriture de ce script, et rattrapée par
    // `essai:rag` — « 33 vecteurs pour 49 lignes ». Un simulateur qui écrit
    // presque ce qu'écrit le vrai chemin laisse la base dans un état que la
    // production ne produit jamais, et fait mentir tout ce qui la lit ensuite.
    //
    // Échec avalé, comme dans le formulaire : le devis est enregistré, c'est ce
    // qui compte, et `indexer:historique` rattrape.
    try {
      const { indexerDevis } = await import('@vigon/services');
      await indexerDevis(tenant, [devis.id]);
    } catch (e) {
      console.log(`     indexation ignorée : ${e instanceof Error ? e.message : e}`);
    }

    const total = lignes.reduce((s, l) => s + l.prix_achat_ht * l.quantite, 0);
    console.log(
      `  ${(consultation.marque ?? '—').padEnd(11)} ${String(lignes.length).padStart(2)} ligne(s)  ${total.toLocaleString('fr-FR', { maximumFractionDigits: 0 }).padStart(12)} MAD HT  →  ${numero}`,
    );

    devisCrees += 1;
    lignesCrees += lignes.length;
  }

  /* --- Statut de la demande ------------------------------------------------ */

  const { count: restantes } = await db
    .from('consultations')
    .select('id', { count: 'exact', head: true })
    .eq('demande_id', demande.id)
    .in('statut', ['envoyee', 'relancee', 'precision_demandee', 'planifiee']);

  const statut = (restantes ?? 0) > 0 ? 'devis_partiels' : 'devis_recus';

  await db
    .from('demandes')
    .update({ statut, date_premier_devis: new Date().toISOString() })
    .eq('id', demande.id)
    .eq('tenant_id', tenant);

  console.log(
    `\n${devisCrees} devis, ${lignesCrees} ligne(s). Demande → « ${statut} »` +
      ((restantes ?? 0) > 0 ? ` (${restantes} consultation(s) encore en attente)` : ''),
  );
  console.log(`Suite : /demandes/${demande.id}/costing\n`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
