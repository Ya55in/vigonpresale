/**
 * Éprouve TOUS les jobs du worker, dans l'ordre où le worker les planifie.
 *
 * POURQUOI CE HARNAIS EXISTE
 *
 * Les jobs n'étaient éprouvés que séparément, et jamais dans les conditions du
 * worker. Deux pannes réelles ont échappé à cette découpe :
 *
 *  - les clés saisies dans `/admin` ne sont chargées que par `chargerSecrets`,
 *    que le worker appelle à chaque cycle. Un script qui l'omet voit une
 *    configuration IA vide et conclut à tort ;
 *  - `llama-3.3-70b-versatile` a été retiré par Groq sans préavis. La
 *    configuration restait « valide » — clé présente, fournisseur reconnu — et
 *    tout appel répondait 404. Six demandes se sont bloquées avant qu'on le voie.
 *
 * D'où la première épreuve : un APPEL RÉEL au modèle. Une clé présente ne prouve
 * rien ; seule une réponse prouve quelque chose.
 *
 * ENVOIS RÉELS
 *
 * Trois jobs écrivent vers l'extérieur — `envoi-rfq` et `relances` vers les
 * fournisseurs, `relance-client` vers le client. Ils ne sont exécutés que
 * lorsqu'ils n'ont RIEN à envoyer : le code passe alors entièrement, sans
 * qu'aucun message ne parte. Dès qu'un envoi est dû, le harnais l'annonce et
 * s'arrête là, sauf ENVOIS_REELS=1 posé sciemment.
 *
 * C'est la règle du projet : aucun message d'essai vers une adresse externe.
 *
 * Usage :
 *   npm run essai:worker
 *   ENVOIS_REELS=1 npm run essai:worker    # exécute aussi les envois dus
 */
import { chargerEnv } from './charger-env.js';

let echecs = 0;
let avertissements = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

function alerter(intitule: string, detail = ''): void {
  console.log(` !    ${intitule}${detail ? ` — ${detail}` : ''}`);
  avertissements += 1;
}

function titre(texte: string): void {
  console.log(`\n\x1b[1m${texte}\x1b[0m`);
}

const ENVOIS_REELS = process.env.ENVOIS_REELS === '1';

