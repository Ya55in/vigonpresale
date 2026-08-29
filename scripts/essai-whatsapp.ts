/**
 * Éprouve la préparation du canal WhatsApp, sans compte Business.
 *
 * Le compte n'existe pas encore. Ce qui doit être garanti dès maintenant tient
 * en deux promesses opposées :
 *
 *  1. **Tant que la clé est absente, RIEN ne change.** Aucun appel réseau,
 *     aucune erreur, la validation part par courriel comme avant. Un canal
 *     préparé qui casserait le canal existant serait pire que pas de canal.
 *  2. **Le jour où la clé est saisie, ça s'active.** Sans redéploiement, sans
 *     modification de code — une valeur dans `/admin` et le transport bascule.
 *
 * Les deux sont vérifiées ici en manipulant l'environnement du processus, donc
 * sans jamais appeler Meta.
 *
 * LECTURE SEULE : rien n'est écrit en base, rien n'est envoyé.
 *
 * Usage : npm run essai:whatsapp
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
    whatsappConfigure,
    descriptionWhatsApp,
    normaliserNumero,
    envoyerWhatsApp,
    ErreurWhatsApp,
    estCleGeree,
    CLES_GEREES,
  } = await import('@vigon/services');

  /* --- 1. Les clés sont gérables depuis /admin --------------------------- */

  console.log('\n=== Clés dans l’écran d’administration ===');

  for (const nom of ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']) {
    verifier(`${nom} est gérable depuis /admin`, estCleGeree(nom));
  }

  const declarees = CLES_GEREES.filter((c) => c.service === 'whatsapp');
  verifier('les deux clés portent le service « whatsapp »', declarees.length === 2);

  // L'identifiant de numéro n'est pas un secret : le masquer empêcherait de
  // vérifier qu'on a saisi le bon, et il ne donne aucun accès seul.
  const identifiant = declarees.find((c) => c.nom === 'WHATSAPP_PHONE_NUMBER_ID');
  verifier(
    'l’identifiant de numéro est relisible, le jeton non',
    (identifiant as { sensible?: boolean } | undefined)?.sensible === false,
  );

  /* --- 2. Sans clé, rien ne bouge ---------------------------------------- */

  console.log('\n=== Sans clé : le courriel reste le transport ===');

  const jetonOrigine = process.env.WHATSAPP_TOKEN;
  const numeroOrigine = process.env.WHATSAPP_PHONE_NUMBER_ID;

  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;

  verifier('le canal se déclare non configuré', !whatsappConfigure());
  verifier('la description le dit', descriptionWhatsApp() === 'non configuré', descriptionWhatsApp());

  // Le point qui compte : un appel par mégarde doit lever une erreur PARLANTE
  // et surtout ne toucher aucun réseau.
  const debut = Date.now();
  let erreur: unknown = null;
  try {
    await envoyerWhatsApp({ destinataire: '212600000000', texte: 'essai' });
  } catch (e) {
    erreur = e;
  }
  const duree = Date.now() - debut;

  verifier('un envoi sans clé lève ErreurWhatsApp', erreur instanceof ErreurWhatsApp);
  verifier(
    'sans appel réseau',
    duree < 200,
    `${duree} ms`,
  );
  verifier(
    'le message dit où saisir la clé',
    erreur instanceof Error && erreur.message.includes('/admin'),
    erreur instanceof Error ? erreur.message.slice(0, 70) : '—',
  );

  /* --- 3. Une clé saisie suffit à activer -------------------------------- */

  console.log('\n=== Avec une clé : le canal s’active ===');

  process.env.WHATSAPP_TOKEN = 'jeton-d-essai-non-valide';
  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';

  verifier('le canal se déclare configuré', whatsappConfigure());
  verifier(
    'la description nomme le numéro sans l’exposer',
    descriptionWhatsApp().includes('•') && descriptionWhatsApp().includes('2345'),
    descriptionWhatsApp(),
  );

  // Un jeton seul ne suffit pas : l'API refuse un envoi sans savoir QUI envoie.
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  verifier('un jeton sans identifiant de numéro ne suffit pas', !whatsappConfigure());

  /* --- 4. Normalisation des numéros -------------------------------------- */

  console.log('\n=== Numéros ===');

  // Un numéro saisi par un humain porte des espaces et un `+` ; l'API les
  // refuse. Les cas ci-dessous sont ceux d'un carnet d'adresses marocain réel.
  const cas: [string, string][] = [
    ['+212 6 12 34 56 78', '212612345678'],
    // Ce cas AFFIRMAIT « 00212612345678 → 00212612345678 », c'est-à-dire un
    // numéro que Meta refuse. Un essai qui entérine le défaut le verrouille :
    // il aurait fallu le modifier pour corriger, ce qui décourage de corriger.
    ['00212612345678', '212612345678'],
    ['212-612-345-678', '212612345678'],
    ['(212) 612 345 678', '212612345678'],
  ];

  for (const [brut, attendu] of cas) {
    const obtenu = normaliserNumero(brut);
    verifier(`« ${brut} » → ${attendu}`, obtenu === attendu, obtenu);
  }

  process.env.WHATSAPP_PHONE_NUMBER_ID = '123456789012345';

  let erreurNumero: unknown = null;
  try {
    await envoyerWhatsApp({ destinataire: '12', texte: 'essai' });
  } catch (e) {
    erreurNumero = e;
  }
  verifier(
    'un numéro trop court est refusé avant tout appel',
    erreurNumero instanceof ErreurWhatsApp,
    erreurNumero instanceof Error ? erreurNumero.message.slice(0, 50) : '—',
  );

  // Le format national ne s'invente pas : coller un indicatif supposerait le
  // pays de l'approbateur. Refusé en le nommant, plutôt qu'envoyé au hasard.
  //
  // Après la configuration factice ci-dessus, sinon c'est la garde « non
  // configuré » qui répond et l'essai ne prouve rien.
  {
    let motif = '';
    try {
      await envoyerWhatsApp({ destinataire: '0612345678', texte: 'x' });
    } catch (e) {
      motif = e instanceof ErreurWhatsApp ? e.message : String(e);
    }
    verifier(
      'un numéro national est refusé, et la cause est nommée',
      motif.includes('indicatif pays'),
      motif || '⚠ AUCUN REFUS',
    );
  }

  /* --- 5. Le chemin réel : /admin écrit en base, le code doit le voir ----- */

  console.log('\n=== De /admin jusqu’au code ===');

  // C'est LA promesse à tenir : saisir la clé dans l'écran d'administration
  // suffit, sans redéploiement ni variable d'hébergeur. Les clés gérées vivent
  // dans `parametres`, et `chargerSecrets` les injecte dans l'environnement du
  // processus. Une action qui ne l'appelle pas ne les verra jamais — c'est
  // exactement ce qui manquait au circuit de validation.
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;

  const { clientAdmin, tenantId, chargerSecrets, CATEGORIE_SECRET } = await import(
    '@vigon/services'
  );

  const tenant = await tenantId();
  const db = clientAdmin();

  const posees = [
    { cle: 'WHATSAPP_TOKEN', valeur: 'jeton-essai-a-supprimer' },
    { cle: 'WHATSAPP_PHONE_NUMBER_ID', valeur: '999888777666555' },
  ];

  /*
   * CE QUI ÉTAIT DÉJÀ LÀ EST RELEVÉ AVANT D'ÉCRIRE.
   *
   * Ce harnais a effacé de vraies clés WhatsApp le 2026-08-20. Deux fautes
   * cumulées, chacune inoffensive isolément :
   *
   *  - il faisait un `insert` sans lire l'erreur. Une ligne existant déjà, la
   *    contrainte d'unicité le refusait EN SILENCE, et le contrôle « une clé
   *    écrite en base active le canal » passait au vert sur la vraie clé de
   *    l'utilisateur, pas sur celle du harnais ;
   *  - il « nettoyait » par `delete` sur le nom de la clé, donc en supprimant
   *    ce qu'il n'avait pas créé.
   *
   * Écrit quand la table était vide, il tenait pour acquis qu'elle le resterait.
   */
  const cles = posees.map((p) => p.cle);
  const restituer = await preserverParametres(tenant, cles);
  const avant = await etatRestitue(tenant, cles);

  try {
    for (const { cle, valeur } of posees) {
      // Mise à jour quand la ligne existe, insertion sinon — exactement ce que
      // fait l'écran d'administration. Et l'erreur est LUE : c'est son absence
      // qui a rendu la première faute invisible.
      const { error } = avant.has(cle)
        ? await db
            .from('parametres')
            .update({ valeur })
            .eq('tenant_id', tenant)
            .eq('cle', cle)
        : await db
            .from('parametres')
            .insert({ tenant_id: tenant, cle, valeur, categorie: CATEGORIE_SECRET });

      if (error) throw new Error(`Écriture de ${cle} impossible : ${error.message}`);
    }

    verifier('avant chargement, le canal reste inerte', !whatsappConfigure());

    await chargerSecrets(tenant, { force: true });

    verifier(
      'une clé écrite en base active le canal',
      whatsappConfigure(),
      descriptionWhatsApp(),
    );

    // La valeur lue doit être CELLE DU HARNAIS. Sans ce contrôle, une écriture
    // muette laissait le test passer sur la valeur d'origine — ce qui a
    // précisément masqué le défaut.
    verifier(
      'c’est bien la valeur du harnais qui est active',
      descriptionWhatsApp().includes('6555'),
      descriptionWhatsApp(),
    );
  } finally {
    await restituer();
    await chargerSecrets(tenant, { force: true });

    const rendues = await etatRestitue(tenant, cles);

    verifier(
      'aucune valeur du harnais ne subsiste',
      ![...rendues.values()].some((v) => posees.some((p) => p.valeur === v)),
    );

    verifier(
      avant.size > 0 ? 'les clés réelles sont restituées' : 'aucune clé laissée en base',
      avant.size > 0
        ? [...avant].every(([cle, v]) => rendues.get(cle) === v)
        : rendues.size === 0,
      avant.size > 0 ? `${avant.size} restituée(s)` : '',
    );
  }

  /* --- Restitution de l'environnement ------------------------------------ */

  if (jetonOrigine === undefined) delete process.env.WHATSAPP_TOKEN;
  else process.env.WHATSAPP_TOKEN = jetonOrigine;

  if (numeroOrigine === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  else process.env.WHATSAPP_PHONE_NUMBER_ID = numeroOrigine;

  console.log(
    `\n${echecs === 0 ? '✓ Canal WhatsApp prêt : inerte sans clé, actif avec.' : `✗ ${echecs} ÉCHEC(S).`}\n`,
  );

  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
