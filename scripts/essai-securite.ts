/**
 * Rejoue les contrôles de sécurité de l'audit.
 *
 * L'audit du 2026-08-11 reposait sur des vérifications menées à la main : RLS
 * éprouvé avec la clé publique, tentatives d'intrusion sur les pages à jeton,
 * contrôle de fuite entre fournisseurs. Le rapport en gardait les RÉSULTATS,
 * pas le moyen de les refaire — « c'était vérifié » plutôt que « ça se
 * vérifie ».
 *
 * Ce script comble l'écart. Il ne remplace pas le rapport, qui porte le
 * raisonnement et les décisions ; il rend ses affirmations contrôlables.
 *
 * Étendu le 2026-08-17 : la première version portait une liste de douze tables
 * écrite à la main et sortait verte pendant que trois VUES rendaient tout à la
 * clé publique. Les relations sont désormais lues dans le schéma, et le
 * balayage couvre aussi les fonctions RPC, les buckets de stockage et
 * l'autorisation de chaque Server Action.
 *
 * LECTURE SEULE, sauf une sonde d'écriture volontairement invalide sur
 * `fournisseur_embeddings` — c'est le seul moyen de distinguer un refus par
 * politique RLS d'une simple absence de droit.
 *
 * Usage : npm run essai:securite
 *         BASE_URL=http://localhost:3000 npm run essai:securite   (routes incluses)
 */
import { readFileSync } from 'node:fs';

import { chargerEnv } from './charger-env.js';

let echecs = 0;
let avertissements = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

function signaler(intitule: string, detail = ''): void {
  console.log(`  ~~    ${intitule}${detail ? ` — ${detail}` : ''}`);
  avertissements += 1;
}

/**
 * Relations à contrôler, LUES DANS LE SCHÉMA plutôt qu'énumérées ici.
 *
 * La première version portait une liste de douze tables écrite à la main. Elle
 * était verte pendant que trois vues rendaient tout à la clé publique : une
 * liste manuelle ne couvre que ce à quoi on a pensé le jour où on l'a écrite,
 * et le schéma, lui, continue de grandir.
 *
 * `database.types.ts` est régénéré depuis la base par `npm run gen:types`.
 * L'y lire fait entrer toute table et toute vue nouvelle dans le contrôle sans
 * que personne ait à y penser — c'est le seul moyen que l'oubli ne se
 * reproduise pas.
 */
