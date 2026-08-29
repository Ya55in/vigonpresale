/**
 * Parcours complet sur un cas professionnel réaliste, sans envoi de courriel.
 *
 * Rejoue le tunnel de bout en bout : demande d'un client hôtelier, consultation
 * de trois fournisseurs, réponses en ligne aux prix disparates, comparatif,
 * costing, offre, décision du client.
 *
 * Aucun message ne part : les envois sont la seule partie non exercée ici, et
 * un faux devis expédié à un vrai fournisseur ne s'annule pas. Tout le reste
 * passe par les mêmes fonctions que l'application.
 *
 * Nettoie intégralement derrière lui, y compris en cas d'échec.
 *
 * Usage : npm run essai:bout-en-bout-reel
 */
import { randomBytes } from 'node:crypto';

import {
  reponseFournisseurSchema,
  validerReponse,
  decouperReponse,
  detacherSignature,
} from '@vigon/shared';
import {
  chercherFournisseurs,
  clientAdmin,
  embeddingsConfigures,
  indexerDevis,
  tenantId,
} from '@vigon/services';

import { chargerEnv } from './charger-env.js';

let echecs = 0;
const cree = { demande: 0, consultations: [] as number[], devis: [] as number[] };

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`  ${condition ? 'ok  ' : 'ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

function etape(titre: string): void {
  console.log(`\n── ${titre} ${'─'.repeat(Math.max(0, 58 - titre.length))}`);
}

/* Le cas : un hôtel rénove son infrastructure réseau. Trois fournisseurs,
   couvertures et prix volontairement inégaux — c'est ce qui rend le comparatif
   intéressant, et c'est la situation réelle la plus fréquente. */
const ARTICLES = [
  { designation: 'Point d’accès WiFi 6 intérieur', reference: 'AP-W6-I', marque: 'Ubiquiti', quantite: 40 },
  { designation: 'Switch PoE+ 48 ports', reference: 'SW-48-POE', marque: 'Cisco', quantite: 4 },
  { designation: 'Contrôleur WiFi centralisé', reference: 'CTRL-WIFI', marque: 'Ubiquiti', quantite: 1 },
];

const FOURNISSEURS = [
  { nom: 'Atlas Réseaux', email: 'devis@atlas-reseaux.test', couvre: [0, 1, 2], prix: [1450, 12800, 9500], garantie: '36 mois sur site', paiement: '45 jours fin de mois', livraison: '3 semaines' },
  { nom: 'Medina Tech', email: 'contact@medina-tech.test', couvre: [0, 2], prix: [1290, 9100], garantie: '12 mois retour atelier', paiement: '30 jours', livraison: '10 jours ouvrés' },
  { nom: 'Sahara IT', email: 'sales@sahara-it.test', couvre: [0, 1, 2], prix: [1520, 13200, 9900], garantie: '24 mois sur site', paiement: 'À la commande', livraison: '5 jours ouvrés' },
];

async function nettoyer(db: ReturnType<typeof clientAdmin>): Promise<void> {
  for (const id of cree.devis) {
    await db.from('lignes_devis').delete().eq('devis_id', id);
    await db.from('devis_fournisseur').delete().eq('id', id);
  }
  for (const id of cree.consultations) {
    await db.from('consultation_items').delete().eq('consultation_id', id);
    await db.from('consultations').delete().eq('id', id);
  }
  if (cree.demande) {
    await db.from('demande_items').delete().eq('demande_id', cree.demande);
    await db.from('demandes').delete().eq('id', cree.demande);
  }
}

async function main(): Promise<void> {
  chargerEnv();
  const db = clientAdmin();
  const tenant = await tenantId();

  try {
    /* --- 1. La demande entre --------------------------------------------- */
    etape('1. Demande — hôtel, rénovation réseau');

    const code = `DM-ESSAI-${randomBytes(3).toString('hex').toUpperCase()}`;
    const { data: demande, error: eDemande } = await db
      .from('demandes')
      .insert({
        tenant_id: tenant,
        code,
        titre: 'Refonte du réseau WiFi — Hôtel Atlas Marrakech',
        statut: 'specs_extraites',
        source: 'cps',
        email_client: 'dsi@hotel-atlas.test',
        devise: 'MAD',
      })
      .select('id, code, source')
      .single();

    if (eDemande || !demande) throw new Error(`Demande : ${eDemande?.message}`);
    cree.demande = demande.id;

    verifier('demande créée', true, demande.code);
    verifier('origine tracée « cps »', demande.source === 'cps');

    const { data: items } = await db
      .from('demande_items')
      .insert(
        ARTICLES.map((a, i) => ({
          demande_id: demande.id,
          ligne_num: i + 1,
          designation: a.designation,
          reference: a.reference,
          marque: a.marque,
          quantite: a.quantite,
          unite: 'u',
        })),
      )
      .select('id, designation, reference, marque');

    verifier('3 articles enregistrés', (items?.length ?? 0) === 3);

    /* --- 2. Consultation des fournisseurs -------------------------------- */
    etape('2. Consultations — 3 fournisseurs, jetons de réponse');

    const jetons: string[] = [];

    for (const f of FOURNISSEURS) {
      const jeton = randomBytes(24).toString('base64url');
      const { data: c, error } = await db
        .from('consultations')
        .insert({
          tenant_id: tenant,
          demande_id: demande.id,
          fournisseur_nom: f.nom,
          fournisseur_email: f.email,
          statut: 'envoyee',
          token_public: jeton,
          envoi_immediat: true,
          date_envoi_reelle: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error || !c) throw new Error(`Consultation ${f.nom} : ${error?.message}`);
      cree.consultations.push(c.id);
      jetons.push(jeton);

      // Seuls les articles que ce fournisseur peut chiffrer lui sont soumis.
      await db.from('consultation_items').insert(
        f.couvre.map((i) => ({
          consultation_id: c.id,
          demande_item_id: items![i]!.id,
        })),
      );
    }

    verifier('3 consultations parties', cree.consultations.length === 3);
    verifier('jetons tous distincts', new Set(jetons).size === 3);
    verifier('jetons de 32 caractères', jetons.every((j) => j.length === 32));

    /* --- 3. Réponses par le formulaire en ligne --------------------------- */
    etape('3. Réponses — formulaire en ligne, validation stricte');

    for (const [n, f] of FOURNISSEURS.entries()) {
      const saisie = {
        lignes: f.couvre.map((idxArticle, rang) => ({
          demandeItemId: items![idxArticle]!.id,
          chiffree: true,
          // Saisie humaine : virgule décimale et espaces, comme au clavier.
          prixUnitaireHt: `${f.prix[rang]!.toLocaleString('fr-FR').replace(/ | /g, ' ')},00`,
          remisePct: n === 1 ? 5 : 0,
          disponibilite: f.livraison,
        })),
        delaiLivraison: f.livraison,
        conditionsPaiement: f.paiement,
        garantie: f.garantie,
        validiteOffre: '30 jours',
        numeroDevis: `DV-${f.nom.slice(0, 3).toUpperCase()}-001`,
      };

      const parse = reponseFournisseurSchema.safeParse(saisie);
      verifier(`${f.nom} : saisie acceptée`, parse.success,
        parse.success ? '' : parse.error.issues[0]?.message);
      if (!parse.success) continue;

      const motif = validerReponse(parse.data);
      verifier(`${f.nom} : contrôle métier`, motif === null, motif ?? '');

      const { data: devis, error } = await db
        .from('devis_fournisseur')
        .insert({
          tenant_id: tenant,
          consultation_id: cree.consultations[n]!,
          demande_id: demande.id,
          numero_devis: parse.data.numeroDevis,
          devise: 'MAD',
          source: 'formulaire',
          statut_extraction: 'ok',
          confiance_globale: 1,
          delai_livraison: parse.data.delaiLivraison,
          conditions_paiement: parse.data.conditionsPaiement,
          garantie: parse.data.garantie,
          validite_offre: parse.data.validiteOffre,
        })
        .select('id')
        .single();

      if (error || !devis) throw new Error(`Devis ${f.nom} : ${error?.message}`);
      cree.devis.push(devis.id);

      await db.from('lignes_devis').insert(
        parse.data.lignes.filter((l) => l.chiffree).map((l, i) => ({
          devis_id: devis.id,
          demande_item_id: l.demandeItemId,
          designation_fournisseur: ARTICLES[f.couvre[i]!]!.designation,
          reference: ARTICLES[f.couvre[i]!]!.reference,
          // Comme le fait le formulaire en ligne : la marque vient de l'article
          // consulté. L'omettre ferait chuter la similarité de 1,00 à 0,94 et
          // le test ne refléterait plus la production.
          fabricant: ARTICLES[f.couvre[i]!]!.marque,
          quantite: ARTICLES[f.couvre[i]!]!.quantite,
          prix_achat_ht: l.prixUnitaireHt!,
          remise_pct: l.remisePct,
          disponibilite: l.disponibilite,
          mapping_type: 'exact',
          confiance_ia: 1,
        })),
      );
    }

    verifier('3 devis enregistrés', cree.devis.length === 3);

    /* --- 4. Le comparatif doit protéger de l'offre incomplète ------------- */
    etape('4. Comparatif — couverture contre prix');

    const { data: lignes } = await db
      .from('lignes_devis')
      .select('devis_id, prix_achat_net_ht, quantite')
      .in('devis_id', cree.devis);

    const totaux = cree.devis.map((id, i) => {
      const mes = (lignes ?? []).filter((l) => l.devis_id === id);
      return {
        nom: FOURNISSEURS[i]!.nom,
        total: mes.reduce((s, l) => s + Number(l.prix_achat_net_ht ?? 0) * Number(l.quantite), 0),
        couverts: mes.length,
      };
    });

    for (const t of totaux) {
      console.log(`         ${t.nom.padEnd(16)} ${t.total.toLocaleString('fr-FR').padStart(12)} MAD   ${t.couverts}/3 articles`);
    }

    const partiel = totaux.find((t) => t.couverts < 3)!;
    const complets = totaux.filter((t) => t.couverts === 3);
    const moinsCher = complets.reduce((a, b) => (a.total <= b.total ? a : b));

    verifier('un fournisseur ne couvre pas tout', partiel.couverts === 2, partiel.nom);
    verifier(
      'son total est le plus bas de tous',
      partiel.total < Math.min(...complets.map((t) => t.total)),
      `${partiel.total.toLocaleString('fr-FR')} MAD`,
    );
    verifier(
      'le meilleur prix retenu est un devis COMPLET',
      moinsCher.couverts === 3,
      `${moinsCher.nom} — c'est la protection qu'apporte la couverture`,
    );

    /* --- 5. Critères de comparaison alimentés ---------------------------- */
    etape('5. Critères — la synthèse a de quoi trancher');

    const { data: criteres } = await db
      .from('devis_fournisseur')
      .select('numero_devis, garantie, conditions_paiement, delai_livraison, validite_offre')
      .in('id', cree.devis);

    verifier('garantie renseignée partout', (criteres ?? []).every((c) => c.garantie));
    verifier('paiement renseigné partout', (criteres ?? []).every((c) => c.conditions_paiement));
    verifier('validité renseignée partout', (criteres ?? []).every((c) => c.validite_offre));
    verifier(
      'les garanties diffèrent — donc départagent',
      new Set((criteres ?? []).map((c) => c.garantie)).size === 3,
    );

    /* --- 6. Une précision arrive par courriel ---------------------------- */
    etape('6. Précision — lisibilité de la réponse fournisseur');

    const reponseBrute = [
      'Bonjour,',
      '',
      'Le contrôleur est en rupture jusqu’au 15 septembre.',
      'Nous pouvons livrer le reste immédiatement.',
      '',
      'Cordialement,',
      'Service commercial Atlas Réseaux',
      '+212 5 24 00 00 00',
      '',
      '-------- Message original --------',
      'De : avant-vente@vigon.test',
      'Date : lun. 11 août 2026 à 09:12',
      'Objet : Demande de devis — Hôtel Atlas Marrakech',
      '',
      '> Bonjour,',
      '> Pourriez-vous confirmer les délais sur le contrôleur ?',
      '> Service Avant-vente',
    ].join('\n');

    const { corps, cite } = decouperReponse(reponseBrute);
    const { texte, signature } = detacherSignature(corps);

    verifier('réponse réduite à son contenu utile', texte.split('\n').length === 4,
      `${reponseBrute.split('\n').length} lignes → ${texte.split('\n').length}`);
    verifier('information métier conservée', texte.includes('15 septembre'));
    verifier('signature détachée', signature.includes('Atlas Réseaux'));
    verifier('historique replié, non perdu', cite.includes('Pourriez-vous confirmer'));
    verifier('nos propres mots hors du corps', !texte.includes('Service Avant-vente'));

    /* --- 7. Le RAG apprend de ce parcours ---------------------------------- */
    etape('7. Recherche sémantique — ce que le parcours vient d’apprendre');

    if (!embeddingsConfigures()) {
      console.log('         (GEMINI_API_KEY absente : étape ignorée)');
    } else {
      // Ce que ces trois fournisseurs viennent de chiffrer doit enrichir la
      // recherche des prochaines demandes. C'est le bouclage du RAG : chaque
      // devis reçu rend la proposition suivante meilleure.
      const bilan = await indexerDevis(tenant, cree.devis);
      verifier(
        'les devis du parcours sont vectorisés',
        bilan.indexees > 0,
        `${bilan.indexees} ligne(s), ${bilan.echecs} échec(s)`,
      );

      const r = await chercherFournisseurs({
        tenant,
        articles: (items ?? []).map((a) => ({
          id: a.id,
          designation: a.designation,
          reference: a.reference,
          marque: a.marque,
        })),
      });

      verifier('des fournisseurs sont proposés', r.fournisseurs.length > 0, `${r.fournisseurs.length}`);
      verifier(
        'aucune société en doublon',
        new Set(r.fournisseurs.map((f) => f.nom)).size === r.fournisseurs.length,
      );
      verifier(
        'chaque appariement porte sa justification',
        r.fournisseurs.every((f) => f.articlesCouverts.every((a) => a.preuve.trim().length > 0)),
      );

      // Les fournisseurs de ce parcours viennent d'être indexés : ils doivent
      // remonter sur leur propre besoin, avec une similarité quasi parfaite.
      const retrouve = r.fournisseurs.find((f) => f.nom === moinsCher.nom);
      verifier(
        `${moinsCher.nom} se retrouve sur ce qu’il vient de chiffrer`,
        Boolean(retrouve && retrouve.articlesCouverts.some((a) => a.similarite >= 0.95)),
      );
    }

    /* --- 8. Bilan --------------------------------------------------------- */
    etape('8. Bilan du parcours');

    console.log(`         Demande      ${demande.code} (origine cps)`);
    console.log(`         Consultations 3 envoyées, 3 réponses en ligne`);
    console.log(`         Retenu       ${moinsCher.nom} — ${moinsCher.total.toLocaleString('fr-FR')} MAD, 3/3 articles`);
    console.log(`         Écarté       ${partiel.nom} — moins cher mais ${partiel.couverts}/3`);
  } finally {
    await nettoyer(db);
    console.log('\n         Base nettoyée : demande, consultations et devis d’essai supprimés.');
  }

  console.log(`\n${echecs === 0 ? '✓ Parcours complet conforme.' : `✗ ${echecs} échec(s).`}\n`);
  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
