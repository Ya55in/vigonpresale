/**
 * Injecte des devis fournisseurs de test, en simulant la sortie de l'étape 8.
 *
 * Sert à rendre l'étape 9 (costing) vérifiable avant que la réception réelle
 * des devis soit branchée. Un distributeur généraliste chiffre plusieurs
 * marques : c'est ce qui permet d'éprouver la comparaison des prix et la mise
 * en évidence du meilleur.
 *
 * Idempotent : relancer ne crée pas de doublon.
 *
 * Usage   : npm run essai:devis
 * Retrait : npm run essai:devis -- --supprimer
 */
import { clientAdmin, tenantId } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

/** Marque les données de test pour pouvoir les retirer sans ambiguïté. */
const MARQUEUR = 'ESSAI';

type LigneOfferte = {
  /** Référence de l'article de la demande auquel la ligne se rattache. */
  reference: string;
  prixAchatHt: number;
  remisePct?: number;
  disponibilite: string;
  /** exact quand la référence correspond, alternative sinon. */
  mappingType?: 'exact' | 'alternative';
  designation?: string;
};

type DevisEssai = {
  marque: string;
  numero: string;
  delaiLivraison: string;
  conditionsPaiement: string;
  lignes: LigneOfferte[];
};

/**
 * Le généraliste est volontairement plus cher sur le switch et moins cher sur
 * l'onduleur : aucun fournisseur ne gagne sur toute la ligne, ce qui force la
 * sélection ligne par ligne prévue par la spec.
 */
const DEVIS: DevisEssai[] = [
  {
    marque: 'Cisco',
    numero: `DV-${MARQUEUR}-C001`,
    delaiLivraison: '10 jours ouvrés',
    conditionsPaiement: '30 jours fin de mois',
    lignes: [
      {
        reference: 'C9200L-48P-4G-E',
        prixAchatHt: 24500,
        remisePct: 5,
        disponibilite: 'En stock',
      },
    ],
  },
  {
    marque: 'APC',
    numero: `DV-${MARQUEUR}-A001`,
    delaiLivraison: '3 semaines',
    conditionsPaiement: 'À la commande',
    lignes: [
      { reference: 'SRT3000RMXLI', prixAchatHt: 18900, disponibilite: 'Sur commande' },
    ],
  },
  {
    marque: 'Ubiquiti',
    numero: `DV-${MARQUEUR}-U001`,
    delaiLivraison: '5 jours ouvrés',
    conditionsPaiement: '50 % acompte',
    lignes: [
      {
        reference: 'U6-PRO',
        prixAchatHt: 1850,
        remisePct: 10,
        disponibilite: 'En stock',
      },
    ],
  },
];

/** Distributeur multimarque : c'est lui qui rend la comparaison intéressante. */
const GENERALISTE: DevisEssai = {
  marque: 'Multimarque',
  numero: `DV-${MARQUEUR}-G001`,
  delaiLivraison: '15 jours ouvrés',
  conditionsPaiement: '45 jours',
  lignes: [
    { reference: 'C9200L-48P-4G-E', prixAchatHt: 26200, disponibilite: 'Sur commande' },
    { reference: 'SRT3000RMXLI', prixAchatHt: 17400, remisePct: 3, disponibilite: 'En stock' },
    { reference: 'U6-PRO', prixAchatHt: 1990, disponibilite: 'En stock' },
    {
      reference: 'P2723DE',
      prixAchatHt: 2450,
      disponibilite: 'En stock',
      // Dell n'a pas de fournisseur dédié : le généraliste est le seul à le chiffrer.
      designation: 'Ecran Dell 27" QHD USB-C (P2723DE)',
    },
  ],
};

async function supprimer(tenant: string): Promise<void> {
  const db = clientAdmin();

  const { data: devis } = await db
    .from('devis_fournisseur')
    .select('id')
    .eq('tenant_id', tenant)
    .like('numero_devis', `DV-${MARQUEUR}-%`);

  for (const d of devis ?? []) {
    await db.from('lignes_devis').delete().eq('devis_id', d.id);
    await db.from('devis_fournisseur').delete().eq('id', d.id);
  }

  const { data: gen } = await db
    .from('fournisseurs')
    .select('id')
    .eq('tenant_id', tenant)
    .eq('marque', GENERALISTE.marque);

  for (const f of gen ?? []) {
    await db.from('consultations').delete().eq('fournisseur_id', f.id);
    await db.from('fournisseurs').delete().eq('id', f.id);
  }

  console.log(`${devis?.length ?? 0} devis de test supprimé(s).`);
}