function relationsDuSchema(): { tables: string[]; vues: string[] } {
  const src = readFileSync('packages/database/src/database.types.ts', 'utf8');

  const bloc = (debut: string, fin: string): string[] => {
    const i = src.indexOf(`    ${debut}: {`);
    const j = src.indexOf(`    ${fin}: {`, i);
    if (i === -1 || j === -1) return [];
    // Six espaces d'indentation = un nom de relation ; au-delà, ce sont ses
    // colonnes.
    return [...src.slice(i, j).matchAll(/^ {6}([a-z_][a-z0-9_]*): \{$/gm)].map((m) => m[1]!);
  };

  return { tables: bloc('Tables', 'Views'), vues: bloc('Views', 'Functions') };
}

async function main(): Promise<void> {
  chargerEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anon || !service) {
    console.error('\n✗ Variables Supabase absentes.\n');
    process.exit(1);
  }

  const enteteAnon = { apikey: anon, Authorization: `Bearer ${anon}` };

  /** Interroge une relation avec la clé publique et dit si elle a rendu des lignes. */
  async function sonderLecture(nom: string): Promise<void> {
    const r = await fetch(`${url}/rest/v1/${nom}?select=*&limit=3`, { headers: enteteAnon });

    if (!r.ok) {
      // Un refus franc convient aussi : l'important est qu'aucune ligne ne sorte.
      verifier(`${nom} — accès refusé (${r.status})`, true);
      return;
    }

    const lignes = (await r.json()) as unknown;
    const n = Array.isArray(lignes) ? lignes.length : 0;

    verifier(`${nom} — 0 ligne lisible`, n === 0, n > 0 ? `⚠ ${n} LIGNE(S) EXPOSÉE(S)` : '');
  }

  const { tables, vues } = relationsDuSchema();

  /* --- 1. Cloisonnement RLS ---------------------------------------------- */

  console.log(`\n=== RLS : la clé publique ne doit rien lire (${tables.length} tables) ===`);

  for (const table of tables) await sonderLecture(table);

  /* --- 1 bis. Les vues, qui ne portent pas le RLS de leurs tables ---------- */

  console.log(`\n=== Vues (${vues.length}) — s'exécutent avec les droits de leur PROPRIÉTAIRE ===`);

  // C'est par là qu'est passée la fuite du 2026-08-17 : une vue créée par le
  // propriétaire du schéma traverse le RLS des tables qu'elle lit. Le verrou
  // posé sur `demandes` n'était jamais consulté par ce chemin.
  for (const vue of vues) await sonderLecture(vue);

  /* --- 2. RLS actif, et non simple absence de droit ----------------------- */

  console.log('\n=== RLS déclaré, pas seulement un défaut de plateforme ===');

  // Écriture volontairement invalide : le code d'erreur distingue un refus par
  // politique (42501) d'une contrainte violée (23503), donc d'une écriture qui
  // serait passée.
  const sonde = await fetch(`${url}/rest/v1/fournisseur_embeddings`, {
    method: 'POST',
    headers: { ...enteteAnon, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenant_id: '00000000-0000-0000-0000-000000000000',
      ligne_devis_id: 999_999_999,
      fournisseur_nom: 'sonde-securite',
      texte: 'sonde-securite',
      embedding: JSON.stringify(Array(1536).fill(0)),
    }),
  });

  const erreurSonde = (await sonde.json().catch(() => ({}))) as { code?: string };

  verifier(
    'écriture anonyme refusée par politique RLS',
    erreurSonde.code === '42501',
    `code ${erreurSonde.code ?? '—'}`,
  );

  /* --- 2 bis. Fonctions appelables par la clé publique --------------------- */

  console.log('\n=== Fonctions RPC ===');

  // `chercher_fournisseurs_similaires` est déclarée SECURITY INVOKER : appelée
  // par la clé anonyme, le RLS des tables lues s'applique et elle ne doit rien
  // rendre. Un vecteur quasi nul corrèle avec tout — si quelque chose peut
  // sortir, il le fera sortir.
  const rpc = await fetch(`${url}/rest/v1/rpc/chercher_fournisseurs_similaires`, {
    method: 'POST',
    headers: { ...enteteAnon, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requete: JSON.stringify(Array(1536).fill(0.001)),
      seuil: 0,
      limite: 5,
      tenant: '00000000-0000-0000-0000-000000000000',
    }),
  });

  const resultatRpc = (await rpc.json().catch(() => null)) as unknown;

  verifier(
    'chercher_fournisseurs_similaires — rien pour la clé publique',
    !Array.isArray(resultatRpc) || resultatRpc.length === 0,
    Array.isArray(resultatRpc) && resultatRpc.length > 0
      ? `⚠ ${resultatRpc.length} FOURNISSEUR(S) EXPOSÉ(S)`
      : '',
  );

  /* --- 2 ter. Stockage ---------------------------------------------------- */

  console.log('\n=== Stockage ===');

  const enteteService = { apikey: service, Authorization: `Bearer ${service}` };

  const buckets = (await (
    await fetch(`${url}/storage/v1/bucket`, { headers: enteteService })
  ).json()) as { name: string; public: boolean }[];

  for (const b of buckets) {
    verifier(`bucket ${b.name} — privé`, b.public === false, b.public ? '⚠ PUBLIC' : '');

    // Un bucket privé dont le listage reste ouvert livrerait les noms de
    // fichiers : intitulés de projets et raisons sociales des clients.
    const listage = await fetch(`${url}/storage/v1/object/list/${b.name}`, {
      method: 'POST',
      headers: { ...enteteAnon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 3 }),
    });

    const objets = (await listage.json().catch(() => null)) as unknown;
    const n = Array.isArray(objets) ? objets.length : 0;

    verifier(`bucket ${b.name} — listage anonyme vide`, n === 0, n > 0 ? `⚠ ${n} objet(s)` : '');
  }

  /* --- 2 quater. Autorisation des Server Actions --------------------------- */

  console.log('\n=== Server Actions ===');

  // Contrôle statique : une action du tableau de bord ajoutée sans garde-fou
  // s'exécuterait pour tout porteur de session, quel que soit son rôle. Rien
  // dans le typage ne l'empêche, et l'oubli ne se voit qu'à l'usage.
  const { execSync: exec } = await import('node:child_process');

  const fichiersActions = exec(`grep -rl "^'use server'" --include='*.ts' apps/web`, {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');

  const sansGarde: string[] = [];

  for (const f of fichiersActions) {
    // Les pages à jeton et les écrans de connexion sont publics par
    // conception : leur autorisation est le jeton, contrôlé plus bas.
    if (!f.includes('(dashboard)')) continue;

    const src = readFileSync(f, 'utf8');

    for (const bloc of src.split('export async function ').slice(1)) {
      const nom = bloc.slice(0, bloc.indexOf('('));
      const corps = bloc.split('\nexport ')[0] ?? '';
      if (!/require(User|Role|Permission|PermissionApi)\s*\(/.test(corps)) {
        sansGarde.push(`${nom} (${f})`);
      }
    }
  }

  verifier(
    `${fichiersActions.length} fichiers d'actions — toutes celles du tableau de bord ont un garde-fou`,
    sansGarde.length === 0,
    sansGarde.join(', '),
  );

  /* --- 3. Secrets versionnés --------------------------------------------- */

  console.log('\n=== Secrets ===');

  const exemple = readFileSync('.env.example', 'utf8');

  // Une clé au format reconnaissable dans un fichier suivi par git = fuite.
  const motifs = /(eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})/;

  verifier('.env.example ne contient aucune clé réelle', !motifs.test(exemple));

  const lignesAvecValeur = exemple
    .split('\n')
    .filter((l) => /^[A-Z0-9_]+=.+/.test(l))
    .map((l) => l.split('=')[0] ?? '');

  const suspectes = lignesAvecValeur.filter((c) => /KEY|SECRET|PASSWORD|TOKEN/.test(c));

  verifier(
    'aucune variable sensible renseignée dans .env.example',
    suspectes.length === 0,
    suspectes.join(', '),
  );

  // Le fichier ignoré aujourd'hui peut avoir été committé hier : git garde tout.
  // On interroge donc l'index ET l'historique, pas seulement `.gitignore`.
  const { execSync: git } = await import('node:child_process');

  const suivis = git('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.example'));

  verifier('aucun fichier .env suivi par git', suivis.length === 0, suivis.join(', '));

  const historique = git("git log --all --oneline -- '*.env' '*.env.local' | head -5", {
    encoding: 'utf8',
  }).trim();

  verifier('aucun .env dans l’historique git', historique === '', historique.split('\n')[0] ?? '');

  /* --- 4. Entropie des jetons publics ------------------------------------ */

  console.log('\n=== Jetons des pages publiques ===');

  for (const [table, colonne] of [
    ['offres', 'token_public'],
    ['consultations', 'token_public'],
    ['validations_offre', 'token_public'],
  ] as const) {
    const r = await fetch(
      `${url}/rest/v1/${table}?select=${colonne}&${colonne}=not.is.null&limit=20`,
      { headers: enteteService },
    );

    const lignes = (await r.json()) as { [k: string]: string | null }[];
    const jetons = lignes.map((l) => l[colonne]).filter((t): t is string => Boolean(t));

    if (jetons.length === 0) {
      signaler(`${table} — aucun jeton en base, entropie non éprouvée`);
      continue;
    }

    // 24 octets en base64url donnent 32 caractères : en deçà, l'énumération
    // redevient envisageable.
    const tropCourts = jetons.filter((t) => t.length < 32);
    verifier(
      `${table} — ${jetons.length} jeton(s) de longueur suffisante`,
      tropCourts.length === 0,
      tropCourts.length > 0 ? `${tropCourts.length} trop court(s)` : '32+ caractères',
    );

    verifier(`${table} — aucun jeton en doublon`, new Set(jetons).size === jetons.length);
  }

  /* --- 5. Vulnérabilités des dépendances --------------------------------- */

  console.log('\n=== Dépendances ===');

  const { execSync } = await import('node:child_process');

  let audit: { metadata?: { vulnerabilities?: Record<string, number> } } = {};
  try {
    // `npm audit` sort en code 1 dès qu'une vulnérabilité existe : on capture
    // sa sortie plutôt que de traiter ce code comme un échec de script.
    audit = JSON.parse(
      execSync('npm audit --json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
    );
  } catch (e) {
    const sortie = (e as { stdout?: string }).stdout;
    if (sortie) audit = JSON.parse(sortie);
  }

  const v = audit.metadata?.vulnerabilities ?? {};
  const total = (v.critical ?? 0) + (v.high ?? 0) + (v.moderate ?? 0) + (v.low ?? 0);

  console.log(
    `  ~~    ${total} vulnérabilité(s) : ${v.critical ?? 0} critique(s), ${v.high ?? 0} haute(s), ${v.moderate ?? 0} modérée(s)`,
  );

  // Volontairement un avertissement et non un échec : la décision de reporter
  // ces correctifs est prise et documentée. Un échec ici pousserait la
  // prochaine session à « réparer » ce qui est délibéré.
  console.log('        Aucune n’est corrigeable : chaîne mailparser sans correctif publié');
  console.log('        en amont et non atteignable, plus l’outillage de lint.');
  console.log('        Détail : docs/RAPPORT-SECURITE.md.');
  avertissements += 1;

  /* --- 6. Routes publiques ----------------------------------------------- */

  const base = process.env.BASE_URL;

  if (!base) {
    console.log('\n=== Routes (ignorées) ===');
    signaler('BASE_URL absente', 'relancer avec BASE_URL=http://localhost:3000');
  } else {
    console.log('\n=== Routes publiques et protégées ===');

    const attendus: [string, number, string][] = [
      ['/login', 200, 'publique'],
      ['/devis/jeton-inconnu-mais-assez-long-abc', 404, 'jeton inconnu refusé'],
      ['/offre/jeton-inconnu-mais-assez-long-abc', 404, 'jeton inconnu refusé'],
      ['/validation/jeton-inconnu-mais-assez-long', 404, 'jeton inconnu refusé'],
      ['/devis/court', 404, 'jeton trop court refusé'],
      ['/demandes', 307, 'protégée, redirige'],
      ['/admin', 307, 'protégée, redirige'],
      ['/apres-vente', 307, 'protégée, redirige'],
    ];

    for (const [chemin, attendu, role] of attendus) {
      try {
        const r = await fetch(`${base}${chemin}`, {
          redirect: 'manual',
          signal: AbortSignal.timeout(20_000),
        });
        verifier(`${chemin} → ${attendu} (${role})`, r.status === attendu, `obtenu ${r.status}`);
      } catch {
        signaler(`${chemin} injoignable`, 'le serveur tourne-t-il ?');
      }
    }

    /* --- En-têtes de sécurité -------------------------------------------- */

    console.log('\n=== En-têtes de sécurité ===');

    // Contrôlés sur la page d'offre : c'est celle qui porte son autorisation
    // DANS L'URL, et donc celle où l'absence de Referrer-Policy fait fuiter le
    // jeton chez le tiers qui sert les visuels.
    const ATTENDUS: [string, RegExp][] = [
      ['referrer-policy', /^strict-origin(-when-cross-origin)?$|^no-referrer/],
      ['strict-transport-security', /max-age=\d{7,}/],
      ['x-content-type-options', /nosniff/],
      ['x-frame-options', /DENY|SAMEORIGIN/i],
      ['permissions-policy', /camera=/],
    ];

    try {
      const r = await fetch(`${base}/offre/jeton-inconnu-mais-assez-long`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      });

      for (const [entete, motif] of ATTENDUS) {
        const valeur = r.headers.get(entete);
        verifier(
          `${entete}`,
          Boolean(valeur && motif.test(valeur)),
          valeur ?? 'absent',
        );
      }

      // Signalée, jamais en échec : une CSP posée sans être éprouvée écran par
      // écran casse l'application en silence, et un échec ici pousserait à en
      // écrire une à la hâte pour faire taire le script.
      if (!r.headers.get('content-security-policy')) {
        signaler('content-security-policy absente', 'nonces à mettre en place, puis vérification écran par écran');
      }
    } catch {
      signaler('en-têtes non contrôlés', 'page d’offre injoignable');
    }
  }

  /* --- Bilan -------------------------------------------------------------- */

  console.log(
    `\n${echecs === 0 ? '✓ Aucune régression de sécurité.' : `✗ ${echecs} ÉCHEC(S) — à traiter avant tout commit.`}` +
      (avertissements > 0 ? `  (${avertissements} point(s) signalé(s))` : '') +
      '\n',
  );

  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
