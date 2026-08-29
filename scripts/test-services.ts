/**
 * Valide chaque service externe et l'extraction documentaire.
 *
 * Un service sans clé est rapporté « non configuré » et n'échoue pas : le but
 * est de savoir ce qui marche aujourd'hui, pas d'imposer toutes les clés.
 * Sortie non nulle uniquement si un service CONFIGURÉ est en panne.
 *
 * Usage : npm run test:services
 */
import { z } from 'zod';

import AdmZip from 'adm-zip';
import * as XLSX from 'xlsx';

import { chargerEnv } from './charger-env.js';

import { extraireLot } from '@vigon/extraction';
import {
  ErreurIA,
  descriptionIA,
  firecrawlConfigure,
  fournisseurAnthropic,
  fournisseurCompatible,
  fournisseurGemini,
  fournisseurGroq,
  fournisseurOpenAI,
  gammaConfigure,
  genererJson,
  imapConfigure,
  listerModelesGroq,
  rechercher,
  verifierEnvoi,
  envoiConfigure,
  verifierAccesImap,
  type FournisseurIA,
} from '@vigon/services';

type Etat = 'ok' | 'ignore' | 'echec' | 'avertissement';
const resultats: { service: string; etat: Etat; detail: string }[] = [];

const PUCES: Record<Etat, string> = {
  ok: '✓',
  ignore: '–',
  echec: '✗',
  avertissement: '!',
};

function noter(service: string, etat: Etat, detail: string): void {
  resultats.push({ service, etat, detail });
  console.log(`${PUCES[etat]} ${service.padEnd(22)} ${detail}`);
}

async function tester(
  service: string,
  configure: boolean,
  variables: string,
  fn: () => Promise<string>,
  /** Un service non critique en panne avertit sans faire échouer le script. */
  options: { critique?: boolean } = {},
): Promise<void> {
  if (!configure) {
    noter(service, 'ignore', `non configuré (${variables})`);
    return;
  }
  try {
    noter(service, 'ok', await fn());
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    noter(service, options.critique === false ? 'avertissement' : 'echec', detail);
  }
}

/** Extraction : round-trip local sur un TXT, un XLSX et un ZIP imbriqué. */
async function testerExtraction(): Promise<void> {
  try {
    const feuille = XLSX.utils.aoa_to_sheet([
      ['Désignation', 'Référence', 'Quantité'],
      ['Switch PoE+ 48 ports', 'C9200L-48P-4G-E', 3],
    ]);
    const classeur = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(classeur, feuille, 'Besoins');
    const xlsxBuffer = XLSX.write(classeur, {
      type: 'buffer',
      bookType: 'xlsx',
    }) as Buffer;

    const zip = new AdmZip();
    zip.addFile('specs.txt', Buffer.from('3 switchs Cisco administrables', 'utf8'));
    zip.addFile('besoins.xlsx', xlsxBuffer);

    const { texte, resultats: details } = await extraireLot([
      { nom: 'note.txt', contenu: Buffer.from('Bonjour, voici notre besoin.', 'utf8') },
      { nom: 'dossier.zip', contenu: zip.toBuffer() },
    ]);

    const lus = details.filter((d) => d.texte !== null).length;
    const attendu =
      texte.includes('C9200L-48P-4G-E') &&
      texte.includes('Bonjour') &&
      texte.includes('switchs Cisco');

    if (!attendu) {
      noter('extraction', 'echec', `contenu extrait incomplet (${lus} fichier(s))`);
      return;
    }
    noter('extraction', 'ok', `TXT + XLSX + ZIP → ${lus} fichiers, ${texte.length} caractères`);
  } catch (e) {
    noter('extraction', 'echec', e instanceof Error ? e.message : String(e));
  }
}

