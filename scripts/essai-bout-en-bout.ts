/**
 * Les parcours de bout en bout : connexion, offre publique, décision client,
 * rendu des écrans du tableau de bord.
 *
 * POURQUOI TOUT PASSE PAR HTTP
 *
 * Ces tests existent pour couvrir la migration Next 16. Or ce que cette
 * migration change vit précisément dans la couche que les autres harnais
 * sautent : `cookies()` et `headers()` deviennent asynchrones, `params` devient
 * une Promise, et les Server Actions changent d'encodage. Un test qui appelle
 * les fonctions métier directement ne verrait rien de tout cela — il passerait
 * au vert sur une application qui ne démarre plus.
 *
 * Les Server Actions sont donc invoquées comme le ferait un navigateur SANS
 * JavaScript : Next place dans chaque formulaire les champs cachés qui portent
 * l'identifiant de l'action, et un POST multipart les rejoue. C'est la
 * dégradation prévue par le framework, et elle traverse tout — middleware,
 * session, action, base.
 *
 * AUCUN COURRIEL N'EST ENVOYÉ. Vérifié : `approuverOffre` n'appelle aucun
 * transport. L'envoi de l'offre reste la seule étape non exercée, et c'est
 * délibéré — un faux message à un vrai client ne se rattrape pas.
 *
 * ÉCRIT EN BASE pour le troisième parcours, et nettoie dans un `finally`.
 *
 * Usage : BASE_URL=http://localhost:3000 npm run essai:bout-en-bout
 */
import { chargerEnv } from './charger-env.js';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

function signaler(intitule: string, detail = ''): void {
  console.log(`  ~~    ${intitule}${detail ? ` — ${detail}` : ''}`);
}

/* --- Accès base ---------------------------------------------------------- */

function entetes(): Record<string, string> {
  const s = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { apikey: s, Authorization: `Bearer ${s}`, 'Content-Type': 'application/json' };
}

async function rest<T>(chemin: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${chemin}`, {
    ...init,
    headers: { ...entetes(), Prefer: 'return=representation', ...(init?.headers ?? {}) },
  });
  const texte = await r.text();
  return (texte ? JSON.parse(texte) : null) as T;
}

/* --- Navigateur minimal -------------------------------------------------- */

/**
 * Bocal à cookies.
 *
 * `fetch` n'en garde aucun : sans ce bocal, la session obtenue à la connexion
 * ne serait jamais renvoyée, et tous les écrans protégés répondraient 307 — un
 * faux négatif qui ressemblerait à un défaut d'autorisation.
 */
class Bocal {
  private readonly cookies = new Map<string, string>();

  absorber(reponse: Response): void {
    for (const brut of reponse.headers.getSetCookie?.() ?? []) {
      const [paire] = brut.split(';');
      const separateur = paire?.indexOf('=') ?? -1;
      if (!paire || separateur < 1) continue;

      const nom = paire.slice(0, separateur);
      const valeur = paire.slice(separateur + 1);

      // Une valeur vide avec Max-Age=0 est une suppression : la garder ferait
      // croire à une session encore ouverte après déconnexion.
      if (!valeur || /max-age=0|expires=thu, 01 jan 1970/i.test(brut)) this.cookies.delete(nom);
      else this.cookies.set(nom, valeur);
    }
  }

  entete(): string {
    return [...this.cookies].map(([n, v]) => `${n}=${v}`).join('; ');
  }

  aSession(): boolean {
    return [...this.cookies.keys()].some((n) => /^sb-.*-auth-token(\.\d+)?$/.test(n));
  }

  vider(): void {
    this.cookies.clear();
  }
}

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

async function visiter(
  chemin: string,
  bocal?: Bocal,
  init?: RequestInit,
): Promise<Response> {
  const r = await fetch(`${BASE}${chemin}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: {
      ...(bocal?.entete() ? { cookie: bocal.entete() } : {}),
      ...(init?.headers ?? {}),
    },
  });
  bocal?.absorber(r);
  return r;
}

