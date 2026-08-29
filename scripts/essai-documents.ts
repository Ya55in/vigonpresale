/**
 * Éprouve l'émission des documents financiers : BC, pro-forma, facture.
 *
 * Le point à défendre n'est pas l'insertion — c'est le GEL. Un document parti
 * chez un client ne doit jamais changer parce qu'une donnée a bougé après coup,
 * et c'est précisément le genre d'écart qu'on ne découvre qu'au litige.
 *
 * Ce harnais le vérifie pour de vrai : il renomme le client APRÈS émission et
 * relit le document. Si la raison sociale suit, le gel est une intention et non
 * une garantie.
 *
 * ÉCRIT EN BASE. Tout est défait dans un `finally` : documents supprimés, nom
 * du client restauré. En cas d'arrêt brutal, la valeur d'origine est imprimée
 * en clair au moment où elle est modifiée, pour un rattrapage à la main.
 *
 * Usage : npm run essai:documents
 */
import {
  LIBELLES_DOCUMENT,
  PREFIXES_DOCUMENT,
  calculerTotaux,
  contenuDocumentSchema,
  type TypeDocument,
} from '@vigon/shared';

import { emettreDocument } from '../apps/web/lib/documents/emission.js';
import { lireDocument, lireDocuments } from '../apps/web/lib/documents/requetes.js';

import { chargerEnv } from './charger-env.js';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

function entetes(): Record<string, string> {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: s, Authorization: `Bearer ${s}`, 'Content-Type': 'application/json' };
}

