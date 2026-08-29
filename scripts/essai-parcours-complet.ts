/**
 * Un cas simulé, de la réception du courriel à la génération de l'offre.
 *
 * POURQUOI CE HARNAIS EXISTE
 *
 * Les autres éprouvent un maillon chacun. Aucun ne vérifiait que la CHAÎNE
 * tient : une demande qui entre, des articles extraits, des consultations
 * préparées, des devis reçus, un costing verrouillé, un accord donné, une offre
 * générée. C'est pourtant là que les défauts se logent — le 2026-08-21, le
 * circuit d'approbation était complet côté serveur et n'était appelé par aucun
 * écran, ce qu'aucun essai unitaire ne pouvait voir.
 *
 * IL APPELLE LES VRAIES FONCTIONS partout où elles existent : `extraireSpecifications`
 * du worker, `genererConsultations` des services, `demanderValidation` et
 * `genererOffreComplete` de l'application. Un chemin d'essai qui les réécrirait
 * ne prouverait que sa propre réécriture.
 *
 * DEUX EXCEPTIONS, ASSUMÉES ET NOMMÉES :
 *  - les devis fournisseurs sont écrits directement, comme le fait
 *    `essai:repondre` — attendre de vraies réponses est impossible ;
 *  - la feuille de coûts est composée ici, `construireFeuille` étant une Server
 *    Action inaccessible hors de Next. Les prix viennent des colonnes générées,
 *    jamais d'un calcul de ce script.
 *
 * ÉCRIT EN BASE et défait TOUT dans un `finally`, y compris en cas d'échec.
 * N'ENVOIE AUCUN MESSAGE au client d'essai : il n'existe que le temps du parcours.
 *
 * UNE SEULE SORTIE VERS L'EXTÉRIEUR, et il faut la poser sciemment :
 * `ENVOIS_REELS=1` fait partir la demande d'accord sur le Telegram de
 * l'approbateur, comme le ferait l'escalade d'une avant-vente, puis attend sa
 * décision. Sans ce drapeau, l'accord est écrit en base et le parcours enchaîne.
 *
 * Usage : npm run essai:parcours
 *         ENVOIS_REELS=1 npm run essai:parcours   # demande d'accord réelle
 */
import { chargerEnv } from './charger-env.js';

let echecs = 0;
let etape = 0;

function titre(texte: string): void {
  etape += 1;
  console.log(`\n\x1b[1m${etape}. ${texte}\x1b[0m`);
}

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

/** Marqueur : tout ce que ce harnais crée le porte, pour un nettoyage sans ambiguïté. */
const MARQUEUR = `PARCOURS-${Date.now().toString(36).toUpperCase()}`;

const COURRIEL = `Madame, Monsieur,

La société Riad Numerique ouvre un nouveau site a Casablanca et souhaite
recevoir votre proposition chiffree pour son equipement informatique.

BESOINS

1. Reseau
   - 6 commutateurs Aruba 6300M 48 ports PoE+
   - 24 bornes WiFi 6 Aruba AP-635 pour la couverture des bureaux

2. Videosurveillance
   - 18 cameras Hikvision DS-2CD2143G2-I en interieur

3. Energie
   - 2 onduleurs APC Smart-UPS SRT 5 kVA pour le local technique

CONTRAINTES

- Livraison sur site a Casablanca avant le 30/11/2026
- Garantie 3 ans minimum sur l'actif reseau
- Paiement 30 jours fin de mois

Merci de nous faire parvenir votre offre avant le 15 octobre 2026.

Cordialement,
Service Achats — Riad Numerique`;