/**
 * Champs cachés d'UN formulaire, repéré par un marqueur qui lui est propre.
 *
 * Prendre les champs cachés de toute la page mêlerait ceux de plusieurs
 * actions : la page de connexion en porte deux, et le POST déclenchait la
 * connexion Google au lieu de celle par mot de passe.
 */
function champsDuFormulaire(html: string, marqueur: string): Record<string, string> {
  const formulaires = html
    .split(/<form\b/i)
    .slice(1)
    .map((f) => f.split(/<\/form>/i)[0] ?? '');

  const cible = formulaires.find((f) => f.includes(marqueur));
  if (!cible) throw new Error(`Aucun formulaire contenant « ${marqueur} »`);

  const champs: Record<string, string> = {};

  for (const balise of cible.match(/<input[^>]*type="hidden"[^>]*>/g) ?? []) {
    const nom = balise.match(/name="([^"]*)"/)?.[1];
    const valeur = (balise.match(/value="([^"]*)"/)?.[1] ?? '')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    if (nom) champs[nom] = valeur;
  }

  return champs;
}

/** Soumet un formulaire comme le ferait un navigateur sans JavaScript. */
async function soumettre(
  chemin: string,
  marqueur: string,
  saisie: Record<string, string>,
  bocal: Bocal,
): Promise<Response> {
  const html = await (await visiter(chemin, bocal)).text();
  const corps = new FormData();

  for (const [nom, valeur] of Object.entries(champsDuFormulaire(html, marqueur))) {
    corps.set(nom, valeur);
  }
  for (const [nom, valeur] of Object.entries(saisie)) corps.set(nom, valeur);

  return visiter(chemin, bocal, { method: 'POST', body: corps });
}

/* --- Parcours ------------------------------------------------------------ */

async function parcoursConnexion(motDePasse: string): Promise<Bocal> {
  console.log('\n=== 1. Connexion ===');

  const bocal = new Bocal();

  const anonyme = await visiter('/demandes', bocal);
  verifier('sans session, /demandes redirige', anonyme.status === 307, `obtenu ${anonyme.status}`);

  const login = await visiter('/login', bocal);
  verifier('/login est servie', login.status === 200, `obtenu ${login.status}`);

  // Mauvais mot de passe : la session ne doit pas s'ouvrir. C'est le contrôle
  // qui manquerait le plus si l'authentification se dérèglait à la migration.
  const refus = await soumettre(
    '/login',
    'name="motDePasse"',
    { email: 'presale@vigon.test', motDePasse: 'mauvais-mot-de-passe-évidemment' },
    bocal,
  );
  verifier(
    'mot de passe erroné : aucune session',
    !bocal.aSession(),
    `réponse ${refus.status}`,
  );

  bocal.vider();

  const succes = await soumettre(
    '/login',
    'name="motDePasse"',
    { email: 'presale@vigon.test', motDePasse },
    bocal,
  );

  verifier('connexion acceptée', succes.status === 303, `obtenu ${succes.status}`);
  verifier('cookie de session posé', bocal.aSession());

  const protege = await visiter('/demandes', bocal);
  verifier('avec session, /demandes est servie', protege.status === 200, `obtenu ${protege.status}`);

  // La session seule ne suffit pas : le rôle doit être opposable. PRESALE n'est
  // pas administrateur.
  const admin = await visiter('/admin', bocal);
  verifier(
    'PRESALE est refusé sur /admin',
    admin.status === 307 || admin.status === 403,
    `obtenu ${admin.status} → ${admin.headers.get('location') ?? '—'}`,
  );

  return bocal;
}

/**
 * Les écrans du tableau de bord rendent-ils, session en main ?
 *
 * POURQUOI CE PARCOURS EXISTE
 *
 * `typecheck` valide les types, pas le rendu. Le 2026-08-21, le tableau
 * comparatif a changé de forme de props — colonnes par devis au lieu de
 * fournisseurs — et rien dans la suite d'essais n'aurait vu une page qui plante
 * à l'affichage : les harnais appellent les fonctions de lecture, jamais React.
 *
 * Un 200 ne suffit pas : Next rend une page d'erreur AVEC un 200 quand un
 * composant client lève. Le corps est donc inspecté.
 */
