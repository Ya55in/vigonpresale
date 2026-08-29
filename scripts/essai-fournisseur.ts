/**
 * Joue le rôle du fournisseur : dépose sa réponse dans la boîte avant-vente.
 *
 * Le message est écrit par IMAP APPEND avec les en-têtes `In-Reply-To` et
 * `References` de la consultation d'origine — c'est exactement ce qu'un vrai
 * fournisseur produit en cliquant « Répondre ». L'appariement au fil, la
 * classification et l'extraction sont donc éprouvés sur un message réel, sans
 * dépendre d'une boîte tierce.
 *
 * Usage : npm run essai:fournisseur -- devis      [id_consultation]
 *         npm run essai:fournisseur -- precision  [id_consultation]
 *         npm run essai:fournisseur -- absence    [id_consultation]
 *         npm run essai:fournisseur -- illisible  [id_consultation]
 *         npm run essai:fournisseur -- rebond     [id_consultation]
 *
 * Sans identifiant, la consultation envoyée la plus récente est reprise.
 */
import { ImapFlow } from 'imapflow';
import * as XLSX from 'xlsx';

import { clientAdmin, tenantId } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

type Nature = 'devis' | 'precision' | 'absence' | 'illisible' | 'rebond';

type Consultation = {
  id: number;
  marque: string | null;
  sujet: string | null;
  message_id: string | null;
  fournisseur_email: string | null;
  fournisseur_nom: string | null;
  demande_id: number | null;
};

/** Corps par nature de réponse. Aucun ne cite le client final : le fournisseur ne le connaît pas. */
function corps(nature: Nature, c: Consultation, articles: string[]): string {
  const marque = c.marque ?? 'les references demandees';

  switch (nature) {
    case 'devis':
      return `Bonjour,

Suite a votre demande, veuillez trouver notre proposition pour ${marque}.
Le detail chiffre figure dans le fichier joint.

Conditions :
- Validite de l'offre : 30 jours
- Delai de livraison : 3 semaines apres commande
- Paiement : 30 jours fin de mois
- Garantie constructeur 3 ans

Nous restons a votre disposition.

Cordialement,
Karim Belhaj
Responsable Grands Comptes
Medina Networks - Casablanca`;

    case 'precision':
      return `Bonjour,

Merci pour votre consultation. Avant de vous chiffrer ${marque}, nous avons
besoin de quelques precisions :

- Les bornes doivent-elles etre livrees avec leurs injecteurs PoE, ou le
  switch fournit-il l'alimentation ?
- Souhaitez-vous les licences de gestion centralisee sur 3 ou 5 ans ?
- La pose est-elle a notre charge, ou uniquement la fourniture ?

Des reception de ces elements, nous vous transmettons notre offre sous 48h.

Cordialement,
Karim Belhaj
Medina Networks`;

    case 'illisible':
      return `Bonjour,

Vous trouverez ci-joint notre devis pour ${marque}.

Cordialement,
Karim Belhaj
Medina Networks`;

    case 'absence':
      return `Je suis absent du bureau jusqu'au 22 septembre et je consulte mes
messages de maniere irreguliere.

Pour toute urgence commerciale, merci de contacter notre standard.

Karim Belhaj
Medina Networks`;

    case 'rebond':
      return `Delivery incomplete

There was a temporary problem delivering your message. Gmail will retry.

The response was:
550 5.1.1 The email account that you tried to reach does not exist.

----- Original message -----
Subject: ${c.sujet ?? 'Demande de devis'}
${articles.map((a) => `  - ${a}`).join('\n')}`;
  }
}

