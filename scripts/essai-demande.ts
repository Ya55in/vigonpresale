/**
 * Dépose un message de test dans la boîte avant-vente, via IMAP APPEND.
 *
 * Évite de dépendre d'un envoi SMTP externe pour valider le flux de réception :
 * le message est écrit directement dans la boîte, non lu, exactement comme s'il
 * venait d'arriver.
 *
 * Plusieurs scénarios plutôt qu'un seul : éprouver le flux toujours sur le même
 * client et les mêmes marques finit par ne plus rien démontrer — le sourcing
 * trouve ses fournisseurs en base et l'extraction reconnaît des libellés déjà
 * vus. Chaque scénario apporte un secteur, des marques et un format différents.
 *
 * Usage : npm run essai:demande            (clinique, par défaut)
 *         npm run essai:demande -- hotel
 */
import AdmZip from 'adm-zip';
import { ImapFlow } from 'imapflow';
import * as XLSX from 'xlsx';

import { chargerEnv } from './charger-env.js';

type Scenario = {
  expediteur: string;
  email: string;
  sujet: string;
  corps: string;
  /** En-têtes du tableau joint, volontairement différents d'un cas à l'autre. */
  colonnes: string[];
  articles: (string | number)[][];
  annexe: { nom: string; contenu: string };
};

const SCENARIOS: Record<string, Scenario> = {
  clinique: {
    expediteur: 'Nadia Bensaid',
    email: 'nadia.bensaid@clinique-alamal.ma',
    sujet: 'Demande de devis - equipement salle serveur',
    corps: `Bonjour,

Dans le cadre de l'equipement de notre nouvelle salle serveur, nous souhaitons
recevoir une offre pour le materiel detaille dans le fichier joint.

Nous aurions besoin d'une reponse avant le 15 septembre 2026.

Cordialement,
Nadia Bensaid
Responsable IT - Clinique Al Amal
nadia.bensaid@clinique-alamal.ma`,
    colonnes: ['Designation', 'Reference', 'Quantite', 'Precisions'],
    articles: [
      ['Switch administrable PoE+ 48 ports', 'C9200L-48P-4G-E', 3, '4 uplinks SFP+, stackable'],
      ['Onduleur rack 3000VA', 'SRT3000RMXLI', 2, 'Autonomie 15 min a pleine charge'],
      ['Point d acces WiFi 6 interieur', 'U6-PRO', 12, 'Montage plafond, PoE'],
      ['Ecran 27 pouces QHD', 'P2723DE', 8, 'USB-C, pied reglable'],
    ],
    annexe: {
      nom: 'contraintes-techniques.txt',
      contenu:
        'Contraintes du site :\n' +
        '- Baie 42U existante, alimentation redondee.\n' +
        '- Le switch doit alimenter en PoE les 12 points d acces.\n' +
        '- Installation prevue hors heures ouvrables.\n',
    },
  },

  hotel: {
    expediteur: 'Siham Ouazzani',
    email: 's.ouazzani@riad-andalous.ma',
    sujet: "Appel d'offres - reseau et videosurveillance - Riad Andalous Marrakech",
    corps: `Madame, Monsieur,

Le groupe Riad Andalous ouvre un etablissement de 120 chambres a Marrakech au
premier trimestre 2027. Nous consultons plusieurs integrateurs pour la
couverture WiFi des chambres et espaces communs, la videosurveillance des
parties communes et le coeur de reseau.

Le detail quantitatif figure dans le tableau joint. L'annexe precise les
contraintes de genie civil et les exigences de conformite.

Merci de nous faire parvenir votre proposition avant le 30 septembre 2026.

Bien cordialement,
Siham Ouazzani
Directrice des Systemes d'Information
Riad Andalous Hotels & Resorts - Casablanca
s.ouazzani@riad-andalous.ma`,
    // Colonnes en anglais et ordre différent : l'extraction ne doit pas
    // dépendre d'un gabarit de tableau particulier.
    colonnes: ['Item', 'Qty', 'Manufacturer part number', 'Notes'],
    articles: [
      ['Borne WiFi 6E exterieure', 24, 'AP-635', 'IP67, antennes integrees, PoE++'],
      ['Switch coeur de reseau 24 ports 10G', 2, 'JL684A', 'Empilable, alimentation redondante'],
      ['Camera IP dome 4MP', 36, 'DS-2CD2143G2-I', 'Vision nocturne 30m, IK10'],
      ['Enregistreur reseau 32 voies', 2, 'DS-7732NXI-K4', 'RAID 5, 4 baies disques'],
      ['Pare-feu UTM', 1, 'FG-100F', 'Haute disponibilite, filtrage applicatif'],
    ],
    annexe: {
      nom: 'contraintes-chantier.txt',
      contenu:
        'Contraintes du chantier :\n' +
        '- Batiment classe : aucun percement en facade, chemins de cables apparents interdits.\n' +
        '- Alimentation PoE++ obligatoire sur les bornes exterieures.\n' +
        '- Conformite RGPD exigee sur la conservation des flux video (30 jours maximum).\n' +
        '- Reception du gros oeuvre prevue en janvier 2027.\n',
    },
  },
};