async function parcoursEcrans(bocal: Bocal): Promise<void> {
  console.log('\n=== 4. Écrans du tableau de bord ===');

  const demandes = (await rest<{ id: number }[]>(
    'demandes?select=id&order=id.desc&limit=4',
  )) as unknown as { id: number }[];

  // L'écran de relecture d'offre est le plus fragile : il assemble le BoQ, les
  // visuels et les retouches. Il ne figurait pas ici, et c'est justement lui
  // qu'on a fait évoluer le 2026-08-21.
  const offres = (await rest<{ id: number }[]>(
    'offres?select=id&order=id.desc&limit=3',
  )) as unknown as { id: number }[];

  const chemins = [
    '/demandes',
    '/fournisseurs',
    '/notifications',
    ...(demandes ?? []).flatMap((d) => [
      `/demandes/${d.id}`,
      `/demandes/${d.id}/costing`,
      `/demandes/${d.id}/consultations`,
      `/demandes/${d.id}/documents`,
      `/demandes/${d.id}/historique`,
      `/demandes/${d.id}/offre`,
    ]),
    ...(offres ?? []).map((o) => `/offres/${o.id}/preview`),
  ];

  const plantees = await rendre(chemins, bocal);

  verifier(
    `${chemins.length} écran(s) rendus sans erreur`,
    plantees === 0,
    plantees > 0 ? `⚠ ${plantees} en défaut` : 'aucun plantage',
  );
}

/** Visite une liste d'écrans et rend le nombre de pages en défaut. */
async function rendre(chemins: string[], bocal: Bocal): Promise<number> {
  let plantees = 0;

  for (const chemin of chemins) {
    const r = await visiter(chemin, bocal);

    if (r.status !== 200) {
      // 307 sur un écran réservé à un autre rôle est légitime : PRESALE ne voit
      // pas tout. Seul un 5xx est un défaut.
      if (r.status >= 500) {
        plantees += 1;
        console.log(` ÉCHEC  ${chemin} — ${r.status}`);
      }
      continue;
    }

    const corps = await r.text();

    // Next sert sa page d'erreur en 200 : le statut seul ne prouve rien.
    if (/Application error|Unhandled Runtime Error|a client-side exception/i.test(corps)) {
      plantees += 1;
      console.log(` ÉCHEC  ${chemin} — page d’erreur rendue`);
    }
  }

  return plantees;
}

/**
 * Les écrans que PRESALE ne voit pas.
 *
 * Le parcours ci-dessus tourne en session PRESALE, et deux branches lui
 * échappent : `/admin`, que son rôle refuse, et la carte d'accord de l'écran de
 * costing, qui change de forme quand celui qui regarde EST l'approbateur —
 * l'administrateur décide sur place au lieu d'escalader. Sans cette session,
 * une erreur de rendu sur ces branches ne serait vue par personne.
 */
async function parcoursAdmin(motDePasse: string): Promise<void> {
  console.log('\n=== 4 bis. Écrans de l’administrateur ===');

  const bocal = new Bocal();

  const succes = await soumettre(
    '/login',
    'name="motDePasse"',
    { email: 'admin@vigon.test', motDePasse },
    bocal,
  );

  verifier(
    'connexion administrateur acceptée',
    succes.status === 303 && bocal.aSession(),
    `obtenu ${succes.status}`,
  );

  if (!bocal.aSession()) return;

  const demandes = (await rest<{ id: number }[]>(
    'demandes?select=id&order=id.desc&limit=4',
  )) as unknown as { id: number }[];

  const chemins = ['/admin', ...(demandes ?? []).map((d) => `/demandes/${d.id}/costing`)];

  const plantees = await rendre(chemins, bocal);

  verifier(
    `${chemins.length} écran(s) d’administration rendus sans erreur`,
    plantees === 0,
    plantees > 0 ? `⚠ ${plantees} en défaut` : 'aucun plantage',
  );
}

