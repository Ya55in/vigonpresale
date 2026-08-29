/**
 * Éprouve l'envoi de l'offre au client, du transport jusqu'au contenu du message.
 *
 * POURQUOI CE HARNAIS EXISTE
 *
 * L'envoi de l'offre au client a échoué en production silencieuse (BUG-14) :
 * `valider.ts` appelait l'API Gmail directement au lieu du point d'envoi
 * unifié, et se privait du repli SMTP. Le bouton validait l'offre, puis
 * annonçait « envoi impossible » sur un compte parfaitement utilisable.
 *
 * Le contrôle statique de `essai:bout-en-bout` empêche la rechute. Celui-ci va
 * plus loin : il envoie RÉELLEMENT le message que le client recevrait, avec le
 * même gabarit et les mêmes données, et vérifie ce qu'il contient.
 *
 * ENVOIE UN VRAI COURRIEL — à la boîte de la plateforme elle-même
 * (`IMAP_CLIENT_USER`), jamais à un client. C'est la règle du projet : aucun
 * message d'essai ne part vers une adresse externe réelle.
 *
 * Usage : npm run essai:envoi-offre
 */
import { chargerEnv } from './charger-env.js';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

async function rest<T>(chemin: string): Promise<T> {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${chemin}`, {
    headers: { apikey: s, Authorization: `Bearer ${s}` },
  });
  return (await r.json()) as T;
}

async function main(): Promise<void> {
  chargerEnv();

  const destinataire = process.env.IMAP_CLIENT_USER;
  if (!destinataire) {
    console.error('\n✗ IMAP_CLIENT_USER absente : pas de boîte où écrire.\n');
    process.exit(1);
  }

  const services = await import('@vigon/services');
  const { urlApplication } = await import('@vigon/shared');

  /* --- 1. Le transport ---------------------------------------------------- */

  console.log('\n=== Transport ===');

  verifier(
    'un transport existe pour le compte principal',
    services.envoiConfigure('principal'),
    services.descriptionEnvoi('principal'),
  );

  if (!services.envoiConfigure('principal')) {
    console.error('\n✗ Sans transport, la suite n’a pas de sens.\n');
    process.exit(1);
  }

  /* --- 2. Le message, bâti comme le fait l'action ------------------------- */

  console.log('\n=== Message ===');

  const [offre] = await rest<
    { id: number; numero: string; titre: string | null; token_public: string; source_json: unknown }[]
  >('offres?select=id,numero,titre,token_public,source_json&token_public=not.is.null&source_json=not.is.null&limit=1');

  if (!offre) {
    console.error('\n✗ Aucune offre exploitable en base.\n');
    process.exit(1);
  }

  const boq = (offre.source_json ?? {}) as {
    totaux?: { totalTtc?: number; devise?: string };
    solution?: { titre?: string };
  };

  const lienPublic = `${urlApplication()}/offre/${offre.token_public}`;

  // Exactement le gabarit de `valider.ts` : un harnais qui reconstruirait le
  // message à sa façon ne vérifierait que sa propre reconstruction.
  const { buildEmailOffreHtml } = await import('../apps/web/lib/offres/envoi.js');

  const html = buildEmailOffreHtml({
    clientNom: 'Client d’essai',
    titreOffre: boq.solution?.titre ?? offre.titre ?? offre.numero,
    reference: offre.numero,
    lienPublic,
    validiteJours: 15,
    totalTtc: `${Number(boq.totaux?.totalTtc ?? 0).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
    })} ${boq.totaux?.devise ?? 'MAD'}`,
  });

  verifier('le lien public figure dans le message', html.includes(lienPublic), lienPublic);
  verifier('la référence de l’offre y figure', html.includes(offre.numero));

  // Le lien DOIT être absolu : un chemin relatif dans un courriel ne mène nulle
  // part, et c'est le genre de défaut qu'on ne voit qu'après l'envoi.
  verifier(
    'le lien est absolu',
    /^https?:\/\//.test(lienPublic),
    lienPublic.startsWith('http') ? 'oui' : '⚠ RELATIF',
  );

  verifier(
    'le lien ne pointe pas vers localhost',
    !lienPublic.includes('localhost') || process.env.NODE_ENV !== 'production',
    lienPublic.includes('localhost') ? 'localhost (acceptable hors production)' : 'domaine public',
  );

  /* --- 3. Le contrôle de fuite -------------------------------------------- */

  console.log('\n=== Fuite ===');

  const fournisseurs = await rest<{ nom: string }[]>('fournisseurs?select=nom');
  const cites = (fournisseurs ?? [])
    .map((f) => f.nom)
    .filter((nom) => nom && nom.length > 4 && html.includes(nom));

  verifier('aucun nom de fournisseur dans le courriel', cites.length === 0, cites.join(', ') || 'aucun');

  for (const mot of ['marge', 'prix_achat', 'costing']) {
    verifier(`le mot « ${mot} » est absent`, !html.toLowerCase().includes(mot));
  }

  /* --- 4. Le MIME du transport Gmail -------------------------------------- */

  console.log('\n=== MIME multipart (transport Gmail) ===');

  {
    // Assemblé à la main, et jamais exécuté tant que le SMTP est actif : une
    // faute de frontière ou de repli base64 ne se verrait qu'au jour de la
    // bascule, sur un envoi client. On le fait donc relire ici par le MÊME
    // analyseur que celui de la réception.
    const { simpleParser } = await import('mailparser');

    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
      'utf8',
    );

    const mime = services.construireMime({
      de: 'vigon@example.test',
      a: 'client@example.test',
      cc: ['copie@example.test'],
      sujet: 'Offre — contrôle d’assemblage (accentué)',
      html: '<p>Corps du message</p>',
      piecesJointes: [{ nom: 'offre.pdf', contenu: pdf, typeMime: 'application/pdf' }],
      entetes: { 'Auto-Submitted': 'auto-generated' },
    });

    const relu = await simpleParser(mime);

    verifier('le sujet accentué survit à l’encodage', relu.subject === 'Offre — contrôle d’assemblage (accentué)', relu.subject ?? '—');
    // `cc` est un objet OU un tableau selon le nombre d'en-têtes rencontrés :
    // mailparser ne normalise pas, et lire `.text` à l'aveugle rendrait vide sur
    // le cas multiple sans que rien ne le signale.
    const copies = [relu.cc ?? []].flat().map((a) => a.text).join(', ');

    verifier(
      'la copie visible est portée',
      copies.includes('copie@example.test'),
      copies || '(absente)',
    );
    verifier(
      'l’en-tête libre est posé',
      String(relu.headers.get('auto-submitted') ?? '') === 'auto-generated',
      String(relu.headers.get('auto-submitted') ?? '—'),
    );
    verifier('le corps HTML est lisible', String(relu.html ?? '').includes('Corps du message'));
    verifier('une pièce jointe est présente', relu.attachments.length === 1, `${relu.attachments.length}`);

    const jointe = relu.attachments[0];
    verifier('son nom est conservé', jointe?.filename === 'offre.pdf', jointe?.filename ?? '—');
    verifier('son type est conservé', jointe?.contentType === 'application/pdf', jointe?.contentType ?? '—');
    verifier(
      'son contenu est identique à l’octet près',
      Boolean(jointe && Buffer.compare(jointe.content, pdf) === 0),
      `${jointe?.content.length ?? 0} o contre ${pdf.length} o`,
    );

    // Sans pièce jointe, le message doit rester une partie SIMPLE : emballer
    // tout le flux dans un multipart changerait la forme de chaque RFQ.
    const nu = services.construireMime({
      de: 'vigon@example.test',
      a: 'client@example.test',
      sujet: 'Sans pièce jointe',
      html: '<p>Corps</p>',
    });
    verifier(
      'sans pièce jointe, aucun multipart',
      !nu.toLowerCase().includes('multipart/mixed'),
    );
  }

  /* --- 5. L'envoi réel ---------------------------------------------------- */

  console.log('\n=== Envoi réel ===');
  console.log(`  destinataire : ${destinataire} (la boîte de la plateforme)`);

  const marqueur = `essai-${Date.now().toString(36)}`;

  const message = await services.envoyer('principal', {
    a: destinataire,
    sujet: `Vigon — essai d'envoi d'offre (${marqueur})`,
    html,
    // Le message atterrit dans la boîte que le worker relève. Sans cet en-tête
    // il en ressort comme une demande client, consomme un appel au modèle et se
    // bloque faute d'articles — c'est l'origine de DM-2026-000022 à 24.
    // La mention est exacte : ce message est bien généré sans intervention
    // humaine, et `estCourrierAutomatique` l'écarte pour cette raison.
    entetes: { 'Auto-Submitted': 'auto-generated' },
  });

  verifier('le serveur a accepté le message', Boolean(message.messageId), message.messageId);
  verifier(
    'le transport employé est celui annoncé',
    services.descriptionEnvoi('principal').toLowerCase().includes(message.transport),
    `${message.transport} vs « ${services.descriptionEnvoi('principal')} »`,
  );

  console.log(
    `\n${echecs === 0 ? '✓ L’envoi de l’offre au client fonctionne, message compris.' : `✗ ${echecs} ÉCHEC(S).`}\n`,
  );

  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
