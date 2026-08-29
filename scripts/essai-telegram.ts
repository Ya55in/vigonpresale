/**
 * Éprouve le canal Telegram du circuit de validation.
 *
 * MÊMES DEUX PROMESSES QUE `essai:whatsapp`, et pour la même raison : un canal
 * ajouté ne doit rien casser tant qu'il n'est pas configuré, et doit s'activer
 * sans redéploiement le jour où la clé est saisie.
 *
 *  1. Sans jeton, RIEN ne change : aucun appel réseau, la validation part par
 *     WhatsApp ou courriel comme avant.
 *  2. Un jeton saisi dans /admin suffit à activer le canal.
 *
 * ÉCRIT EN BASE puis restitue l'état trouvé, via `preserver-parametres` — la
 * leçon du 2026-08-20, où le harnais WhatsApp avait effacé de vraies clés en
 * confondant « nettoyer » et « supprimer ».
 *
 * N'ENVOIE AUCUN MESSAGE : le jeton d'essai est volontairement invalide, et le
 * seul appel réseau possible serait refusé par Telegram. Pour un envoi réel,
 * voir `essai:telegram-reel`.
 *
 * Usage : npm run essai:telegram
 */
import { chargerEnv } from './charger-env.js';
import { etatRestitue, preserverParametres } from './preserver-parametres.js';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