async function parcoursOffrePublique(): Promise<void> {
  console.log('\n=== 2. Offre publique ===');

  const publiques = await rest<{ token_public: string; numero: string; demande_id: number }[]>(
    'offres?select=token_public,numero,demande_id&statut=eq.consultee&token_public=not.is.null&limit=1',
  );

  const offre = publiques?.[0];

  if (!offre) {
    signaler('aucune offre au statut public', 'parcours non exercé');
    return;
  }

  const anonyme = new Bocal();
  const reponse = await visiter(`/offre/${offre.token_public}`, anonyme);
  verifier(`${offre.numero} s'ouvre sans session`, reponse.status === 200, `obtenu ${reponse.status}`);

  const html = await reponse.text();

  /* --- Contrôle de fuite : le cœur de ce parcours ------------------------ */

  const fournisseurs = await rest<{ nom: string }[]>('fournisseurs?select=nom');
  const cites = (fournisseurs ?? [])
    .map((f) => f.nom)
    .filter((nom) => nom && nom.length > 4 && html.includes(nom));

  verifier(
    'aucun nom de fournisseur dans la page',
    cites.length === 0,
    cites.join(', ') || 'aucun',
  );

  // Les prix d'achat sont la donnée la plus sensible du produit : le client qui
  // les verrait connaîtrait la marge à l'unité près.
  const achats = await rest<{ prix_achat_ht: number }[]>(
    `lignes_devis?select=prix_achat_ht&limit=200`,
  );

  const montantsVus = [...new Set((achats ?? []).map((l) => Number(l.prix_achat_ht)))]
    .filter((m) => m > 0)
    .filter((m) => {
      const texte = m.toLocaleString('fr-FR', { minimumFractionDigits: 2 });
      return html.includes(texte);
    });

  verifier(
    'aucun prix d’achat dans la page',
    montantsVus.length === 0,
    montantsVus.join(', ') || 'aucun',
  );

  for (const mot of ['marge', 'prix_achat', 'cost_sheet', 'costing']) {
    verifier(`le mot « ${mot} » n'apparaît pas`, !html.toLowerCase().includes(mot));
  }

  /* --- Jetons refusés ---------------------------------------------------- */

  const inconnu = await visiter('/offre/jeton-inconnu-mais-de-bonne-longueur', anonyme);
  verifier('jeton inconnu → 404', inconnu.status === 404, `obtenu ${inconnu.status}`);

  const court = await visiter('/offre/court', anonyme);
  verifier('jeton trop court → 404', court.status === 404, `obtenu ${court.status}`);

  // Une offre encore interne ne doit pas s'ouvrir, même avec son vrai jeton.
  const internes = await rest<{ token_public: string; numero: string }[]>(
    'offres?select=token_public,numero&statut=eq.generee&token_public=not.is.null&limit=1',
  );

  if (internes?.[0]) {
    const interne = await visiter(`/offre/${internes[0].token_public}`, anonyme);
    verifier(
      `offre « generee » (${internes[0].numero}) reste fermée`,
      interne.status === 404,
      `obtenu ${interne.status}`,
    );
  } else {
    signaler('aucune offre au statut interne', 'contrôle non exercé');
  }

  /* --- En-têtes : le jeton est dans l'URL -------------------------------- */

  const referrer = reponse.headers.get('referrer-policy');
  verifier(
    'Referrer-Policy protège le jeton',
    Boolean(referrer && /strict-origin|no-referrer/.test(referrer)),
    referrer ?? 'absent',
  );
}

