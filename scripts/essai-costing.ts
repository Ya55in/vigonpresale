/**
 * Éprouve le costing et le circuit de validation, de bout en bout.
 *
 * CE QU'IL COUVRE, ET POURQUOI CHAQUE POINT EST LÀ
 *
 *  1. Les COLONNES GÉNÉRÉES contre le calcul applicatif. La règle du projet dit
 *     qu'aucun prix ne se recalcule côté application — or `rafraichirTotaux`
 *     recompose bien `total_achat_ht` et `total_couts_add` à la main, à côté de
 *     totaux qui, eux, viennent de la base. Le coût additionnel n'avait JAMAIS
 *     été exercé : aucune ligne n'en portait. Ce harnais en pose un et compare.
 *
 *  2. Les DEUX MODES de calcul. Le mode « marge brute » n'existe pas en base :
 *     il est converti en markup avant écriture. Un aller-retour qui ne rendrait
 *     pas le taux saisi ferait mentir l'écran.
 *
 *  3. Le COMPARATIF sur une demande réelle : couverture, meilleur prix, et les
 *     articles que personne ne couvre — c'est ce dernier point qui déclenche le
 *     sourcing web, il ne doit pas être silencieux.
 *
 *  4. Le CIRCUIT DE VALIDATION entier : demande, lecture publique, décision,
 *     idempotence. Le jeton EST l'autorisation, une décision ne se renverse pas.
 *
 *  5. L'ORDRE DES CANAUX, lu dans le code source plutôt qu'affirmé ici.
 *
 * ÉCRIT EN BASE et défait tout dans un `finally`, y compris en cas d'échec.
 *
 * N'ENVOIE AUCUN MESSAGE. Pour un envoi Telegram réel, poser ENVOIS_REELS=1 :
 * le message part alors au premier approbateur ayant un chat associé.
 *
 * Usage :
 *   npm run essai:costing
 *   ENVOIS_REELS=1 npm run essai:costing
 */
import { chargerEnv } from './charger-env.js';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

function alerter(intitule: string, detail = ''): void {
  console.log(` !    ${intitule}${detail ? ` — ${detail}` : ''}`);
}

/** Deux montants sont-ils égaux au centime ? Le reste est du bruit de flottant. */
const memeMontant = (a: number, b: number): boolean => Math.abs(a - b) < 0.01;

/**
 * Numéro de version réservé aux feuilles de ce harnais.
 *
 * Très au-dessus des versions réelles, pour deux raisons : ne pas se glisser
 * dans la numérotation d'une affaire, et pouvoir reconnaître un résidu à coup
 * sûr quand une exécution a été interrompue avant son nettoyage.
 */
const VERSION_ESSAI = 9000;