async function main(): Promise<void> {
  chargerEnv();

  const services = await import('@vigon/services');
  const { clientAdmin, tenantId, chargerSecrets, genererCode, genererConsultations } = services;

  const db = clientAdmin();
  const tenant = await tenantId();
  await chargerSecrets(tenant, { force: true });

  let clientId: number | null = null;
  let demandeId: number | null = null;
  let feuilleId: number | null = null;
  let offreId: number | null = null;
  let validationId: number | null = null;
  const devisIds: number[] = [];
  const consultationIds: number[] = [];

  try {
    /* --- 1. Réception ---------------------------------------------------- */

    titre('Réception — une demande entre par la boîte');

    const { data: client, error: erreurClient } = await db
      .from('clients')
      .insert({
        tenant_id: tenant,
        nom: `Riad Numerique (${MARQUEUR})`,
        email_principal: `essai-${MARQUEUR.toLowerCase()}@vigon.test`,
      })
      .select('id')
      .single();

    if (erreurClient) throw new Error(`Client d’essai : ${erreurClient.message}`);
    clientId = client.id;

    const code = await genererCode('DM', 'seq_demande');

    const { data: demande, error: erreurDemande } = await db
      .from('demandes')
      .insert({
        tenant_id: tenant,
        code,
        client_id: clientId,
        statut: 'nouvelle',
        source: 'email',
        email_client: `essai-${MARQUEUR.toLowerCase()}@vigon.test`,
        sujet_original: `Consultation equipement informatique (${MARQUEUR})`,
        corps_original: COURRIEL,
        contenu_consolide: `--- Sujet ---\nConsultation equipement informatique\n\n--- Corps du message ---\n${COURRIEL}`,
      })
      .select('id, code')
      .single();

    if (erreurDemande) throw new Error(`Demande d’essai : ${erreurDemande.message}`);
    demandeId = demande.id;

    verifier('la demande est créée', true, demande.code);

    /* --- 2. Extraction --------------------------------------------------- */

    titre('Extraction — le modèle lit le courriel');

    const { extraireSpecifications } = await import(
      '../apps/worker/src/services/extractionSpecs.js'
    );

    const debutIA = Date.now();
    await extraireSpecifications({
      demandeId,
      tenant,
      code: demande.code,
      contenu: COURRIEL,
      piecesIllisibles: [],
    });

    const { data: apresExtraction } = await db
      .from('demandes')
      .select('statut, titre, deadline, motif_blocage')
      .eq('id', demandeId)
      .single();

    verifier(
      'la demande n’est pas bloquée',
      apresExtraction?.statut !== 'bloquee',
      apresExtraction?.motif_blocage ?? `statut ${apresExtraction?.statut} en ${Date.now() - debutIA} ms`,
    );

    const { data: articles } = await db
      .from('demande_items')
      .select('id, designation, marque, quantite')
      .eq('demande_id', demandeId)
      .order('ligne_num');

    verifier('des articles sont extraits', (articles ?? []).length > 0, `${(articles ?? []).length}`);

    // Le courriel nomme trois marques : les retrouver prouve que l'extraction
    // lit le contenu, et pas seulement qu'elle produit quelque chose.
    const marques = new Set((articles ?? []).map((a) => (a.marque ?? '').toLowerCase()));
    for (const attendue of ['aruba', 'hikvision', 'apc']) {
      verifier(`la marque ${attendue} est reconnue`, marques.has(attendue));
    }

    verifier(
      'la date limite est reprise du texte',
      apresExtraction?.deadline !== null,
      apresExtraction?.deadline ?? '—',
    );

    if (!articles || articles.length === 0) throw new Error('Sans article, la suite n’a pas de sens.');

    /* --- 3. Consultations ------------------------------------------------ */

    titre('Consultations — une demande de devis par marque');

    const resultat = await genererConsultations({
      demandeId,
      tenant,
      articles: articles.map((a) => ({
        id: a.id,
        designation: a.designation,
        reference: null,
        marque: a.marque,
        quantite: Number(a.quantite),
      })),
    });

    verifier(
      'des consultations sont préparées',
      resultat.creees > 0,
      `${resultat.creees} créée(s), ${resultat.nonResolues.length} marque(s) sans fournisseur`,
    );

    const { data: consultations } = await db
      .from('consultations')
      .select('id, marque, fournisseur_nom, statut')
      .eq('demande_id', demandeId);

    consultationIds.push(...(consultations ?? []).map((c) => c.id));

    verifier(
      'chaque consultation porte un fournisseur nommé',
      (consultations ?? []).every((c) => Boolean(c.fournisseur_nom)),
    );

    // Elles sortent en brouillon ou en validation : rien ne part sans décision.
    verifier(
      'aucune consultation n’est envoyée sans validation humaine',
      (consultations ?? []).every((c) => c.statut !== 'envoyee'),
      [...new Set((consultations ?? []).map((c) => c.statut))].join(', '),
    );

    /* --- 4. Devis reçus -------------------------------------------------- */

    titre('Devis — les fournisseurs répondent');

    // Écriture directe, comme `essai:repondre` : attendre de vraies réponses
    // est impossible. Les prix posés ici sont des prix d'ACHAT ; tout le reste
    // — net, totaux, marge — vient des colonnes générées.
    for (const consultation of consultations ?? []) {
      const { data: liens } = await db
        .from('consultation_items')
        .select('demande_item_id')
        .eq('consultation_id', consultation.id);

      const ids = (liens ?? []).map((l) => l.demande_item_id);
      if (ids.length === 0) continue;

      const { data: lignesArticles } = await db
        .from('demande_items')
        .select('id, designation, quantite, unite')
        .in('id', ids);

      const { data: devis } = await db
        .from('devis_fournisseur')
        .insert({
          tenant_id: tenant,
          consultation_id: consultation.id,
          demande_id: demandeId,
          numero_devis: `DV-${MARQUEUR}-${consultation.id}`,
          date_devis: new Date().toISOString().slice(0, 10),
          devise: 'MAD',
          delai_livraison: '15 jours ouvrés',
          conditions_paiement: '30 jours fin de mois',
          garantie: '3 ans sur site',
          source: 'formulaire',
          statut_extraction: 'ok',
          confiance_globale: 1,
        })
        .select('id')
        .single();

      if (!devis) continue;
      devisIds.push(devis.id);

      await db.from('lignes_devis').insert(
        (lignesArticles ?? []).map((a, i) => ({
          devis_id: devis.id,
          demande_item_id: a.id,
          designation_fournisseur: a.designation,
          fabricant: null,
          quantite: Number(a.quantite),
          unite: a.unite ?? 'u',
          prix_achat_ht: 1000 + i * 250 + (consultation.id % 7) * 30,
          remise_pct: 0,
          disponibilite: 'En stock',
          mapping_type: 'exact',
          confiance_ia: 1,
        })),
      );

      await db
        .from('consultations')
        .update({ statut: 'devis_recu', date_reponse: new Date().toISOString() })
        .eq('id', consultation.id);
    }

    verifier('des devis sont enregistrés', devisIds.length > 0, `${devisIds.length}`);

    /* --- 5. Comparatif --------------------------------------------------- */

    titre('Comparatif — chaque offre doit être atteignable');

    const { lireComparatif } = await import('../apps/web/lib/costing/requetes.js');
    const comparatif = await lireComparatif(demandeId, tenant);

    verifier('le comparatif rend des lignes', comparatif.lignes.length > 0, `${comparatif.lignes.length}`);

    // L'invariant du 2026-08-21 : une colonne par devis, donc aucune offre
    // masquée par un homonyme ou un second devis du même fournisseur.
    const colonnes = new Set(comparatif.colonnes.map((c) => c.devisId));
    const perdues = comparatif.lignes
      .flatMap((l) => l.offres)
      .filter((o) => !colonnes.has(o.devisId)).length;

    verifier('aucune offre inatteignable', perdues === 0, perdues > 0 ? `⚠ ${perdues}` : 'toutes');

    /* --- 6. Costing ------------------------------------------------------ */

    titre('Costing — feuille construite puis verrouillée');

    const { tauxAStocker } = await import('../apps/web/lib/costing/marge.js');
    const MARGE = 30;
    const taux = tauxAStocker(MARGE, 'markup');

    const { data: feuille } = await db
      .from('cost_sheets')
      .insert({
        tenant_id: tenant,
        demande_id: demandeId,
        version: 1,
        mode_calcul: 'markup',
        marge_globale_pct: taux,
        statut: 'brouillon',
      })
      .select('id')
      .single();

    if (!feuille) throw new Error('Feuille de coûts impossible.');
    feuilleId = feuille.id;

    // Une ligne par article, sur la MEILLEURE offre — ce que l'écran propose
    // sans l'imposer.
    const retenues = comparatif.lignes
      .filter((l) => l.offres.length > 0)
      .map((l) => ({ ligne: l, offre: l.offres[0]! }));

    await db.from('cost_lines').insert(
      retenues.map(({ ligne, offre }, i) => ({
        cost_sheet_id: feuille.id,
        demande_item_id: ligne.demandeItemId,
        ligne_devis_id: offre.ligneDevisId,
        ligne_num: ligne.ligneNum ?? i + 1,
        designation_client: ligne.designation,
        quantite: ligne.quantite,
        unite: 'u',
        prix_achat_ht: offre.prixAchatNetHt,
        marge_pct: taux,
        tva_pct: 20,
      })),
    );

    const { data: lignesCout } = await db
      .from('cost_lines')
      .select('total_ligne_ht, total_ligne_ttc, prix_achat_ht, quantite')
      .eq('cost_sheet_id', feuille.id);

    const totalVente = (lignesCout ?? []).reduce((s, l) => s + Number(l.total_ligne_ht ?? 0), 0);
    const totalAchat = (lignesCout ?? []).reduce(
      (s, l) => s + Number(l.prix_achat_ht ?? 0) * Number(l.quantite ?? 0),
      0,
    );
    const totalTtc = (lignesCout ?? []).reduce((s, l) => s + Number(l.total_ligne_ttc ?? 0), 0);

    verifier('la feuille porte des lignes', (lignesCout ?? []).length > 0, `${(lignesCout ?? []).length}`);

    // La marge relue doit être celle demandée : c'est la base qui l'applique,
    // pas ce script.
    const margeObtenue = totalAchat > 0 ? ((totalVente - totalAchat) / totalAchat) * 100 : 0;
    verifier(
      'la marge appliquée est celle demandée',
      Math.abs(margeObtenue - MARGE) < 0.01,
      `${margeObtenue.toFixed(2)} % contre ${MARGE} %`,
    );

    // L'erreur est LUE : un verrouillage refusé en silence faisait échouer
    // l'étape suivante sur un motif qui ne nommait pas la cause.
    const { error: erreurVerrou } = await db
      .from('cost_sheets')
      .update({
        total_achat_ht: totalAchat,
        total_vente_ht: totalVente,
        total_ttc: totalTtc,
        total_tva: totalTtc - totalVente,
        // `marge_valeur` est GÉNÉRÉE : l'écrire fait refuser tout l'UPDATE.
        statut: 'verrouille',
      })
      .eq('id', feuille.id);

    verifier(
      'la feuille est verrouillée',
      !erreurVerrou,
      erreurVerrou ? erreurVerrou.message : `${totalTtc.toFixed(2)} MAD TTC`,
    );

    /* --- 7. Accord ------------------------------------------------------- */

    titre('Accord — le circuit d’approbation');

    const { demanderValidation, lireValidationPublique, resoudreApprobateurs } = await import(
      '../apps/web/lib/validation/circuit.js'
    );

    /*
     * LE DEMANDEUR EST UNE AVANT-VENTE : c'est le seul cas où l'accord
     * s'escalade. Un administrateur qui travaille l'opportunité décide sur
     * place, à l'écran, et n'envoie rien — il serait son propre destinataire.
     */
    const { data: demandeur } = await db
      .from('users')
      .select('id, prenom, nom')
      .eq('tenant_id', tenant)
      .eq('role', 'presale')
      .eq('actif', true)
      .limit(1)
      .maybeSingle();

    const { destinataires } = await resoudreApprobateurs(tenant, demandeur?.id);
    verifier(
      'un destinataire est résolu sans saisie',
      destinataires.length > 0,
      destinataires.map((d) => `${d.nom ?? d.email} (${d.joignable ? 'joignable' : 'courriel'})`).join(', '),
    );

    const demandee = await demanderValidation({
      tenant,
      utilisateurId: (demandeur?.id ?? null) as unknown as string,
      costSheetId: feuille.id,
      canal: 'interne',
    });

    verifier('la demande d’accord part', demandee.ok, demandee.ok ? demandee.lien : demandee.message);
    if (!demandee.ok) throw new Error(demandee.message);

    const { data: ligneValidation } = await db
      .from('validations_offre')
      .select('id')
      .eq('token_public', demandee.token)
      .single();
    validationId = ligneValidation?.id ?? null;

    const publique = await lireValidationPublique(demandee.token);
    verifier('la page publique s’ouvre sur le jeton', publique !== null);
    verifier('elle est décidable', publique?.decidable === true);

    // Rien d'interne ne franchit le lien : il circule hors de la plateforme.
    const serialise = JSON.stringify(publique ?? {}).toLowerCase();
    verifier(
      'aucun prix d’achat ni nom de fournisseur ne fuit',
      !serialise.includes('prix_achat') && !serialise.includes('fournisseur'),
    );

    /*
     * DEMANDE RÉELLE, SUR DÉCISION EXPLICITE.
     *
     * Sans `ENVOIS_REELS`, l'accord est écrit en base : le parcours éprouve la
     * chaîne, pas le transport, et un harnais qui écrit dehors à chaque exécution
     * finit par écrire là où il ne faut pas.
     *
     * Avec, le message part sur le Telegram de l'approbateur — exactement ce que
     * fait `soumettreValidation` quand une avant-vente escalade — et le parcours
     * ATTEND sa décision avant de générer quoi que ce soit.
     */
    const envoisReels = process.env.ENVOIS_REELS === '1';
    const parTelegram = destinataires.find((d) => d.telegramChatId);

    if (envoisReels && parTelegram?.telegramChatId) {
      const { telegramConfigure, envoyerTelegram, texteValidation } = services;

      if (!telegramConfigure()) {
        verifier('Telegram est configuré', false, 'jeton de bot absent — voir /admin');
      } else {
        const format = (v: number): string =>
          `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} MAD`;

        await envoyerTelegram({
          chatId: parTelegram.telegramChatId,
          texte: texteValidation({
            demandeCode: code,
            clientNom: `Riad Numerique (${MARQUEUR})`,
            objet: `Consultation equipement informatique (${MARQUEUR})`,
            totalHt: format(totalVente),
            totalTtc: format(totalTtc),
            margePct: MARGE,
            lienValidation: demandee.lien,
            expireLe: new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('fr-FR'),
            demandePar: [demandeur?.prenom, demandeur?.nom].filter(Boolean).join(' ') || null,
          }),
          lien: demandee.lien,
        });

        // Le canal réellement emprunté, comme le fait l'action : savoir par où
        // c'est parti quand plusieurs coexistent.
        await db
          .from('validations_offre')
          .update({ canal: 'telegram' })
          .eq('id', validationId!);

        verifier(
          'la demande part sur Telegram',
          true,
          `${parTelegram.nom ?? parTelegram.email} — chat ${parTelegram.telegramChatId}`,
        );

        const attente = Number(process.env.ATTENTE_DECISION ?? 300);
        console.log(
          `\n        Décidez depuis Telegram ou depuis l’écran de costing.\n` +
            `        Lien : ${demandee.lien}\n` +
            `        Attente : ${attente} s — Ctrl+C annule et nettoie.\n`,
        );

        const limite = Date.now() + attente * 1_000;
        let statut = 'en_attente';

        while (Date.now() < limite) {
          await new Promise((r) => setTimeout(r, 5_000));
          const { data } = await db
            .from('validations_offre')
            .select('statut')
            .eq('id', validationId!)
            .maybeSingle();
          statut = data?.statut ?? 'en_attente';
          if (statut !== 'en_attente') break;
          process.stdout.write('.');
        }

        console.log('');

        if (statut === 'refusee') {
          verifier('la décision est rendue', true, 'refus enregistré');
          throw new Error('Refus enregistré : la génération n’est pas tentée. C’est le comportement attendu.');
        }

        if (statut === 'en_attente') {
          verifier('la décision est rendue', false, `aucune réponse en ${attente} s`);
          throw new Error('Aucune décision : le parcours s’arrête avant la génération.');
        }

        verifier('la décision est rendue', true, 'accord donné depuis le canal reçu');
      }
    }

    if (!envoisReels || !parTelegram?.telegramChatId) {
      await db
        .from('validations_offre')
        .update({ statut: 'approuvee', date_decision: new Date().toISOString() })
        .eq('id', validationId!)
        .eq('statut', 'en_attente');
    }

    const apresDecision = await lireValidationPublique(demandee.token);
    verifier('la décision se prend une seule fois', apresDecision?.decidable === false);

    /* --- 8. Offre -------------------------------------------------------- */

    titre('Offre — génération du document');

    const { genererOffreComplete } = await import('../apps/web/lib/offres/generer.js');

    // Un utilisateur réel : la génération trace son auteur, et un identifiant
    // nul serait refusé par la clé étrangère.
    const { data: auteur } = await db
      .from('users')
      .select('id')
      .eq('tenant_id', tenant)
      .eq('actif', true)
      .limit(1)
      .maybeSingle();

    if (!auteur) throw new Error('Aucun utilisateur actif pour porter la génération.');

    const debutOffre = Date.now();

    // `genererOffreComplete` LÈVE au lieu de rendre un drapeau : l'échec doit
    // être visible, pas absorbé dans un booléen que l'appelant peut ignorer.
    let genere: Awaited<ReturnType<typeof genererOffreComplete>> | null = null;
    let motifOffre = '';

    try {
      genere = await genererOffreComplete({
        demandeId,
        tenant,
        utilisateurId: auteur.id,
        costSheetId: feuille.id,
        avecImages: false,
      });
    } catch (e) {
      motifOffre = e instanceof Error ? e.message : String(e);
    }

    verifier(
      'l’offre est générée',
      genere !== null,
      genere
        ? `${genere.numero} en ${((Date.now() - debutOffre) / 1000).toFixed(1)} s`
        : motifOffre,
    );

    if (genere) {
      offreId = genere.offreId;

      const { data: creee } = await db
        .from('offres')
        .select('id, numero, statut, token_public, source_json, pdf_url')
        .eq('id', genere.offreId)
        .single();

      verifier('elle porte un contenu figé', Boolean(creee?.source_json));
      verifier('elle porte un jeton public', (creee?.token_public ?? '').length >= 32);
      verifier('un document est produit', Boolean(creee?.pdf_url));

      const boq = (creee?.source_json ?? {}) as {
        produits?: { designation: string }[];
        totaux?: { totalTtc?: number };
        articlesNonProposes?: unknown[];
      };

      verifier(
        'le BoQ reprend les articles chiffrés',
        (boq.produits ?? []).length === retenues.length,
        `${(boq.produits ?? []).length} produit(s) pour ${retenues.length} ligne(s)`,
      );

      // Les totaux de l'offre doivent être ceux de la feuille : une offre qui
      // recalculerait ses prix contredirait le costing validé.
      verifier(
        'le total de l’offre est celui de la feuille',
        Math.abs(Number(boq.totaux?.totalTtc ?? 0) - totalTtc) < 0.01,
        `${Number(boq.totaux?.totalTtc ?? 0).toFixed(2)} contre ${totalTtc.toFixed(2)}`,
      );

      // Le lien public ne s'ouvre qu'à partir de la validation — BUG-16.
      const { estStatutPublic } = await import('../apps/web/lib/offres/public.js');
      verifier(
        'le lien client reste fermé avant validation',
        !estStatutPublic(creee?.statut ?? null),
        `statut ${creee?.statut}`,
      );
    }
  } finally {
    /* --- Nettoyage, y compris en cas d'échec ----------------------------- */

    titre('Nettoyage');

    if (offreId) {
      await db.from('offre_produits').delete().eq('offre_id', offreId);
      await db.from('offres').delete().eq('id', offreId);
    }
    if (validationId) await db.from('validations_offre').delete().eq('id', validationId);
    if (feuilleId) {
      await db.from('cost_lines').delete().eq('cost_sheet_id', feuilleId);
      await db.from('cost_sheets').delete().eq('id', feuilleId);
    }
    if (devisIds.length > 0) {
      await db.from('lignes_devis').delete().in('devis_id', devisIds);
      await db.from('devis_fournisseur').delete().in('id', devisIds);
    }
    if (consultationIds.length > 0) {
      await db.from('consultation_items').delete().in('consultation_id', consultationIds);
      await db.from('consultations').delete().in('id', consultationIds);
    }
    if (demandeId) {
      await db.from('communications').delete().eq('demande_id', demandeId);
      await db.from('notifications').delete().eq('demande_id', demandeId);
      await db.from('demande_items').delete().eq('demande_id', demandeId);
      await db.from('demandes').delete().eq('id', demandeId);
    }
    if (clientId) await db.from('clients').delete().eq('id', clientId);

    // Contrôlé, pas supposé : un nettoyage qu'on n'éprouve pas est une promesse.
    const restes: string[] = [];
    if (demandeId) {
      const { data } = await db.from('demandes').select('id').eq('id', demandeId);
      if ((data ?? []).length > 0) restes.push('demande');
    }
    if (clientId) {
      const { data } = await db.from('clients').select('id').eq('id', clientId);
      if ((data ?? []).length > 0) restes.push('client');
    }

    verifier('tout ce qui a été créé est retiré', restes.length === 0, restes.join(', ') || MARQUEUR);
  }

  console.log(
    `\n${echecs === 0 ? '✓ Le parcours tient de la réception à l’offre.' : `✗ ${echecs} ÉCHEC(S).`}\n`,
  );

  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