async function parcoursDecisionClient(): Promise<void> {
  console.log('\n=== 3. Décision du client ===');

  const [demande] = await rest<{ id: number; tenant_id: string }[]>(
    'demandes?select=id,tenant_id&order=id.desc&limit=1',
  );

  if (!demande) {
    signaler('aucune demande en base', 'parcours non exercé');
    return;
  }

  // Jeton de même entropie que la production : 24 octets en base64url.
  const jeton = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');

  const [offre] = await rest<{ id: number }[]>('offres', {
    method: 'POST',
    body: JSON.stringify({
      tenant_id: demande.tenant_id,
      demande_id: demande.id,
      numero: `ESSAI-${Date.now()}`,
      statut: 'envoyee',
      token_public: jeton,
      titre: 'Offre d’essai bout en bout',
      source_json: {
        referenceOffre: 'ESSAI',
        date: new Date().toISOString().slice(0, 10),
        validite: '30 jours',
        solution: { titre: 'Essai', resume: 'Essai', tableauExplicatif: [] },
        produits: [
          {
            designation: 'Article d’essai',
            marque: 'Essai',
            quantite: 1,
            prixUnitaireHt: 100,
            totalHt: 100,
            pointsCles: [],
          },
        ],
        totaux: { totalHt: 100, tvaPct: 20, totalTva: 20, totalTtc: 120, devise: 'MAD' },
        conditions: { livraison: '—', paiement: '—', garantie: '—' },
      },
    }),
  });

  if (!offre) {
    verifier('création de l’offre d’essai', false, 'insertion refusée');
    return;
  }

  try {
    const client = new Bocal();

    /**
     * Le cycle de décision, tel que le client le voit.
     *
     * L'INVOCATION de l'action n'est PAS rejouée ici, et c'est un choix. Les
     * boutons appellent `approuverOffre` depuis un `onClick`, pas par un
     * formulaire : il n'y a donc aucune dégradation sans JavaScript, et la
     * seule voie HTTP passe par l'en-tête `Next-Action` et l'encodage interne
     * des arguments. Figer cet encodage dans un test le ferait échouer à la
     * migration Next 16 **pour une mauvaise raison** — un interne du framework
     * qui change, pas l'application qui casse.
     *
     * Ce qui est éprouvé ici est ce que l'application possède : à chaque état,
     * la page publique montre ce qu'elle doit et retire ce qu'elle doit.
     */
    // Les libellés attendus sont ceux que le client lit vraiment — « Oui, cette
    // offre me convient », pas « Approuver ». Écrire l'intention plutôt que le
    // texte ferait passer un test sur une page devenue muette.
    const etats: [string, Record<string, unknown>, RegExp, boolean][] = [
      ['décidable', { statut: 'envoyee' }, /cette offre me convient/i, true],
      [
        'approuvée',
        { statut: 'approuvee', date_approbation: new Date().toISOString() },
        /Offre approuvée/,
        false,
      ],
      [
        'déclinée',
        { statut: 'refusee', motif_refus: 'Budget insuffisant cette année' },
        /Offre déclinée/,
        false,
      ],
      [
        'expirée',
        { statut: 'envoyee', date_expiration: '2020-01-01', motif_refus: null },
        /Offre expirée/,
        false,
      ],
    ];

    for (const [intitule, colonnes, attendu, decidable] of etats) {
      await rest(`offres?id=eq.${offre.id}`, {
        method: 'PATCH',
        body: JSON.stringify(colonnes),
      });

      const page = await visiter(`/offre/${jeton}`, client);
      const html = await page.text();

      verifier(`état « ${intitule} » : la page s'ouvre`, page.status === 200, `obtenu ${page.status}`);
      verifier(`état « ${intitule} » : le bon message`, attendu.test(html));

      // Le point qui compte vraiment : une offre déjà décidée ou périmée ne
      // doit plus offrir de bouton. Sans cela, un lien transféré permettrait de
      // renverser une décision prise.
      const offreDecision = /cette offre me convient|ai une réserve/i.test(html);
      verifier(
        `état « ${intitule} » : ${decidable ? 'décision possible' : 'plus aucune décision'}`,
        offreDecision === decidable,
      );

      if (intitule === 'déclinée') {
        verifier('le motif du refus est rendu au client', /Budget insuffisant/.test(html));
      }
    }

    // Le motif d'un refus vient de la base : s'il n'était pas échappé, il
    // deviendrait une injection sur la seule page que des tiers consultent.
    await rest(`offres?id=eq.${offre.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        statut: 'refusee',
        date_expiration: null,
        motif_refus: '<img src=x onerror="alert(1)">',
      }),
    });

    const injection = await (await visiter(`/offre/${jeton}`, client)).text();
    verifier(
      'un motif malveillant est neutralisé',
      !injection.includes('<img src=x onerror'),
      'balise rendue telle quelle',
    );
  } finally {
    console.log('\n=== Nettoyage ===');

    await rest(`audit_events?entite=eq.offres&entite_id=eq.${offre.id}`, { method: 'DELETE' });
    await rest(`notifications?demande_id=eq.${demande.id}&type=eq.offre_approuvee`, {
      method: 'DELETE',
    });
    await rest(`communications?offre_id=eq.${offre.id}`, { method: 'DELETE' });
    await rest(`offre_consultations?offre_id=eq.${offre.id}`, { method: 'DELETE' });
    await rest(`offres?id=eq.${offre.id}`, { method: 'DELETE' });

    const restant = await rest<{ id: number }[]>(`offres?select=id&id=eq.${offre.id}`);
    verifier('offre d’essai supprimée', (restant ?? []).length === 0);
  }
}

/**
 * Contrôle statique : personne ne court-circuite le point d'envoi unifié.
 *
 * `envoyer()` retient le transport disponible — Gmail si un refresh token
 * existe, SMTP sinon. Un appelant qui invoque `gmailConfigure` ou
 * `envoyerEmail` directement se prive du repli : c'est ce qui bloquait l'envoi
 * de l'offre au client alors que le SMTP configuré fonctionnait, et servait
 * déjà pour les RFQ et les relances.
 *
 * Le défaut ne se voyait qu'à l'usage, sur un message d'erreur qui accusait à
 * tort une configuration manquante. Un contrôle statique le rattrape avant.
 */
async function coherenceEnvoi(): Promise<void> {
  console.log('\n=== 5. Cohérence du transport de courriel ===');

  const { execSync } = await import('node:child_process');

  const sortie = execSync(
    "grep -rn 'gmailConfigure\\|envoyerEmail\\b' --include='*.ts' --include='*.tsx' apps/ " +
      '|| true',
    { encoding: 'utf8' },
  );

  const fautifs = sortie
    .split('\n')
    .filter((l) => l.trim())
    // Les scripts d'essai ont le droit d'interroger un transport nommément :
    // c'est précisément ce qu'ils diagnostiquent.
    .filter((l) => !l.includes('/scripts/'))
    // Et les commentaires ont le droit de NOMMER le piège. Sans ce filtre, le
    // commentaire qui explique pourquoi on n'appelle plus `gmailConfigure`
    // déclenchait le contrôle censé le prévenir — vérifié, c'est arrivé.
    .filter((ligne) => {
      const code = ligne.slice(ligne.indexOf(':', ligne.indexOf(':') + 1) + 1).trim();
      return !code.startsWith('*') && !code.startsWith('//') && !code.startsWith('/*');
    });

  verifier(
    'aucun appel direct à Gmail hors des scripts',
    fautifs.length === 0,
    fautifs.map((l) => l.split(':').slice(0, 2).join(':')).join(', ') || 'aucun',
  );

  const { envoiConfigure, descriptionEnvoi } = await import('@vigon/services');

  verifier(
    'le compte principal a un transport',
    envoiConfigure('principal'),
    descriptionEnvoi('principal'),
  );
}

/* --- Programme ----------------------------------------------------------- */

async function main(): Promise<void> {
  chargerEnv();

  const motDePasse = process.env.SEED_PASSWORD;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('\n✗ Variables Supabase absentes.\n');
    process.exit(1);
  }

  if (!motDePasse) {
    console.error(
      '\n✗ SEED_PASSWORD absente. Le parcours de connexion exerce une vraie ' +
        'authentification et a besoin du mot de passe des comptes de test :\n\n' +
        "    SEED_PASSWORD='…' npm run essai:bout-en-bout\n",
    );
    process.exit(1);
  }

  try {
    await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(15_000) });
  } catch {
    console.error(`\n✗ ${BASE} injoignable. Le serveur de développement tourne-t-il ?\n`);
    process.exit(1);
  }

  console.log(`\nCible : ${BASE}`);

  const bocal = await parcoursConnexion(motDePasse);
  await parcoursOffrePublique();
  await parcoursDecisionClient();
  await parcoursEcrans(bocal);
  await parcoursAdmin(motDePasse);
  await coherenceEnvoi();

  console.log(
    `\n${echecs === 0 ? '✓ Tous les parcours passent.' : `✗ ${echecs} ÉCHEC(S).`}\n`,
  );

  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