async function main(): Promise<void> {
  chargerEnv();

  let actif: string;
  try {
    actif = descriptionIA();
  } catch (e) {
    actif = e instanceof Error ? e.message : String(e);
  }
  console.log(`Vérification des services\nFournisseur IA actif : ${actif}\n`);

  // --- Supabase ---
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  await tester('supabase', Boolean(url && cle), 'NEXT_PUBLIC_SUPABASE_URL…', async () => {
    const r = await fetch(`${url}/rest/v1/tenants?select=slug&limit=1`, {
      headers: { apikey: cle!, Authorization: `Bearer ${cle!}` },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const lignes = (await r.json()) as { slug: string }[];
    return `tenant « ${lignes[0]?.slug ?? '?'} » joignable`;
  });

  // --- Fournisseurs IA : vraie génération validée par zod ---
  // Chacun est testé séparément, quel que soit AI_PROVIDER : on veut savoir
  // lesquels répondent, pas seulement celui qui est actif aujourd'hui.
  const fournisseurs: { cle: string; f: FournisseurIA; variables: string }[] = [
    { cle: 'anthropic', f: fournisseurAnthropic, variables: 'ANTHROPIC_API_KEY' },
    { cle: 'openai', f: fournisseurOpenAI, variables: 'OPENAI_API_KEY' },
    { cle: 'groq', f: fournisseurGroq, variables: 'GROQ_API_KEY' },
    { cle: 'gemini', f: fournisseurGemini, variables: 'GEMINI_API_KEY' },
    {
      cle: 'compatible',
      f: fournisseurCompatible,
      variables: 'AI_API_URL + AI_API_KEY + AI_MODEL',
    },
  ];

  for (const { cle, f, variables } of fournisseurs) {
    // Seul le fournisseur actif est bloquant : les autres sont informatifs.
    const critique = actif.startsWith(`${cle} ·`);

    await tester(
      `ia · ${cle}${critique ? ' (actif)' : ''}`,
      f.estConfigure(),
      variables,
      async () => {
        const schema = z.object({ marque: z.string(), quantite: z.number() });
        try {
          const r = await genererJson(
            'Extrais la marque et la quantité de : « 3 switchs Cisco C9200L ». ' +
              'Réponds uniquement {"marque": string, "quantite": number}.',
            schema,
            { tentatives: 2, fournisseur: f },
          );
          return `${f.modeleUtilise()} → marque=${r.marque} quantite=${r.quantite}`;
        } catch (e) {
          if (e instanceof ErreurIA) throw new Error(e.message);
          throw e;
        }
      },
      { critique },
    );
  }

  if (fournisseurGroq.estConfigure()) {
    await tester('groq · modèles', true, 'GROQ_API_KEY', async () => {
      const modeles = await listerModelesGroq();
      const actif = fournisseurGroq.modeleUtilise();
      const dispo = modeles.some((m) => m.id === actif);
      return `${modeles.length} disponible(s) — GROQ_MODEL « ${actif} » ${dispo ? 'présent' : 'INTROUVABLE'}`;
    });
  }

  // --- Firecrawl ---
  await tester('firecrawl', firecrawlConfigure(), 'FIRECRAWL_API_KEY', async () => {
    const r = await rechercher('distributeur officiel Cisco Maroc contact commercial', {
      limite: 3,
    });
    return `${r.length} résultat(s), 1er : ${r[0]?.url ?? 'aucun'}`;
  });

  // --- Gamma : la clé n'est requise qu'à l'étape 10 ---
  await tester('gamma', gammaConfigure(), 'GAMMA_API_KEY', async () =>
    'clé présente (génération non déclenchée ici)',
  );

  // --- Envoi de courriels ---
  // Un compte est « configuré » dès qu'un transport répond : SMTP avec un mot
  // de passe d'application, ou l'API Gmail avec un refresh token.
  for (const compte of ['principal', 'fournisseur'] as const) {
    await tester(
      `envoi ${compte}`,
      envoiConfigure(compte),
      `SMTP_${compte.toUpperCase()}_* / IMAP_CLIENT_* / GMAIL_${compte.toUpperCase()}_*`,
      async () => verifierEnvoi(compte),
    );
  }

  // --- IMAP ---
  await tester('imap', imapConfigure(), 'IMAP_CLIENT_*', async () => {
    const n = await verifierAccesImap();
    return `boîte joignable, ${n} message(s)`;
  });

  // --- Extraction (aucune clé requise) ---
  await testerExtraction();

  const echecs = resultats.filter((r) => r.etat === 'echec');
  const ok = resultats.filter((r) => r.etat === 'ok').length;
  const ignores = resultats.filter((r) => r.etat === 'ignore').length;
  const avertissements = resultats.filter((r) => r.etat === 'avertissement');

  console.log(
    `\n${ok} opérationnel(s), ${ignores} non configuré(s), ` +
      `${avertissements.length} avertissement(s), ${echecs.length} en échec.`,
  );

  if (avertissements.length > 0) {
    console.log(
      `Avertissements (non bloquants) : ${avertissements.map((a) => a.service).join(', ')}`,
    );
  }

  if (echecs.length > 0) {
    console.error(`\nServices en échec : ${echecs.map((e) => e.service).join(', ')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('✗ Script interrompu :', e instanceof Error ? e.message : e);
  process.exit(1);
});