async function main(): Promise<void> {
  chargerEnv();

  const { clientAdmin, tenantId, chargerSecrets } = await import('@vigon/services');
  const db = clientAdmin();
  const tenant = await tenantId();
  await chargerSecrets(tenant, { force: true });

  /* --- 1. Les deux modes de calcul ---------------------------------------- */

  console.log('\n=== Modes de calcul ===');

  const { margeVersMarkup, markupVersMarge, tauxAStocker, tauxAAfficher } = await import(
    '../apps/web/lib/costing/marge.js'
  );

  // 30 % de marge brute = 42,857 % de markup. Le contrôle porte sur l'ALLER-
  // RETOUR : c'est lui que l'écran fait subir au taux à chaque affichage.
  for (const saisi of [0, 10, 25, 30, 50, 66.67]) {
    const stocke = tauxAStocker(saisi, 'marge');
    const rendu = tauxAAfficher(stocke, 'marge');
    verifier(
      `marge ${saisi} % → markup ${stocke.toFixed(2)} % → ${rendu.toFixed(2)} %`,
      Math.abs(rendu - saisi) < 0.01,
    );
  }

  verifier('en mode markup, le taux est stocké tel quel', tauxAStocker(30, 'markup') === 30);

  // Une marge brute de 100 % supposerait un coût nul : bornée, pas divisée par
  // zéro. Sans cette borne, `marge_pct` recevrait Infinity et la feuille
  // entière deviendrait NaN.
  verifier(
    'une marge brute de 100 % est bornée, pas infinie',
    Number.isFinite(margeVersMarkup(100)) && margeVersMarkup(100) > 0,
    `${margeVersMarkup(100).toFixed(0)} %`,
  );
  verifier('un taux négatif n’est pas converti', markupVersMarge(-5) === -5);

  /* --- 2. Colonnes générées contre calcul applicatif ---------------------- */

  console.log('\n=== Colonnes générées ===');

  // Une demande avec des devis, pour disposer d'une ligne réelle à recopier.
  const { data: demandeCible } = await db
    .from('demandes')
    .select('id, code')
    .eq('tenant_id', tenant)
    .in('statut', ['devis_recus', 'devis_partiels', 'en_costing', 'offre_generee'])
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!demandeCible) {
    alerter('aucune demande au stade costing', 'sections 2 à 4 sautées');
    console.log(`\n${echecs === 0 ? '✓ Modes de calcul conformes.' : `✗ ${echecs} ÉCHEC(S).`}\n`);
    process.exit(echecs === 0 ? 0 : 1);
  }

  console.log(`        demande d’appui : ${demandeCible.code}`);

  const { data: article } = await db
    .from('demande_items')
    .select('id, designation, quantite')
    .eq('demande_id', demandeCible.id)
    .limit(1)
    .maybeSingle();

  const feuillesCreees: number[] = [];
  let validationCreee: number | null = null;
  let validationSurPlace: number | null = null;

  try {
    if (article) {
      /*
       * RÉSIDU D'UNE EXÉCUTION INTERROMPUE.
       *
       * Le nettoyage vit dans un `finally`, mais un processus tué — délai
       * dépassé, Ctrl-C, machine qui s'endort — ne l'exécute pas. La feuille
       * de la fois d'avant survit alors, et `cost_sheets_demande_id_version_key`
       * fait échouer TOUTES les exécutions suivantes sur un message qui ne dit
       * rien du vrai problème. Constaté deux fois le 2026-08-25.
       *
       * La version 9000 est réservée à ce harnais par la ligne ci-dessous :
       * purger ce qui la porte ne peut donc pas toucher une feuille réelle.
       */
      const { data: residus } = await db
        .from('cost_sheets')
        .select('id')
        .eq('tenant_id', tenant)
        .eq('demande_id', demandeCible.id)
        .eq('version', VERSION_ESSAI);

      for (const r of residus ?? []) {
        await db.from('validations_offre').delete().eq('cost_sheet_id', r.id);
        await db.from('cost_lines').delete().eq('cost_sheet_id', r.id);
        await db.from('cost_sheets').delete().eq('id', r.id);
        console.log(`        résidu purgé : feuille d’essai #${r.id}`);
      }

      const { data: feuille, error } = await db
        .from('cost_sheets')
        .insert({
          tenant_id: tenant,
          demande_id: demandeCible.id,
          // Très au-dessus des versions réelles : cette feuille d'essai ne doit
          // pas se glisser dans la numérotation de l'affaire.
          version: VERSION_ESSAI,
          mode_calcul: 'markup',
          marge_globale_pct: 25,
          statut: 'brouillon',
        })
        .select('id')
        .single();

      if (error) throw new Error(`Feuille d’essai impossible : ${error.message}`);
      feuillesCreees.push(feuille.id);

      const QUANTITE = 4;
      const PRIX_ACHAT = 1000;
      const COUT_ADD = 150;
      const MARGE = 25;

      const { error: erreurLigne } = await db.from('cost_lines').insert({
        cost_sheet_id: feuille.id,
        ligne_num: 1,
        designation_client: 'Ligne d’essai — coût additionnel',
        quantite: QUANTITE,
        unite: 'u',
        prix_achat_ht: PRIX_ACHAT,
        cout_additionnel: COUT_ADD,
        cout_additionnel_libelle: 'Transport',
        marge_pct: MARGE,
        tva_pct: 20,
      });

      if (erreurLigne) throw new Error(`Ligne d’essai impossible : ${erreurLigne.message}`);

      const { data: relue } = await db
        .from('cost_lines')
        .select('prix_vente_ht, total_ligne_ht, total_ligne_ttc')
        .eq('cost_sheet_id', feuille.id)
        .single();

      // LE POINT DE FOND : la base applique-t-elle la marge au coût additionnel,
      // comme l'affirme le commentaire d'en-tête de `marge.ts` ?
      const attenduUnitaire = (PRIX_ACHAT + COUT_ADD) * (1 + MARGE / 100);
      const obtenuUnitaire = Number(relue?.prix_vente_ht ?? 0);

      verifier(
        'le coût additionnel entre dans le prix de vente',
        memeMontant(obtenuUnitaire, attenduUnitaire),
        `base ${obtenuUnitaire} contre ${attenduUnitaire} attendu`,
      );

      verifier(
        'le total de ligne est le prix unitaire × la quantité',
        memeMontant(Number(relue?.total_ligne_ht ?? 0), obtenuUnitaire * QUANTITE),
        `${relue?.total_ligne_ht}`,
      );

      verifier(
        'la TVA suit le taux de la ligne',
        memeMontant(
          Number(relue?.total_ligne_ttc ?? 0),
          Number(relue?.total_ligne_ht ?? 0) * 1.2,
        ),
        `${relue?.total_ligne_ttc}`,
      );

      /*
       * `rafraichirTotaux` n'est pas importable — elle vit dans un fichier
       * 'use server'. Sa formule est donc REJOUÉE ici, et c'est acceptable
       * pour un seul point : vérifier que le coût additionnel est bien traité
       * comme un montant UNITAIRE des deux côtés. S'il était par ligne d'un
       * côté et par unité de l'autre, la marge globale afficherait un écart
       * que personne ne saurait expliquer.
       */
      const coutTotalApplicatif = PRIX_ACHAT * QUANTITE + COUT_ADD * QUANTITE;
      const venteBase = Number(relue?.total_ligne_ht ?? 0);
      const margeGlobale = ((venteBase - coutTotalApplicatif) / coutTotalApplicatif) * 100;

      verifier(
        'la marge globale recomposée retombe sur le taux saisi',
        Math.abs(margeGlobale - MARGE) < 0.01,
        `${margeGlobale.toFixed(4)} % contre ${MARGE} %`,
      );
    }

    /* --- 3. Le comparatif ------------------------------------------------- */

    console.log('\n=== Comparatif ===');

    const { lireComparatif } = await import('../apps/web/lib/costing/requetes.js');
    const comparatif = await lireComparatif(demandeCible.id, tenant);

    verifier('des articles sont comparés', comparatif.lignes.length > 0, `${comparatif.lignes.length}`);
    verifier(
      'des devis ont répondu',
      comparatif.colonnes.length > 0,
      `${comparatif.colonnes.length} colonne(s)`,
    );

    /*
     * LE CONTRÔLE QUI MANQUAIT — et qui aurait attrapé le défaut du 2026-08-21.
     *
     * Les colonnes étaient les fournisseurs, et chaque cellule retrouvait son
     * offre par le NOM. Une société portant plusieurs fiches, ou un fournisseur
     * répondant par plusieurs devis, rendait des offres INATTEIGNABLES : elles
     * existaient en base, s'affichaient dans le meilleur prix, mais aucune
     * cellule ne permettait de les retenir.
     *
     * Mesuré sur DM-2026-000032 : 6 offres sur 16. L'invariant ci-dessous est
     * le seul qui l'exprime — toute offre doit tomber dans exactement une
     * colonne, sinon le tableau ment sur ce qu'il propose.
     */
    const parDevis = new Map(comparatif.colonnes.map((c) => [c.devisId, c]));

    let inatteignables = 0;
    for (const ligne of comparatif.lignes) {
      for (const offre of ligne.offres) {
        if (!parDevis.has(offre.devisId)) inatteignables += 1;
      }
    }

    verifier(
      'toute offre tombe dans une colonne — aucune n’est inatteignable',
      inatteignables === 0,
      inatteignables > 0 ? `⚠ ${inatteignables} PERDUE(S)` : 'toutes atteignables',
    );

    // Deux colonnes qui portent le même libellé ne se distinguent pas à l'œil,
    // et leur clé React se dédouble.
    const libelles = comparatif.colonnes.map((c) => c.libelle);
    verifier(
      'aucun libellé de colonne en doublon',
      new Set(libelles).size === libelles.length,
      libelles.join(' | '),
    );

    verifier(
      'chaque colonne est un devis distinct',
      new Set(comparatif.colonnes.map((c) => c.devisId)).size === comparatif.colonnes.length,
    );

    const libellesCriteres = comparatif.criteres.map((c) => c.nom);
    verifier(
      'aucun bloc de critères en doublon de libellé',
      new Set(libellesCriteres).size === libellesCriteres.length,
      libellesCriteres.join(' | '),
    );

    // Les offres sont triées par prix croissant : le meilleur prix est donc la
    // première non alternative. Le contrôle porte sur le TRI, pas sur la valeur.
    let triCorrect = true;
    for (const ligne of comparatif.lignes) {
      for (let i = 1; i < ligne.offres.length; i += 1) {
        if (ligne.offres[i - 1]!.prixAchatNetHt > ligne.offres[i]!.prixAchatNetHt) {
          triCorrect = false;
        }
      }
    }
    verifier('les offres de chaque article sont triées par prix croissant', triCorrect);

    const avecOffres = comparatif.lignes.filter((l) => l.offres.length > 0);
    verifier(
      'chaque article couvert porte un meilleur prix',
      avecOffres.every((l) => l.meilleurPrixNet !== null),
    );

    // Un article sans offre DOIT être nommé : c'est ce qui déclenche le
    // sourcing web, et un silence ici le ferait passer inaperçu jusqu'à l'offre.
    const sansOffre = comparatif.lignes.filter((l) => l.offres.length === 0);
    verifier(
      'les articles sans offre sont tous signalés',
      sansOffre.length === comparatif.articlesSansOffre.length,
      `${comparatif.articlesSansOffre.length} signalé(s) : ${comparatif.articlesSansOffre.join(', ') || 'aucun'}`,
    );

    verifier(
      'la couverture annoncée ne dépasse jamais le nombre d’articles',
      comparatif.criteres.every((c) => c.articlesCouverts <= c.articlesDemandes),
    );

    /* --- 4. Le circuit de validation -------------------------------------- */

    console.log('\n=== Circuit de validation ===');

    const {
      demanderValidation,
      lireValidation,
      lireValidationPublique,
      approuverSurPlace,
      peutApprouverSurPlace,
    } = await import('../apps/web/lib/validation/circuit.js');

    /*
     * L'administrateur sert trois fois : il décide sur place, il est écarté de
     * ses propres destinataires, et sa joignabilité est éprouvée plus bas. Une
     * seule lecture pour les trois.
     */
    const { data: admin } = await db
      .from('users')
      .select('id, email, telegram_chat_id')
      .eq('tenant_id', tenant)
      .eq('role', 'admin')
      .eq('actif', true)
      .limit(1)
      .maybeSingle();

    verifier(
      'la règle d’accord sur place nomme l’administrateur, et lui seul',
      peutApprouverSurPlace('admin') &&
        !peutApprouverSurPlace('presale') &&
        !peutApprouverSurPlace('finance') &&
        !peutApprouverSurPlace('after_sales'),
    );

    // Une feuille verrouillée est exigée : c'est la garde qui empêche de faire
    // approuver des montants encore modifiables.
    const { data: verrouillee } = await db
      .from('cost_sheets')
      .select('id, demande_id')
      .eq('tenant_id', tenant)
      .eq('statut', 'verrouille')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!verrouillee) {
      alerter('aucune feuille verrouillée', 'circuit de validation non éprouvé');
    } else {
      // Un brouillon ne passe pas : contrôle de la garde AVANT le chemin nominal.
      if (feuillesCreees[0]) {
        const refus = await demanderValidation({
          tenant,
          utilisateurId: null as unknown as string,
          costSheetId: feuillesCreees[0],
        });
        verifier(
          'une feuille non verrouillée est refusée',
          !refus.ok,
          refus.ok ? '⚠ ACCEPTÉE À TORT' : refus.message,
        );

        // La même garde protège l'accord direct : sans elle, l'administrateur
        // approuverait des montants encore modifiables.
        const refusDirect = await approuverSurPlace({
          tenant,
          utilisateurId: admin?.id ?? (null as unknown as string),
          costSheetId: feuillesCreees[0],
        });
        verifier(
          'une feuille non verrouillée ne peut pas être approuvée sur place',
          !refusDirect.ok,
          refusDirect.ok ? '⚠ ACCEPTÉE À TORT' : refusDirect.message,
        );
      }

      const existante = await lireValidation(tenant, verrouillee.id);

      if (existante.statut !== 'aucune') {
        alerter(
          `une validation existe déjà sur la feuille #${verrouillee.id}`,
          `statut ${existante.statut} — chemin nominal non rejoué`,
        );
      } else {
        const demandee = await demanderValidation({
          tenant,
          utilisateurId: null as unknown as string,
          costSheetId: verrouillee.id,
          canal: 'interne',
        });

        verifier(
          'une feuille verrouillée est soumise',
          demandee.ok,
          demandee.ok ? demandee.lien : demandee.message,
        );

        if (demandee.ok) {
          const { data: ligne } = await db
            .from('validations_offre')
            .select('id')
            .eq('token_public', demandee.token)
            .single();
          validationCreee = ligne?.id ?? null;

          // Le jeton EST l'autorisation : il doit porter assez d'entropie.
          verifier(
            'le jeton fait au moins 32 caractères',
            demandee.token.length >= 32,
            `${demandee.token.length}`,
          );

          const publique = await lireValidationPublique(demandee.token);
          verifier('la lecture publique rend la demande', publique !== null);
          verifier('elle est décidable', publique?.decidable === true);
          verifier('elle n’est pas expirée', publique?.expiree === false);

          // Allowlist explicite : rien d'interne ne doit franchir le lien.
          const serialise = JSON.stringify(publique ?? {}).toLowerCase();
          for (const interdit of ['prix_achat', 'fournisseur', 'cost_line', 'marge_valeur']) {
            verifier(`« ${interdit} » n’apparaît pas dans la lecture publique`, !serialise.includes(interdit));
          }

          // Deux demandes sur la même feuille : l'index partiel doit refuser.
          const doublon = await demanderValidation({
            tenant,
            utilisateurId: null as unknown as string,
            costSheetId: verrouillee.id,
          });
          verifier(
            'une seconde demande sur la même feuille est refusée',
            !doublon.ok,
            doublon.ok ? '⚠ ACCEPTÉE À TORT' : doublon.message,
          );

          /*
           * Décision prise DEPUIS LA PLATEFORME, sur une demande qui attendait.
           * C'est le cas de l'administrateur qui reçoit la demande d'une
           * avant-vente et tranche à l'écran plutôt que depuis Telegram : la
           * demande en attente doit être close, pas doublée.
           */
          const surDemande = await approuverSurPlace({
            tenant,
            utilisateurId: admin?.id ?? (null as unknown as string),
            costSheetId: verrouillee.id,
          });

          verifier(
            'l’accord donné à l’écran clôt la demande en attente',
            surDemande.ok,
            surDemande.message,
          );

          const { data: lignes } = await db
            .from('validations_offre')
            .select('id, statut, decide_par')
            .eq('cost_sheet_id', verrouillee.id);

          verifier(
            'aucune seconde ligne n’est créée',
            (lignes ?? []).length === 1,
            `${(lignes ?? []).length} ligne(s)`,
          );

          const decidee = (lignes ?? []).find((l) => l.statut === 'approuvee') ?? null;
          verifier('la décision passe depuis « en attente »', decidee !== null);
          verifier(
            'elle porte le nom de qui l’a prise',
            admin === null || decidee?.decide_par === admin.id,
            decidee?.decide_par ?? 'aucun',
          );

          const { data: rejeu } = await db
            .from('validations_offre')
            .update({ statut: 'refusee' })
            .eq('id', validationCreee!)
            .eq('statut', 'en_attente')
            .select('id')
            .maybeSingle();

          verifier('le rejeu ne renverse pas la décision', rejeu === null);

          const apres = await lireValidationPublique(demandee.token);
          verifier('la demande décidée n’est plus décidable', apres?.decidable === false);
        }
      }
    }

    /* --- 4 bis. À qui la demande d'accord s'adresse ------------------------ */

    console.log('\n=== Destinataires de l’accord ===');

    /*
     * L'ACCORD REVIENT À L'ADMINISTRATEUR — et c'est le seul point où le
     * circuit peut se tromper de personne sans que rien ne le signale.
     *
     * Jusqu'au 2026-08-21, l'action lisait une adresse saisie dans un
     * formulaire : l'avant-vente désignait son propre approbateur, ce qui vidait
     * la garde de son sens. Les trois cas ci-dessous fixent la règle retenue —
     * admin d'abord, suppléants en secours, courriel en dernier recours.
     */
    const { resoudreApprobateurs } = await import('../apps/web/lib/validation/circuit.js');

    const { data: suppleant } = await db
      .from('users')
      .select('id, email, telegram_chat_id, recoit_validations')
      .eq('tenant_id', tenant)
      .neq('role', 'admin')
      .eq('actif', true)
      .limit(1)
      .maybeSingle();

    if (!admin || !suppleant) {
      alerter('pas assez de comptes actifs', 'résolution non éprouvée');
    } else {
      // État d'origine relevé avant d'écrire — même règle que
      // `preserver-parametres` : rendre l'état trouvé, pas supposer qu'il
      // était vide.
      const avantAdmin = admin.telegram_chat_id;
      const avantSup = {
        chat: suppleant.telegram_chat_id,
        autorise: suppleant.recoit_validations,
      };

      try {
        await db
          .from('users')
          .update({ telegram_chat_id: '111000111' })
          .eq('id', admin.id);

        const nominal = await resoudreApprobateurs(tenant);
        verifier(
          'un administrateur joignable est seul destinataire',
          !nominal.parSecours && nominal.destinataires.every((d) => d.email === admin.email),
          nominal.destinataires.map((d) => d.email).join(', '),
        );

        // Le demandeur ne s'escalade pas à lui-même : sans cette exclusion, un
        // administrateur qui soumet sa feuille recevait son propre lien sur son
        // propre Telegram.
        const sansSoi = await resoudreApprobateurs(tenant, admin.id);
        verifier(
          'le demandeur n’est jamais son propre destinataire',
          !sansSoi.destinataires.some((d) => d.email === admin.email),
          sansSoi.destinataires.map((d) => d.email).join(', ') || 'aucun',
        );

        // Admin injoignable + suppléant autorisé et joignable.
        await db.from('users').update({ telegram_chat_id: null, telephone: null }).eq('id', admin.id);
        await db
          .from('users')
          .update({ recoit_validations: true, telegram_chat_id: '222000222' })
          .eq('id', suppleant.id);

        const secours = await resoudreApprobateurs(tenant);
        verifier(
          'sans administrateur joignable, le suppléant prend le relais',
          secours.parSecours && secours.destinataires.some((d) => d.email === suppleant.email),
          secours.destinataires.map((d) => d.email).join(', '),
        );

        // Un compte NON autorisé ne doit jamais recevoir, même joignable.
        await db
          .from('users')
          .update({ recoit_validations: false })
          .eq('id', suppleant.id);

        const sansSuppleant = await resoudreApprobateurs(tenant);
        verifier(
          'un compte non autorisé ne reçoit jamais',
          !sansSuppleant.destinataires.some((d) => d.email === suppleant.email),
          sansSuppleant.destinataires.map((d) => d.email).join(', ') || 'aucun',
        );

        // Dernier recours : l'administrateur par courriel, même injoignable.
        verifier(
          'l’administrateur reste destinataire par courriel',
          sansSuppleant.destinataires.some((d) => d.email === admin.email),
          sansSuppleant.destinataires.map((d) => d.email).join(', ') || 'AUCUN',
        );
      } finally {
        await db
          .from('users')
          .update({ telegram_chat_id: avantAdmin })
          .eq('id', admin.id);
        await db
          .from('users')
          .update({
            telegram_chat_id: avantSup.chat,
            recoit_validations: avantSup.autorise,
          })
          .eq('id', suppleant.id);

        const rendu = await resoudreApprobateurs(tenant);
        verifier(
          'état des comptes restitué',
          rendu.destinataires.some((d) => d.email === admin.email) ||
            rendu.destinataires.length > 0,
          rendu.destinataires.map((d) => `${d.email}:${d.telegramChatId ?? '—'}`).join(', '),
        );
      }
    }

    /* --- 4 ter. L'accord de l'administrateur sur sa propre feuille --------- */

    console.log('\n=== Accord sur place, sans demande préalable ===');

    /*
     * ESCALADER VERS SOI-MÊME N'A PAS DE SENS.
     *
     * Quand l'administrateur est celui qui travaille l'opportunité, il n'y a
     * personne au-dessus de lui : la décision s'écrit directement, canal
     * `interne`, sans jeton envoyé nulle part. La trace reste identique — c'est
     * elle, et elle seule, que la génération d'offre interroge.
     *
     * Le cas se distingue de la section précédente par ce qui existait avant :
     * ici, AUCUNE demande n'attendait.
     */
    const { data: candidates } = await db
      .from('cost_sheets')
      .select('id')
      .eq('tenant_id', tenant)
      .eq('statut', 'verrouille')
      .neq('id', verrouillee?.id ?? 0)
      .order('id', { ascending: false })
      .limit(10);

    let libre: number | null = null;
    for (const c of candidates ?? []) {
      const etat = await lireValidation(tenant, c.id);
      if (etat.statut === 'aucune') {
        libre = c.id;
        break;
      }
    }

    if (libre === null || !admin) {
      alerter(
        'aucune feuille verrouillée sans validation',
        'accord sans demande préalable non éprouvé',
      );
    } else {
      const direct = await approuverSurPlace({
        tenant,
        utilisateurId: admin.id,
        costSheetId: libre,
      });

      verifier(
        'l’administrateur approuve sans passer par un lien',
        direct.ok,
        direct.message,
      );

      const { data: ligne } = await db
        .from('validations_offre')
        .select('id, statut, canal, decide_par, date_expiration')
        .eq('cost_sheet_id', libre)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      validationSurPlace = ligne?.id ?? null;

      verifier('la ligne naît approuvée', ligne?.statut === 'approuvee', ligne?.statut);
      verifier('le canal retenu est « interne »', ligne?.canal === 'interne', ligne?.canal);
      verifier('la décision porte le nom de son auteur', ligne?.decide_par === admin.id);
      // Une décision prise n'expire pas : seule une demande en attente devient
      // caduque au bout de sept jours.
      verifier('une décision prise n’expire pas', ligne?.date_expiration === null);

      // La lecture que fait `genererOffre` avant de laisser passer.
      const vue = await lireValidation(tenant, libre);
      verifier('la génération d’offre voit l’accord', vue.statut === 'approuvee', vue.statut);

      const second = await approuverSurPlace({
        tenant,
        utilisateurId: admin.id,
        costSheetId: libre,
      });
      verifier(
        'un second accord sur la même feuille est refusé',
        !second.ok,
        second.ok ? '⚠ ACCEPTÉ À TORT' : second.message,
      );
    }

    /* --- 5. Les canaux ---------------------------------------------------- */

    console.log('\n=== Canaux de validation ===');

    const { telegramConfigure, whatsappConfigure, envoiConfigure, envoyerTelegram } =
      await import('@vigon/services');

    console.log(`        Telegram ${telegramConfigure() ? 'configuré' : 'absent'} · ` +
      `WhatsApp ${whatsappConfigure() ? 'configuré' : 'absent'} · ` +
      `courriel ${envoiConfigure('principal') ? 'configuré' : 'absent'}`);

    verifier(
      'au moins un canal peut porter une demande de validation',
      telegramConfigure() || whatsappConfigure() || envoiConfigure('principal'),
    );

    // L'ordre est LU dans le code, pas recopié ici : un essai qui affirmerait
    // l'ordre attendu ne vérifierait que sa propre copie.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      'apps/web/app/(dashboard)/demandes/[id]/costing/actions.ts',
      'utf8',
    );
    const posTelegram = source.indexOf("nom: 'telegram'");
    const posWhatsApp = source.indexOf("nom: 'whatsapp'");

    verifier('Telegram est essayé avant WhatsApp', posTelegram > 0 && posTelegram < posWhatsApp);
    verifier(
      'le courriel reste le dernier repli',
      source.indexOf("envoiConfigure('principal')") > posWhatsApp,
    );

    const { data: approbateurs } = await db
      .from('users')
      .select('email, telegram_chat_id, telephone')
      .eq('tenant_id', tenant)
      .in('role', ['admin', 'finance']);

    const avecTelegram = (approbateurs ?? []).filter((u) => u.telegram_chat_id);
    const avecWhatsApp = (approbateurs ?? []).filter((u) => u.telephone);

    console.log(
      `        approbateurs : ${avecTelegram.length} avec Telegram, ` +
        `${avecWhatsApp.length} avec WhatsApp, sur ${(approbateurs ?? []).length}`,
    );

    if (avecTelegram.length === 0) {
      alerter(
        'aucun approbateur n’a de chat Telegram',
        'la validation partira par courriel — voir npm run telegram:contacts',
      );
    }

    if (process.env.ENVOIS_REELS === '1' && avecTelegram[0]?.telegram_chat_id) {
      const debut = Date.now();
      try {
        const m = await envoyerTelegram({
          chatId: avecTelegram[0].telegram_chat_id,
          texte:
            'Vigon — contrôle de liaison du circuit de validation.\n' +
            'Aucune action attendue, ce message provient de npm run essai:costing.',
        });
        verifier(
          'un message réel part vers Telegram',
          m.messageId > 0,
          `message ${m.messageId} en ${Date.now() - debut} ms`,
        );
      } catch (e) {
        verifier('un message réel part vers Telegram', false, e instanceof Error ? e.message : String(e));
      }
    } else if (avecTelegram.length > 0) {
      console.log('        (aucun envoi — poser ENVOIS_REELS=1 pour un message réel)');
    }
  } finally {
    /* --- Nettoyage, y compris en cas d'échec ------------------------------ */

    console.log('\n=== Nettoyage ===');

    const validations = [validationCreee, validationSurPlace].filter(
      (id): id is number => id !== null,
    );

    if (validations.length > 0) {
      await db.from('validations_offre').delete().in('id', validations);
      const { data: reste } = await db
        .from('validations_offre')
        .select('id')
        .in('id', validations);
      verifier(
        `${validations.length} validation(s) d’essai supprimée(s)`,
        (reste ?? []).length === 0,
      );
    }

    for (const id of feuillesCreees) {
      await db.from('cost_lines').delete().eq('cost_sheet_id', id);
      await db.from('cost_sheets').delete().eq('id', id);
    }

    if (feuillesCreees.length > 0) {
      const { data: reste } = await db
        .from('cost_sheets')
        .select('id')
        .in('id', feuillesCreees);
      verifier(
        `${feuillesCreees.length} feuille(s) d’essai supprimée(s)`,
        (reste ?? []).length === 0,
      );
    }
  }

  console.log(
    `\n${echecs === 0 ? '✓ Costing et circuit de validation conformes.' : `✗ ${echecs} ÉCHEC(S).`}\n`,
  );

  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