/** Devis chiffré, tel qu'un fournisseur l'enverrait en pièce jointe. */
function classeurDevis(articles: { designation: string; reference: string | null; quantite: number }[]): Buffer {
  const lignes: (string | number)[][] = [
    ['Designation', 'Reference', 'Quantite', 'Prix unitaire HT (MAD)', 'Remise %', 'Disponibilite'],
  ];

  // Prix dérivés de la référence : reproductible d'une exécution à l'autre,
  // et suffisamment dispersé pour que la comparaison ait du sens.
  for (const [i, a] of articles.entries()) {
    const base = 3_200 + ((a.reference?.length ?? 6) * 470 + i * 1_130);
    lignes.push([
      a.designation,
      a.reference ?? '-',
      a.quantite,
      Number(base.toFixed(2)),
      i % 2 === 0 ? 5 : 0,
      i % 3 === 0 ? 'En stock' : 'Sur commande 3 semaines',
    ]);
  }

  const feuille = XLSX.utils.aoa_to_sheet(lignes);
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Devis');

  return XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function construireMime(
  nature: Nature,
  c: Consultation,
  destinataire: string,
  articles: { designation: string; reference: string | null; quantite: number }[],
): string {
  const limite = `----vigon-fournisseur-${Date.now()}`;
  const enBase64 = (s: string) => s.match(/.{1,76}/g)?.join('\r\n') ?? s;

  const expediteur =
    nature === 'rebond'
      ? 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>'
      : `${c.fournisseur_nom ?? 'Medina Networks'} <${c.fournisseur_email}>`;

  const enTetes = [
    `From: ${expediteur}`,
    `To: ${destinataire}`,
    `Subject: ${nature === 'rebond' ? 'Delivery Status Notification (Failure)' : `Re: ${c.sujet ?? 'Demande de devis'}`}`,
    `Message-ID: <fournisseur-${nature}-${Date.now()}@medina-networks.ma>`,
    `Date: ${new Date().toUTCString()}`,
    // Ce qui rattache la réponse à la consultation. Sans ces en-têtes, le flux
    // de réception créerait une demande client fantôme.
    ...(c.message_id ? [`In-Reply-To: ${c.message_id}`, `References: ${c.message_id}`] : []),
    `MIME-Version: 1.0`,
  ];

  // Réponse automatique : signalée comme telle, comme le ferait un serveur.
  if (nature === 'absence') enTetes.push('Auto-Submitted: auto-replied');

  const texte = corps(nature, c, articles.map((a) => `${a.quantite} x ${a.designation}`));

  if (nature === 'rebond') {
    // Un avis de non-remise conforme : c'est le `report-type` qui le définit.
    return [
      ...enTetes,
      `Content-Type: multipart/report; report-type=delivery-status; boundary="${limite}"`,
      ``,
      `--${limite}`,
      `Content-Type: text/plain; charset=utf-8`,
      ``,
      texte,
      ``,
      `--${limite}`,
      `Content-Type: message/delivery-status`,
      ``,
      `Action: failed`,
      `Status: 5.1.1`,
      `Final-Recipient: rfc822; ${c.fournisseur_email}`,
      ``,
      `--${limite}--`,
      ``,
    ].join('\r\n');
  }

  if (nature === 'absence' || nature === 'precision') {
    return [...enTetes, `Content-Type: text/plain; charset=utf-8`, ``, texte, ``].join('\r\n');
  }

  // `devis` et `illisible` portent une pièce jointe — valide dans un cas,
  // volontairement corrompue dans l'autre.
  const piece =
    nature === 'devis'
      ? classeurDevis(articles).toString('base64')
      : Buffer.from('%PDF-1.4 ceci n est pas un PDF exploitable').toString('base64');

  const nomPiece = nature === 'devis' ? 'devis-medina-networks.xlsx' : 'devis.pdf';
  const typePiece =
    nature === 'devis'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/pdf';

  return [
    ...enTetes,
    `Content-Type: multipart/mixed; boundary="${limite}"`,
    ``,
    `--${limite}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    texte,
    ``,
    `--${limite}`,
    `Content-Type: ${typePiece}; name="${nomPiece}"`,
    `Content-Disposition: attachment; filename="${nomPiece}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    enBase64(piece),
    ``,
    `--${limite}--`,
    ``,
  ].join('\r\n');
}

async function main(): Promise<void> {
  chargerEnv();

  const nature = (process.argv[2] ?? 'devis').toLowerCase() as Nature;
  const NATURES: Nature[] = ['devis', 'precision', 'absence', 'illisible', 'rebond'];

  if (!NATURES.includes(nature)) {
    console.error(`Nature inconnue : « ${nature} ». Disponibles : ${NATURES.join(', ')}.`);
    process.exit(1);
  }

  const idArg = process.argv.slice(3).find((a) => /^\d+$/.test(a));

  const db = clientAdmin();
  const tenant = await tenantId();

  const requete = db
    .from('consultations')
    .select('id, marque, sujet, message_id, fournisseur_email, fournisseur_nom, demande_id')
    .eq('tenant_id', tenant)
    .not('message_id', 'is', null);

  const { data: consultation } = idArg
    ? await requete.eq('id', Number(idArg)).maybeSingle()
    : await requete.order('date_envoi_reelle', { ascending: false }).limit(1).maybeSingle();

  if (!consultation) {
    console.error(
      'Aucune consultation envoyée. Préparer et envoyer une consultation avant de jouer le fournisseur.',
    );
    process.exit(1);
  }

  const { data: articles } = await db
    .from('demande_items')
    .select('designation, reference, quantite')
    .eq('demande_id', consultation.demande_id ?? -1)
    .order('ligne_num');

  const hote = process.env.IMAP_CLIENT_HOST;
  const utilisateur = process.env.IMAP_CLIENT_USER;
  const motDePasse = process.env.IMAP_CLIENT_PASSWORD;

  if (!hote || !utilisateur || !motDePasse) {
    throw new Error('IMAP_CLIENT_HOST, IMAP_CLIENT_USER et IMAP_CLIENT_PASSWORD requis.');
  }

  const client = new ImapFlow({
    host: hote,
    port: Number(process.env.IMAP_CLIENT_PORT ?? 993),
    secure: true,
    auth: { user: utilisateur, pass: motDePasse },
    logger: false,
  });

  await client.connect();

  try {
    const boite = process.env.IMAP_CLIENT_MAILBOX ?? 'INBOX';
    const mime = construireMime(
      nature,
      consultation as Consultation,
      utilisateur,
      (articles ?? []).map((a) => ({
        designation: a.designation,
        reference: a.reference,
        quantite: Number(a.quantite),
      })),
    );

    const resultat = await client.append(boite, mime, ['\\Recent']);

    console.log(`✓ Réponse « ${nature} » déposée dans ${boite}.`);
    console.log(`  consultation #${consultation.id} — ${consultation.marque}`);
    console.log(`  de ${nature === 'rebond' ? 'MAILER-DAEMON' : consultation.fournisseur_email}`);
    console.log(`  en réponse à ${consultation.message_id}`);
    if (resultat && typeof resultat === 'object' && 'uid' in resultat) {
      console.log(`  uid = ${String(resultat.uid)}`);
    }
    console.log('\nLe worker la traitera au prochain cycle (60 s).');
  } finally {
    await client.logout().catch(() => undefined);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