async function main(): Promise<void> {
  chargerEnv();

  const {
    telegramConfigure,
    descriptionTelegram,
    envoyerTelegram,
    ErreurTelegram,
    estCleGeree,
    CLES_GEREES,
  } = await import('@vigon/services');

  /* --- 1. La clé est gérable depuis /admin -------------------------------- */

  console.log('\n=== Clé dans l’écran d’administration ===');

  verifier('TELEGRAM_BOT_TOKEN est gérable depuis /admin', estCleGeree('TELEGRAM_BOT_TOKEN'));

  const declarees = CLES_GEREES.filter((c) => c.service === 'telegram');
  verifier('une seule clé porte le service « telegram »', declarees.length === 1);

  // Le jeton donne le contrôle total du bot : il doit être masqué à l'écran,
  // contrairement à l'identifiant de numéro WhatsApp qui n'ouvre rien seul.
  const jeton = declarees[0];
  verifier(
    'le jeton du bot est traité comme un secret',
    jeton !== undefined && !('sensible' in jeton && jeton.sensible === false),
  );

  /* --- 2. Sans clé, rien ne bouge ----------------------------------------- */

  console.log('\n=== Sans jeton : les autres canaux restent le transport ===');

  const jetonOrigine = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;

  verifier('le canal se déclare non configuré', !telegramConfigure());
  verifier(
    'la description le dit',
    descriptionTelegram() === 'non configuré',
    descriptionTelegram(),
  );

  // Le point qui compte : un appel par mégarde lève une erreur PARLANTE et ne
  // touche aucun réseau.
  const debut = Date.now();
  let erreur: unknown = null;
  try {
    await envoyerTelegram({ chatId: '123456789', texte: 'essai' });
  } catch (e) {
    erreur = e;
  }
  const duree = Date.now() - debut;

  verifier('un envoi sans jeton lève ErreurTelegram', erreur instanceof ErreurTelegram);
  verifier('sans appel réseau', duree < 200, `${duree} ms`);
  verifier(
    'le message dit où saisir la clé',
    erreur instanceof Error && erreur.message.includes('/admin'),
    erreur instanceof Error ? erreur.message.slice(0, 70) : '—',
  );

  /* --- 3. Une clé saisie suffit à activer --------------------------------- */

  console.log('\n=== Avec un jeton : le canal s’active ===');

  process.env.TELEGRAM_BOT_TOKEN = '000000:jeton-d-essai-non-valide';

  verifier('le canal se déclare configuré', telegramConfigure());
  verifier(
    'la description ne révèle pas le jeton',
    !descriptionTelegram().includes('jeton-d-essai'),
    descriptionTelegram(),
  );

  // Un identifiant de chat vide est refusé AVANT tout appel : Telegram
  // répondrait « chat not found », un aller-retour pour rien.
  {
    let motif = '';
    try {
      await envoyerTelegram({ chatId: '   ', texte: 'x' });
    } catch (e) {
      motif = e instanceof ErreurTelegram ? e.message : String(e);
    }
    verifier(
      'un identifiant de chat vide est refusé avant tout appel',
      motif.includes('Identifiant de chat'),
      motif || '⚠ AUCUN REFUS',
    );
  }

  /* --- 3 bis. Le lien cliquable ------------------------------------------- */

  console.log('\n=== Lien cliquable ===');

  {
    // Le message est construit sans réseau : on inspecte la charge qui PARTIRAIT.
    // Telegram n'autolie pas une adresse en texte brut — l'ancre est la seule
    // façon de rendre le lien tapable, et un bouton est refusé sur localhost
    // (mesuré le 2026-08-21 : « inline keyboard button URL is invalid »).
    const charges: Record<string, unknown>[] = [];
    const fetchOrigine = globalThis.fetch;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      charges.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      process.env.TELEGRAM_BOT_TOKEN = '000000:jeton-d-essai-non-valide';

      // Sans lien : le message doit rester EXACTEMENT celui d'avant.
      await envoyerTelegram({ chatId: '1', texte: 'Bonjour & <bienvenue>' });
      const nu = charges[0]!;
      verifier('sans lien, aucun mode d’analyse n’est posé', nu.parse_mode === undefined);
      verifier('sans lien, le texte part tel quel', nu.text === 'Bonjour & <bienvenue>');

      /*
       * SUR LOCALHOST, L'ADRESSE RESTE EN CLAIR.
       *
       * Le client Telegram supprime une ancre vers un hôte qu'il ne peut pas
       * ouvrir. La première version remplaçait pourtant l'adresse par cette
       * ancre : le message perdait le lien ET l'adresse. Ce contrôle interdit
       * la rechute — c'est la copie manuelle qui sauve le développement.
       */
      const LIEN_LOCAL = 'http://localhost:3000/validation/abc';
      await envoyerTelegram({
        chatId: '1',
        texte: `Décider :\n${LIEN_LOCAL}`,
        lien: LIEN_LOCAL,
      });
      const local = charges[1]!;

      verifier('sur localhost, aucun mode HTML', local.parse_mode === undefined);
      verifier('sur localhost, aucun bouton', local.reply_markup === undefined);
      verifier(
        'sur localhost, l’adresse reste lisible et copiable',
        String(local.text).includes(LIEN_LOCAL),
      );

      // Sur un hôte joignable, les deux enrichissements tiennent.
      const LIEN_PUBLIC = 'https://presale.vigon.ma/validation/abc';
      await envoyerTelegram({
        chatId: '1',
        texte: `Client : Dupont & Fils <SARL>\nDécider :\n${LIEN_PUBLIC}`,
        lien: LIEN_PUBLIC,
      });
      const publique = charges[2]!;
      const textePublic = String(publique.text);

      verifier('sur un hôte public, le mode HTML est posé', publique.parse_mode === 'HTML');
      verifier('le lien devient une ancre', textePublic.includes(`<a href="${LIEN_PUBLIC}">`));
      verifier('un bouton est joint', publique.reply_markup !== undefined);
      verifier(
        'le bouton porte bien l’adresse',
        JSON.stringify(publique.reply_markup ?? {}).includes(LIEN_PUBLIC),
      );

      // Le point de sécurité : le contenu venu de la base est échappé, sinon
      // un nom de client contenant « < » casserait le message ou pire.
      verifier(
        'le texte venu de la base est échappé',
        textePublic.includes('&amp;') && textePublic.includes('&lt;SARL&gt;'),
      );
      verifier(
        'aucune balise non voulue ne subsiste',
        (textePublic.match(/<(?!\/?a[ >])/g) ?? []).length === 0,
      );
    } finally {
      globalThis.fetch = fetchOrigine;
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
  }

  /* --- 4. De /admin jusqu'au code ----------------------------------------- */

  console.log('\n=== De /admin jusqu’au code ===');

  delete process.env.TELEGRAM_BOT_TOKEN;

  const { clientAdmin, tenantId, chargerSecrets, CATEGORIE_SECRET } = await import(
    '@vigon/services'
  );

  const tenant = await tenantId();
  const db = clientAdmin();

  const CLE = 'TELEGRAM_BOT_TOKEN';
  const VALEUR = '000000:jeton-essai-a-restituer';

  const restituer = await preserverParametres(tenant, [CLE]);
  const avant = await etatRestitue(tenant, [CLE]);

  try {
    const { error } = avant.has(CLE)
      ? await db.from('parametres').update({ valeur: VALEUR }).eq('tenant_id', tenant).eq('cle', CLE)
      : await db
          .from('parametres')
          .insert({ tenant_id: tenant, cle: CLE, valeur: VALEUR, categorie: CATEGORIE_SECRET });

    // L'erreur est LUE : c'est son absence qui avait rendu invisible la perte
    // des clés WhatsApp le 2026-08-20.
    if (error) throw new Error(`Écriture impossible : ${error.message}`);

    verifier('avant chargement, le canal reste inerte', !telegramConfigure());

    await chargerSecrets(tenant, { force: true });

    verifier('une clé écrite en base active le canal', telegramConfigure());

    // La valeur active doit être CELLE DU HARNAIS, pas celle de l'utilisateur.
    const { requis } = await import('@vigon/services');
    verifier(
      'c’est bien la valeur du harnais qui est active',
      requis(CLE)[CLE] === VALEUR,
    );
  } finally {
    await restituer();
    await chargerSecrets(tenant, { force: true });

    const rendues = await etatRestitue(tenant, [CLE]);

    verifier('aucune valeur du harnais ne subsiste', rendues.get(CLE) !== VALEUR);
    verifier(
      avant.size > 0 ? 'la clé réelle est restituée' : 'aucune clé laissée en base',
      avant.size > 0 ? rendues.get(CLE) === avant.get(CLE) : rendues.size === 0,
    );
  }

  if (jetonOrigine === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = jetonOrigine;

  /* --- 5. L'ordre des canaux, tel que le circuit l'applique ---------------- */

  console.log('\n=== Ordre des canaux ===');

  // Lu dans le code plutôt qu'affirmé ici : un essai qui recopierait l'ordre
  // attendu ne vérifierait que sa propre copie.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    'apps/web/app/(dashboard)/demandes/[id]/costing/actions.ts',
    'utf8',
  );

  const posTelegram = source.indexOf("nom: 'telegram'");
  const posWhatsApp = source.indexOf("nom: 'whatsapp'");

  verifier('les deux canaux instantanés sont déclarés', posTelegram > 0 && posWhatsApp > 0);
  verifier(
    'Telegram est essayé avant WhatsApp',
    posTelegram > 0 && posWhatsApp > 0 && posTelegram < posWhatsApp,
  );

  console.log(
    `\n${echecs === 0 ? '✓ Canal Telegram prêt : inerte sans jeton, actif avec.' : `✗ ${echecs} ÉCHEC(S).`}\n`,
  );

  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