async function rest<T>(chemin: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${chemin}`, {
    ...init,
    headers: { ...entetes(), ...(init?.headers ?? {}) },
  });
  const texte = await r.text();
  return (texte ? JSON.parse(texte) : null) as T;
}

async function main(): Promise<void> {
  chargerEnv();

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('\n✗ Variables Supabase absentes.\n');
    process.exit(1);
  }

  /* --- Cas d'essai --------------------------------------------------------- */

  const approuvees = await rest<
    { id: number; numero: string; tenant_id: string; demande_id: number }[]
  >('offres?select=id,numero,tenant_id,demande_id&statut=eq.approuvee&limit=1');

  if (!approuvees?.length) {
    console.error('\n✗ Aucune offre approuvée en base : rien à facturer.\n');
    process.exit(1);
  }

  const offre = approuvees[0]!;
  const tenant = offre.tenant_id;

  const [utilisateur] = await rest<{ id: string }[]>(
    `users?select=id&tenant_id=eq.${tenant}&role=eq.admin&limit=1`,
  );

  if (!utilisateur) {
    console.error('\n✗ Aucun administrateur pour ce locataire.\n');
    process.exit(1);
  }

  const [demande] = await rest<{ client_id: number | null }[]>(
    `demandes?select=client_id&id=eq.${offre.demande_id}`,
  );

  console.log(`\nOffre ${offre.numero} (approuvée), demande ${offre.demande_id}`);

  const emis: number[] = [];
  /** Fichiers déposés dans le bucket, à retirer avec les lignes qu'ils servent. */
  const cheminsPdf: string[] = [];
  let clientId: number | null = null;
  let nomOrigine: string | null = null;

  try {
    /* --- 1. Les trois types s'émettent ------------------------------------- */

    console.log('\n=== Émission des trois types ===');

    for (const type of ['bon_commande', 'proforma', 'facture'] as TypeDocument[]) {
      const r = await emettreDocument({
        tenant,
        utilisateurId: utilisateur.id,
        offreId: offre.id,
        type,
      });

      verifier(
        `${LIBELLES_DOCUMENT[type]} émis`,
        r.ok,
        r.ok ? r.numero : r.message,
      );

      if (r.ok) {
        emis.push(r.id);
        verifier(
          `${r.numero} porte le préfixe ${PREFIXES_DOCUMENT[type]}`,
          r.numero.startsWith(`${PREFIXES_DOCUMENT[type]}-`),
        );
      }
    }

    if (emis.length === 0) throw new Error('Aucun document émis : la suite n’a pas de sens.');

    /* --- 2. Totaux recalculés depuis les lignes ---------------------------- */

    console.log('\n=== Totaux ===');

    const doc = await lireDocument(tenant, emis[0]!);

    verifier('le document se relit', Boolean(doc));
    verifier('le contenu figé est valide au schéma', Boolean(doc?.contenu));

    if (doc?.contenu) {
      const attendus = calculerTotaux(doc.contenu.lignes, doc.contenu.totaux.tvaPct);

      verifier(
        'total HT = somme des lignes',
        Math.abs(attendus.totalHt - doc.contenu.totaux.totalHt) < 0.005,
        `${doc.contenu.totaux.totalHt} vs ${attendus.totalHt}`,
      );
      verifier(
        'total TTC = HT + TVA, au centime',
        Math.abs(attendus.totalTtc - doc.contenu.totaux.totalTtc) < 0.005,
        `${doc.contenu.totaux.totalTtc}`,
      );
      // Les colonnes servent les listes et les KPI ; le contenu figé sert le
      // document. Deux sources d'un même montant qui divergent, c'est un litige.
      verifier(
        'colonnes et contenu figé s’accordent',
        Math.abs(doc.totalTtc - doc.contenu.totaux.totalTtc) < 0.005,
        `${doc.totalTtc} vs ${doc.contenu.totaux.totalTtc}`,
      );

      // Un total de ligne repris de la source plutôt que recalculé passerait ce
      // contrôle-ci en silence : on refait chaque ligne.
      const lignesFausses = doc.contenu.lignes.filter(
        (l) => Math.abs(l.quantite * l.prixUnitaireHt - l.totalHt) > 0.005,
      );
      verifier('chaque ligne est cohérente', lignesFausses.length === 0, `${lignesFausses.length} fausse(s)`);
    }

    /* --- 3. Le gel, éprouvé et non supposé --------------------------------- */

    console.log('\n=== Gel du contenu ===');

    clientId = demande?.client_id ?? null;

    if (!clientId) {
      console.log('  ~~    demande sans client : le gel de la raison sociale n’est pas éprouvable');
    } else {
      const [client] = await rest<{ nom: string }[]>(`clients?select=nom&id=eq.${clientId}`);
      nomOrigine = client?.nom ?? null;

      const nomFige = doc?.contenu?.client.nom ?? null;
      verifier('la raison sociale est recopiée dans le document', Boolean(nomFige), nomFige ?? '—');

      console.log(`        nom d'origine : « ${nomOrigine} » (à restaurer si le script casse)`);

      await rest(`clients?id=eq.${clientId}`, {
        method: 'PATCH',
        body: JSON.stringify({ nom: 'ESSAI — raison sociale modifiée' }),
      });

      const apres = await lireDocument(tenant, emis[0]!);

      verifier(
        'le document ne suit PAS le changement de raison sociale',
        apres?.contenu?.client.nom === nomFige,
        `figé « ${apres?.contenu?.client.nom} », attendu « ${nomFige} »`,
      );
    }

    /* --- 4. Garde sur l'approbation ---------------------------------------- */

    console.log('\n=== Garde ===');

    const [nonApprouvee] = await rest<{ id: number; numero: string; statut: string }[]>(
      `offres?select=id,numero,statut&tenant_id=eq.${tenant}&statut=neq.approuvee&limit=1`,
    );

    if (nonApprouvee) {
      const refus = await emettreDocument({
        tenant,
        utilisateurId: utilisateur.id,
        offreId: nonApprouvee.id,
        type: 'facture',
      });

      verifier(
        `facture refusée sur une offre « ${nonApprouvee.statut} »`,
        !refus.ok,
        refus.ok ? '⚠ ÉMISE À TORT' : refus.message,
      );

      if (refus.ok) emis.push(refus.id);
    }

    const cloisonnement = await emettreDocument({
      tenant: '00000000-0000-0000-0000-000000000000',
      utilisateurId: utilisateur.id,
      offreId: offre.id,
      type: 'facture',
    });

    verifier(
      'un autre locataire ne peut pas facturer cette offre',
      !cloisonnement.ok,
      cloisonnement.ok ? '⚠ ÉMISE À TORT' : cloisonnement.message,
    );

    if (cloisonnement.ok) emis.push(cloisonnement.id);

    /* --- 5. Listage de l'affaire ------------------------------------------- */

    console.log('\n=== Listage ===');

    const liste = await lireDocuments(tenant, offre.demande_id);

    verifier(
      'les documents émis apparaissent sur l’affaire',
      emis.every((id) => liste.some((d) => d.id === id)),
      `${liste.length} document(s)`,
    );

    verifier(
      'tous les contenus se relisent',
      liste.every((d) => contenuDocumentSchema.safeParse(d.contenu).success),
    );

    /* --- 6. Le PDF envoyé au client ---------------------------------------- */

    console.log('\n=== PDF ===');

    const aEnvoyer = liste.find((d) => emis.includes(d.id) && d.contenu);

    if (!aEnvoyer) {
      verifier('un document est disponible pour le rendu PDF', false);
    } else {
      const { produirePdfDocument } = await import('../apps/web/lib/documents/pdf.js');
      const pdf = await produirePdfDocument(aEnvoyer, tenant);
      cheminsPdf.push(pdf.chemin);

      // Un PDF valide commence par « %PDF- » : le contrôle est grossier mais il
      // attrape le cas qui compte — un rendu qui rend une chaîne d'erreur ou un
      // tampon vide, et qu'on n'aurait vu qu'en l'ouvrant.
      verifier(
        'le PDF est rendu',
        pdf.buffer.subarray(0, 5).toString() === '%PDF-',
        `${(pdf.buffer.length / 1024).toFixed(1)} Ko — ${pdf.nomFichier}`,
      );
      verifier('le PDF est archivé et signé', pdf.url !== null);

      // Le logo pèse une centaine de kilo-octets : sans lui le fichier tombe
      // sous les 10 Ko. C'est le seul contrôle qui distingue un PDF complet
      // d'un PDF dont l'image a été silencieusement omise.
      verifier(
        'le logo est bien embarqué',
        pdf.buffer.length > 20_000,
        `${(pdf.buffer.length / 1024).toFixed(1)} Ko`,
      );

      const { buildEmailDocumentHtml, sujetEmailDocument } = await import(
        '../apps/web/lib/documents/envoi.js'
      );

      const sujet = sujetEmailDocument({
        libelleType: LIBELLES_DOCUMENT[aEnvoyer.type],
        numero: aEnvoyer.numero,
        objet: aEnvoyer.contenu!.objet,
      });

      const corps = buildEmailDocumentHtml({
        libelleType: LIBELLES_DOCUMENT[aEnvoyer.type],
        numero: aEnvoyer.numero,
        clientNom: aEnvoyer.contenu!.client.nom,
        objet: aEnvoyer.contenu!.objet,
        totalTtc: `${aEnvoyer.totalTtc} ${aEnvoyer.devise}`,
        dateEcheance: null,
        nomFichier: pdf.nomFichier,
      });

      verifier('le sujet porte le numéro du document', sujet.includes(aEnvoyer.numero), sujet);

      // Même règle absolue que pour l'offre : rien d'interne ne sort. Le
      // document financier porte des prix de VENTE, jamais d'achat ni de marge.
      for (const mot of ['marge', 'prix_achat', 'costing', 'fournisseur']) {
        verifier(
          `le mot « ${mot} » est absent du courriel`,
          !corps.toLowerCase().includes(mot),
        );
      }

      const nomEchappe = aEnvoyer.contenu!.client.nom.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      verifier(
        'le contenu venu de la base est échappé',
        !corps.includes('<script'),
        `nom rendu : ${nomEchappe.slice(0, 40)}`,
      );

      // Aucun envoi réel ici : le transport est déjà éprouvé par
      // `essai:envoi-offre`, et ce harnais ne doit pas écrire dans la boîte.
      console.log('        (aucun message expédié — voir essai:envoi-offre)');
    }
  } finally {
    /* --- Nettoyage, y compris en cas d'échec ------------------------------- */

    console.log('\n=== Nettoyage ===');

    if (clientId && nomOrigine) {
      await rest(`clients?id=eq.${clientId}`, {
        method: 'PATCH',
        body: JSON.stringify({ nom: nomOrigine }),
      });
      const [verif] = await rest<{ nom: string }[]>(`clients?select=nom&id=eq.${clientId}`);
      verifier('raison sociale restaurée', verif?.nom === nomOrigine, verif?.nom ?? '—');
    }

    for (const id of emis) {
      await rest(`audit_events?entite=eq.documents_financiers&entite_id=eq.${id}`, {
        method: 'DELETE',
      });
      await rest(`documents_financiers?id=eq.${id}`, { method: 'DELETE' });
    }

    const restants = await rest<{ id: number }[]>(
      `documents_financiers?select=id&id=in.(${emis.join(',') || '0'})`,
    );
    verifier(`${emis.length} document(s) supprimé(s)`, (restants ?? []).length === 0);

    if (cheminsPdf.length > 0) {
      const { clientAdmin } = await import('@vigon/services');
      const { error } = await clientAdmin().storage.from('offres').remove(cheminsPdf);
      verifier(
        `${cheminsPdf.length} PDF retiré(s) du stockage`,
        !error,
        error?.message ?? cheminsPdf.join(', '),
      );
    }
  }

  console.log(`\n${echecs === 0 ? '✓ Émission des documents conforme.' : `✗ ${echecs} ÉCHEC(S).`}\n`);
  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