async function main(): Promise<void> {
  chargerEnv();

  const db = clientAdmin();
  const tenant = await tenantId();

  if (process.argv.includes('--supprimer')) {
    await supprimer(tenant);
    return;
  }

  // Inclut les statuts en aval : le script fait lui-même passer la demande à
  // « devis_recus », il doit pouvoir la retrouver au passage suivant.
  const { data: demande } = await db
    .from('demandes')
    .select('id, code')
    .eq('tenant_id', tenant)
    .in('statut', ['specs_extraites', 'envoyee_fournisseurs', 'devis_partiels', 'devis_recus'])
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!demande) {
    console.log(
      "Aucune demande exploitable (specs_extraites -> devis_recus) : lancer d'abord le worker.",
    );
    return;
  }

  const { data: articles } = await db
    .from('demande_items')
    .select('id, reference, designation, quantite')
    .eq('demande_id', demande.id);

  const parReference = new Map(
    (articles ?? [])
      .filter((a) => a.reference)
      .map((a) => [a.reference as string, a]),
  );

  console.log(`Demande ${demande.code} — ${parReference.size} article(s) référencé(s).\n`);

  // Le généraliste n'existe pas au sourcing : on le crée pour ce test.
  let generalisteId: number | null = null;
  const { data: dejaGen } = await db
    .from('fournisseurs')
    .select('id')
    .eq('tenant_id', tenant)
    .eq('marque', GENERALISTE.marque)
    .maybeSingle();

  if (dejaGen) {
    generalisteId = dejaGen.id;
  } else {
    const { data: cree, error } = await db
      .from('fournisseurs')
      .insert({
        tenant_id: tenant,
        marque: GENERALISTE.marque,
        nom: 'Atlas Distribution (essai)',
        email: 'commercial@atlas-distribution.test',
        source: 'manuel',
      })
      .select('id')
      .single();

    if (error) throw new Error(`Création du généraliste : ${error.message}`);
    generalisteId = cree.id;
  }

  const { data: consultations } = await db
    .from('consultations')
    .select('id, marque, fournisseur_id, fournisseur_nom')
    .eq('demande_id', demande.id)
    .eq('tenant_id', tenant);

  const tous = [...DEVIS, GENERALISTE];
  let creees = 0;
  let lignesCreees = 0;

  for (const devis of tous) {
    const estGeneraliste = devis.marque === GENERALISTE.marque;

    let consultationId: number | null = null;
    let fournisseurId: number | null = null;
    let fournisseurNom = 'Atlas Distribution (essai)';

    if (estGeneraliste) {
      fournisseurId = generalisteId;
      // Une consultation est nécessaire : le devis s'y rattache.
      const { data: dejaC } = await db
        .from('consultations')
        .select('id')
        .eq('demande_id', demande.id)
        .eq('fournisseur_id', generalisteId)
        .maybeSingle();

      if (dejaC) {
        consultationId = dejaC.id;
      } else {
        const { data: creeC, error } = await db
          .from('consultations')
          .insert({
            tenant_id: tenant,
            demande_id: demande.id,
            fournisseur_id: generalisteId,
            fournisseur_nom: fournisseurNom,
            fournisseur_email: 'commercial@atlas-distribution.test',
            marque: GENERALISTE.marque,
            sujet: 'Demande de devis multimarque (essai)',
            corps_html: '<p>Consultation de test.</p>',
            statut: 'devis_recu',
          })
          .select('id')
          .single();
        if (error) throw new Error(`Consultation généraliste : ${error.message}`);
        consultationId = creeC.id;
      }
    } else {
      const c = (consultations ?? []).find((x) => x.marque === devis.marque);
      if (!c) {
        console.log(`– ${devis.marque.padEnd(12)} pas de consultation, ignoré`);
        continue;
      }
      consultationId = c.id;
      fournisseurId = c.fournisseur_id;
      fournisseurNom = c.fournisseur_nom ?? devis.marque;
    }

    const { data: dejaD } = await db
      .from('devis_fournisseur')
      .select('id')
      .eq('numero_devis', devis.numero)
      .maybeSingle();

    if (dejaD) {
      console.log(`– ${devis.marque.padEnd(12)} ${devis.numero} déjà présent`);
      continue;
    }

    const { data: creeD, error: erreurD } = await db
      .from('devis_fournisseur')
      .insert({
        tenant_id: tenant,
        consultation_id: consultationId,
        demande_id: demande.id,
        numero_devis: devis.numero,
        date_devis: new Date().toISOString().slice(0, 10),
        devise: 'MAD',
        validite_offre: '30 jours',
        delai_livraison: devis.delaiLivraison,
        conditions_paiement: devis.conditionsPaiement,
        source: 'essai',
        statut_extraction: 'ok',
        confiance_globale: 0.95,
      })
      .select('id')
      .single();

    if (erreurD) throw new Error(`Devis ${devis.numero} : ${erreurD.message}`);

    for (const ligne of devis.lignes) {
      const article = parReference.get(ligne.reference);
      if (!article) {
        console.log(`    référence ${ligne.reference} absente de la demande, ignorée`);
        continue;
      }

      const { error } = await db.from('lignes_devis').insert({
        devis_id: creeD.id,
        demande_item_id: article.id,
        designation_fournisseur: ligne.designation ?? article.designation,
        reference: ligne.reference,
        fabricant: estGeneraliste ? null : devis.marque,
        quantite: Number(article.quantite),
        unite: 'unité',
        prix_achat_ht: ligne.prixAchatHt,
        remise_pct: ligne.remisePct ?? 0,
        tva_pct: 20,
        disponibilite: ligne.disponibilite,
        mapping_type: ligne.mappingType ?? 'exact',
        confiance_ia: 0.92,
      });

      if (error) throw new Error(`Ligne ${ligne.reference} : ${error.message}`);
      lignesCreees += 1;
    }

    if (!estGeneraliste) {
      await db
        .from('consultations')
        .update({ statut: 'devis_recu', date_reponse: new Date().toISOString() })
        .eq('id', consultationId);
    }

    creees += 1;
    console.log(
      `✓ ${devis.marque.padEnd(12)} ${devis.numero} — ${devis.lignes.length} ligne(s) — ${fournisseurNom}`,
    );
  }

  await db
    .from('demandes')
    .update({ statut: 'devis_recus', date_premier_devis: new Date().toISOString() })
    .eq('id', demande.id)
    .eq('tenant_id', tenant);

  console.log(
    `\n${creees} devis, ${lignesCreees} ligne(s). Demande passée à « devis_recus ».`,
  );
  console.log('Retrait : npm run essai:devis -- --supprimer');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