const nomScenario = (process.argv[2] ?? 'clinique').toLowerCase();
function scenarioOuSortie(nom: string): Scenario {
  const trouve = SCENARIOS[nom];
  if (trouve) return trouve;

  console.error(
    `Scénario inconnu : « ${nom} ». Disponibles : ${Object.keys(SCENARIOS).join(', ')}.`,
  );
  process.exit(1);
}

// Passer par une fonction plutôt qu'une garde en ligne : le rétrécissement de
// type d'un `const` de module se perd dans les closures qui l'utilisent plus
// bas, et TypeScript le redonnait pour « possiblement undefined » à chaque
// usage.
const SCENARIO = scenarioOuSortie(nomScenario);

/** Tableau des articles, comme un client l'enverrait réellement. */
function classeurArticles(): Buffer {
  const feuille = XLSX.utils.aoa_to_sheet([SCENARIO.colonnes, ...SCENARIO.articles]);
  const classeur = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(classeur, feuille, 'Besoins');

  return XLSX.write(classeur, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Archive contenant une note complémentaire, pour éprouver le chemin ZIP. */
function archiveAnnexe(): Buffer {
  const zip = new AdmZip();
  zip.addFile(SCENARIO.annexe.nom, Buffer.from(SCENARIO.annexe.contenu, 'utf8'));
  return zip.toBuffer();
}

/** Construit un message MIME multipart complet. */
function construireMime(destinataire: string): string {
  const limite = `----vigon-essai-${Date.now()}`;
  const xlsx = classeurArticles().toString('base64');
  const zip = archiveAnnexe().toString('base64');

  const enBase64 = (s: string) => s.match(/.{1,76}/g)?.join('\r\n') ?? s;

  const domaine = SCENARIO.email.split('@')[1];

  return [
    `From: ${SCENARIO.expediteur} <${SCENARIO.email}>`,
    `To: ${destinataire}`,
    `Subject: ${SCENARIO.sujet}`,
    `Message-ID: <essai-${Date.now()}@${domaine}>`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${limite}"`,
    ``,
    `--${limite}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    SCENARIO.corps,
    ``,
    `--${limite}`,
    `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="besoins.xlsx"`,
    `Content-Disposition: attachment; filename="besoins.xlsx"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    enBase64(xlsx),
    ``,
    `--${limite}`,
    `Content-Type: application/zip; name="annexes.zip"`,
    `Content-Disposition: attachment; filename="annexes.zip"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    enBase64(zip),
    ``,
    `--${limite}--`,
    ``,
  ].join('\r\n');
}

async function main(): Promise<void> {
  chargerEnv();

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
    const resultat = await client.append(boite, construireMime(utilisateur), ['\\Recent']);

    console.log(`✓ Scénario « ${nomScenario} » déposé dans ${boite}.`);
    console.log(`  de ${SCENARIO.expediteur} <${SCENARIO.email}>`);
    console.log(
      `  2 pièces jointes : besoins.xlsx (${SCENARIO.articles.length} articles) + annexes.zip`,
    );
    if (resultat && typeof resultat === 'object' && 'uid' in resultat) {
      console.log(`  uid = ${String(resultat.uid)}`);
    }
    console.log('\nLancer ensuite : npm run dev:worker');
  } finally {
    await client.logout().catch(() => undefined);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