async function main(): Promise<void> {
  chargerEnv();

  const services = await import('@vigon/services');
  const {
    chargerSecrets,
    clientAdmin,
    descriptionEnvoi,
    descriptionIA,
    envoiConfigure,
    genererTexte,
    imapConfigure,
    tenantId,
  } = services;

  const tenant = await tenantId();
  const db = clientAdmin();

  /* --- 1. Le préalable de chaque cycle ------------------------------------ */
  titre('1. Secrets — ce que le worker fait avant chaque job');

  // Exactement l'appel de `executer()` dans apps/worker/src/index.ts. Sans lui,
  // les clés saisies dans /admin restent invisibles et tout le reste ment.
  await chargerSecrets(tenant);
  verifier('chargerSecrets(tenant) passe', true, `tenant ${tenant}`);

  /* --- 2. La chaîne IA répond-elle vraiment ? ----------------------------- */
  titre('2. Chaîne IA — appel réel, pas une lecture de configuration');

  let iaVivante = false;
  try {
    const debut = Date.now();
    const reponse = await genererTexte(
      'Réponds exactement par le mot : VIGON. Rien d’autre.',
    );
    const duree = Date.now() - debut;

    iaVivante = reponse.toUpperCase().includes('VIGON');
    verifier(
      'le modèle répond et suit la consigne',
      iaVivante,
      `${duree} ms — « ${reponse.trim().slice(0, 60)} »`,
    );
    // Lu APRÈS l'appel : c'est lui qui résout la chaîne à partir des clés.
    console.log(`        chaîne : ${descriptionIA()}`);
  } catch (e) {
    verifier(
      'le modèle répond',
      false,
      e instanceof Error ? e.message.slice(0, 200) : String(e),
    );
  }

  /* --- 3. Le tri du courrier entrant -------------------------------------- */
  titre('3. Tri à la réception — courrier automatique écarté, humain conservé');

  const { estCourrierAutomatique } = services;

  // Gabarit neutre : chaque cas ne fait varier QUE l'en-tête examiné, sinon
  // l'essai ne dirait pas lequel a tranché.
  //
  // Annoté `MessageEntrant` : sans le type, `autoSoumis: null` s'infère en
  // `null` et les cas qui y posent une chaîne ne compilent plus.
  const messageType: import('@vigon/services').MessageEntrant = {
    uid: 1,
    messageId: '<x@vigon.test>',
    inReplyTo: null,
    references: [],
    expediteur: 'contact@client.test',
    expediteurBrut: 'Client <contact@client.test>',
    sujet: 'Consultation',
    corpsTexte: 'Bonjour, merci de nous chiffrer 12 commutateurs.',
    corpsHtml: null,
    date: new Date(),
    piecesJointes: [],
    typeContenu: 'text/plain',
    typeRapport: null,
    autoSoumis: null,
    preseance: null,
    listeDiffusion: false,
    reponsesAutoSupprimees: false,
  };

  const cas: { intitule: string; message: typeof messageType; attendu: boolean }[] = [
    {
      intitule: 'consultation écrite par un humain — CONSERVÉE',
      message: messageType,
      attendu: false,
    },
    {
      intitule: 'Auto-Submitted: auto-generated (notification Meta) — écartée',
      message: { ...messageType, autoSoumis: 'auto-generated' },
      attendu: true,
    },
    {
      intitule: 'List-Unsubscribe (infolettre) — écartée',
      message: { ...messageType, listeDiffusion: true },
      attendu: true,
    },
    {
      intitule: 'Precedence: bulk (envoi de masse) — écartée',
      message: { ...messageType, preseance: 'bulk' },
      attendu: true,
    },
    {
      // Le cas réel du 20/08 : « Confirm your business email » ne portait AUCUN
      // des trois premiers signaux, et créait une demande aussitôt bloquée.
      intitule: 'X-Auto-Response-Suppress (confirmation Facebook) — écartée',
      message: { ...messageType, reponsesAutoSupprimees: true },
      attendu: true,
    },
    {
      intitule: 'Auto-Submitted: no (client qui le pose explicitement) — CONSERVÉE',
      message: { ...messageType, autoSoumis: 'no' },
      attendu: false,
    },
    {
      intitule: 'adresse en noreply@ sans autre signal — CONSERVÉE',
      message: { ...messageType, expediteur: 'noreply@marches-publics.test' },
      attendu: false,
    },
  ];

  for (const c of cas) {
    const verdict = estCourrierAutomatique(c.message);
    verifier(
      c.intitule,
      verdict.automatique === c.attendu,
      verdict.motif || 'aucun signal',
    );
  }

  /* --- 4. Les transports -------------------------------------------------- */
  titre('4. Transports');

  const imapOk = imapConfigure();
  verifier('IMAP client configuré (job « reception »)', imapOk);

  const envoiFournisseur = envoiConfigure('fournisseur');
  verifier(
    'transport fournisseur (jobs « envoi-rfq » et « relances »)',
    envoiFournisseur,
    envoiFournisseur ? descriptionEnvoi('fournisseur') : 'aucun',
  );

  const envoiPrincipal = envoiConfigure('principal');
  verifier(
    'transport principal (job « relance-client »)',
    envoiPrincipal,
    envoiPrincipal ? descriptionEnvoi('principal') : 'aucun',
  );

  /* --- 5. Ce qui est dû, avant de lancer quoi que ce soit ------------------ */
  titre('5. En attente — ce que les jobs vont trouver');

  const maintenant = new Date().toISOString();

  async function compter(table: string, filtre: string): Promise<number> {
    const cle = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const r = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?${filtre}&select=id`,
      {
        headers: { apikey: cle, Authorization: `Bearer ${cle}`, Prefer: 'count=exact' },
        method: 'HEAD',
      },
    );
    return Number(r.headers.get('content-range')?.split('/')[1] ?? 0);
  }

  const rfqDues = await compter(
    'consultations',
    `tenant_id=eq.${tenant}&statut=eq.planifiee&date_envoi_prevue=lte.${maintenant}`,
  );
  const relancesDues = await compter(
    'consultations',
    `tenant_id=eq.${tenant}&statut=in.(envoyee,relancee,precision_demandee)&prochaine_relance=not.is.null&prochaine_relance=lte.${maintenant}`,
  );
  const offresRelancables = await compter(
    'offres',
    `tenant_id=eq.${tenant}&statut=in.(envoyee,consultee)&date_expiration=not.is.null&date_expiration=gt.${maintenant}`,
  );

  console.log(`        consultations à envoyer   : ${rfqDues}`);
  console.log(`        relances fournisseur dues : ${relancesDues}`);
  console.log(`        offres relançables client : ${offresRelancables}`);

  /* --- 5. Les jobs, dans l'ordre du worker -------------------------------- */
  titre('6. Exécution des jobs');

  type Job = {
    nom: string;
    executer: () => Promise<number>;
    /** Nombre d'envois externes que ce cycle produirait. */
    envois?: number;
    prealable?: boolean;
  };

  const { pollClientMailbox } = await import('../apps/worker/src/jobs/pollClientMailbox.js');
  const { reprendreExtractions } = await import(
    '../apps/worker/src/jobs/reprendreExtractions.js'
  );
  const { sendScheduledRfq } = await import('../apps/worker/src/jobs/sendScheduledRfq.js');
  const { processRelances } = await import('../apps/worker/src/jobs/processRelances.js');
  const { expireOffres } = await import('../apps/worker/src/jobs/expireOffres.js');
  const { rappelOffresNonConsultees } = await import(
    '../apps/worker/src/jobs/rappelOffresNonConsultees.js'
  );
  const { relanceClientExpiration } = await import(
    '../apps/worker/src/jobs/relanceClientExpiration.js'
  );

  const jobs: Job[] = [
    { nom: 'reception', executer: pollClientMailbox, prealable: imapOk },
    { nom: 'reprise', executer: reprendreExtractions, prealable: iaVivante },
    {
      nom: 'envoi-rfq',
      executer: sendScheduledRfq,
      envois: rfqDues,
      prealable: envoiFournisseur,
    },
    {
      nom: 'relances',
      executer: processRelances,
      envois: relancesDues,
      prealable: envoiFournisseur,
    },
    { nom: 'expiration', executer: expireOffres },
    { nom: 'rappel-offres', executer: rappelOffresNonConsultees },
    {
      nom: 'relance-client',
      executer: relanceClientExpiration,
      // Borne haute : le job filtre ensuite sur la fenêtre et l'audit. Un
      // candidat ne part pas forcément, mais un envoi ne peut pas sortir d'ici.
      envois: offresRelancables,
      prealable: envoiPrincipal,
    },
  ];

  for (const job of jobs) {
    if (job.prealable === false) {
      alerter(`${job.nom} : non exécuté`, 'préalable absent (transport ou IA)');
      continue;
    }

    if ((job.envois ?? 0) > 0 && !ENVOIS_REELS) {
      alerter(
        `${job.nom} : non exécuté`,
        `${job.envois} envoi(s) externe(s) dû(s) — relancer avec ENVOIS_REELS=1 pour les traiter`,
      );
      continue;
    }

    const debut = Date.now();
    try {
      const traites = await job.executer();
      verifier(`${job.nom}`, true, `${traites} traité(s) en ${Date.now() - debut} ms`);
    } catch (e) {
      verifier(
        `${job.nom}`,
        false,
        e instanceof Error ? e.message.slice(0, 250) : String(e),
      );
    }
  }

  /* --- 6. Ce que l'exécution laisse derrière elle -------------------------- */
  titre('7. État après passage');

  const { data: bloquees } = await db
    .from('demandes')
    .select('code, motif_blocage')
    .eq('tenant_id', tenant)
    .eq('statut', 'bloquee');

  if (!bloquees || bloquees.length === 0) {
    verifier('aucune demande bloquée', true);
  } else {
    alerter(
      `${bloquees.length} demande(s) bloquée(s)`,
      bloquees.map((d) => d.code).join(', '),
    );
    for (const d of bloquees) {
      console.log(`        ${d.code} : ${(d.motif_blocage ?? '').slice(0, 110)}`);
    }
  }

  const { data: enAttente } = await db
    .from('demandes')
    .select('code')
    .eq('tenant_id', tenant)
    .eq('statut', 'nouvelle')
    .not('contenu_consolide', 'is', null);

  if (enAttente && enAttente.length > 0) {
    // Normal juste après une relance : le job « reprise » attend AGE_MIN_MINUTES
    // avant de toucher une demande, pour ne pas doubler une extraction en cours.
    alerter(
      `${enAttente.length} demande(s) en attente d'extraction`,
      enAttente.map((d) => d.code).join(', '),
    );
  }

  /* --- Verdict ------------------------------------------------------------ */
  console.log(
    `\n${echecs === 0 ? '✓' : '✗'} ${echecs} échec(s), ${avertissements} avertissement(s).\n`,
  );
  if (!ENVOIS_REELS) {
    console.log('  Envois externes non exécutés (ENVOIS_REELS non posé).\n');
  }
  process.exit(echecs === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n✗ Harnais interrompu :', e);
  process.exit(1);
});
