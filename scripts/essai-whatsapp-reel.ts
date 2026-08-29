/**
 * Envoie un VRAI message WhatsApp, pour éprouver la liaison de bout en bout.
 *
 * POURQUOI IL EXISTE, À CÔTÉ DE `essai:whatsapp`
 *
 * `essai:whatsapp` éprouve la plomberie sans réseau : garde, normalisation,
 * lecture des clés depuis `/admin`. Il ne peut pas dire si le jeton est encore
 * valide, si le numéro est dans la liste autorisée, ni si Meta accepte le
 * message. Seul un envoi le dit.
 *
 * CE QU'IL DÉMONTRE, ET C'EST LE POINT
 *
 * Deux envois, dans cet ordre :
 *
 *  1. un MODÈLE approuvé (`hello_world`, livré avec toute app de test) ;
 *  2. le TEXTE LIBRE, celui que la plateforme envoie aujourd'hui.
 *
 * L'API WhatsApp Business n'autorise le texte libre que dans les 24 h suivant
 * un message du destinataire. Une demande de validation part sans sollicitation,
 * vers un approbateur qui n'a jamais écrit : le second envoi doit donc échouer
 * là où le premier passe. C'est ce qu'il faut constater plutôt que croire.
 *
 * LE JETON N'EST JAMAIS AFFICHÉ NI DEMANDÉ : il est lu dans `parametres`, comme
 * le fait le worker. Seul le numéro est passé en argument.
 *
 * ENVOIE UN MESSAGE RÉEL. Le numéro est obligatoire, sans valeur par défaut :
 * rien ne part sur une exécution distraite.
 *
 * Usage :
 *   npm run essai:whatsapp-reel -- 212612345678
 *   npm run essai:whatsapp-reel -- 212612345678 --enregistrer 123456
 *
 * Le second inscrit d'abord le numéro ÉMETTEUR sur l'API Cloud — étape unique,
 * sans laquelle tout envoi échoue en 133010. Elle modifie le compte Meta, donc
 * elle n'a lieu que si le drapeau est posé.
 */
import { chargerEnv } from './charger-env.js';

const VERSION_API = 'v21.0';

type ReponseMeta = {
  messages?: { id: string }[];
  error?: { message?: string; code?: number; error_subcode?: number };
};

/**
 * Traduit les refus les plus probables, sans masquer le message de Meta.
 *
 * LE MESSAGE PRIME SUR LE CODE quand il désigne une cause plus précise.
 *
 * Le code 190 couvre indistinctement le jeton périmé, révoqué et illisible. La
 * première version de ce script le traduisait par « jeton expiré » : envoyé sur
 * un « Cannot parse access token », il a fait chercher un nouveau jeton alors
 * que le vrai défaut était un `Bearer undefined` émis par ce script même.
 *
 * Un diagnostic qui se trompe coûte plus cher que pas de diagnostic : il fait
 * agir dans la mauvaise direction, avec l'assurance d'avoir compris.
 */
function expliquer(erreur: ReponseMeta['error']): string {
  const message = erreur?.message ?? '';

  if (/cannot parse access token/i.test(message)) {
    return (
      'Jeton ILLISIBLE, et non expiré — souvent vide ou tronqué à la lecture.\n' +
      '         Vérifier qu’il est bien lu par `requis`, pas par `process.env` :\n' +
      '         `chargerSecrets` range les clés de /admin hors de `process.env`.'
    );
  }

  const codes: Record<number, string> = {
    133010:
      'Numéro émetteur JAMAIS ENREGISTRÉ auprès de l’API Cloud.\n' +
      '         Étape unique, indépendante du jeton et du destinataire : la console\n' +
      '         la fait implicitement au premier « Send message », ce qui la rend\n' +
      '         invisible à qui passe directement par un System User.\n' +
      '         Remède : npm run essai:whatsapp-reel -- <numéro> --enregistrer <pin>',
    131030: 'Numéro absent de la liste autorisée du numéro de test — ajoutez-le dans API Setup, champ « To ».',
    131047: 'Fenêtre de 24 h fermée : le texte libre exige que le destinataire ait écrit le premier. C’est exactement la limite qui impose un modèle.',
    131026: 'Le destinataire n’a pas de compte WhatsApp, ou ne peut pas recevoir de message.',
    190: 'Jeton périmé ou révoqué — un jeton d’API Setup ne vit que 24 h.',
    100: 'Paramètre refusé : souvent un numéro mal formé, ou un modèle inconnu du compte.',
  };

  const connu = erreur?.code ? codes[erreur.code] : undefined;
  return connu ? `${connu}\n         Meta : ${message}` : (message || 'refus sans motif');
}

async function envoyer(
  jeton: string,
  numeroId: string,
  destinataire: string,
  charge: Record<string, unknown>,
): Promise<{ ok: boolean; detail: string }> {
  const r = await fetch(`https://graph.facebook.com/${VERSION_API}/${numeroId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: destinataire, ...charge }),
  });

  const corps = (await r.json().catch(() => null)) as ReponseMeta | null;

  if (r.ok && corps?.messages?.[0]?.id) {
    return { ok: true, detail: corps.messages[0].id };
  }
  return { ok: false, detail: expliquer(corps?.error) };
}

async function main(): Promise<void> {
  chargerEnv();

  const brut = process.argv[2];
  if (!brut) {
    console.error(
      '\n✗ Numéro manquant.\n\n' +
        '  npm run essai:whatsapp-reel -- 212612345678\n\n' +
        '  Format international, sans « + » ni « 00 », sans le zéro du numéro local.\n' +
        '  Le numéro doit figurer dans la liste autorisée du numéro de test.\n',
    );
    process.exit(1);
  }

  const {
    chargerSecrets,
    tenantId,
    whatsappConfigure,
    normaliserNumero,
    verifierAccesWhatsApp,
    requis,
  } = await import('@vigon/services');

  await chargerSecrets(await tenantId(), { force: true });

  if (!whatsappConfigure()) {
    console.error('\n✗ WhatsApp non configuré : renseignez les deux clés dans /admin.\n');
    process.exit(1);
  }

  // Normalisé par la plateforme, pas à la main : c'est ce numéro-là qu'elle
  // enverra, et un essai qui en formerait un autre ne prouverait rien.
  const destinataire = normaliserNumero(brut);
  console.log(`\nNuméro       : « ${brut} » → ${destinataire}`);

  /*
   * `requis`, JAMAIS `process.env`.
   *
   * `chargerSecrets` range les clés de `/admin` dans une table de surcharges
   * propre au module d'environnement — elle n'écrit pas dans `process.env`.
   * Lire `process.env.WHATSAPP_TOKEN` rendait donc `undefined`, et la requête
   * partait avec « Bearer undefined ».
   *
   * Le symptôme était trompeur au possible : Meta répond « Invalid OAuth access
   * token - Cannot parse access token », que ce script traduisait en « jeton
   * expiré » — envoyant chercher un nouveau jeton alors que le défaut était
   * ici. Et la vérification du compte, juste au-dessus, réussissait : elle passe
   * par `verifierAccesWhatsApp`, qui utilise `requis`.
   *
   * Un GET qui marche et un POST qui échoue sur le même jeton : c'est cette
   * contradiction qui a désigné le coupable.
   */
  const { WHATSAPP_TOKEN: jeton, WHATSAPP_PHONE_NUMBER_ID: numeroId } = requis(
    'WHATSAPP_TOKEN',
    'WHATSAPP_PHONE_NUMBER_ID',
  );

  /* --- 1. Le compte répond-il ? ------------------------------------------- */

  try {
    console.log(`Compte       : ${await verifierAccesWhatsApp()}`);
  } catch (e) {
    console.error(`\n✗ Le compte ne répond pas : ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  }

  /*
   * État d'inscription du numéro, lu AVANT d'envoyer quoi que ce soit.
   *
   * `platform_type` vaut `NOT_APPLICABLE` tant que le numéro n'est pas inscrit
   * sur l'API Cloud, et `CLOUD_API` ensuite. C'est la seule lecture qui explique
   * un 133010 sans avoir à le provoquer.
   *
   * `is_pin_enabled` répond à la question que pose forcément `--enregistrer` :
   * faut-il inventer le code à six chiffres ou en retrouver un existant. Le
   * demander sans le dire laisse chercher un secret qui n'existe pas.
   */
  let pinDejaPose = false;

  try {
    const r = await fetch(
      `https://graph.facebook.com/${VERSION_API}/${numeroId}` +
        '?fields=platform_type,is_pin_enabled,status',
      { headers: { Authorization: `Bearer ${jeton}` } },
    );
    const fiche = (await r.json()) as {
      platform_type?: string;
      is_pin_enabled?: boolean;
      status?: string;
    };

    pinDejaPose = fiche.is_pin_enabled === true;

    const inscrit = fiche.platform_type === 'CLOUD_API';
    console.log(
      `Inscription  : ${inscrit ? 'API Cloud' : `NON INSCRIT (${fiche.platform_type ?? '?'}) — cause d’un 133010`}` +
        ` · code à six chiffres ${pinDejaPose ? 'DÉJÀ POSÉ' : 'jamais posé'}` +
        (fiche.status ? ` · statut ${fiche.status}` : ''),
    );
  } catch {
    // Information de confort : son absence ne doit pas empêcher les envois.
  }

  /* --- 1 bis. Enregistrement du numéro émetteur, sur demande explicite ----- */

  /*
   * MODIFIE LE COMPTE META, donc jamais automatique.
   *
   * `POST /{phone-number-id}/register` inscrit le numéro sur l'API Cloud. Sans
   * cette étape, tout envoi échoue en 133010, quel que soit le jeton ou le
   * destinataire. La console la fait implicitement au premier « Send message »,
   * ce qui la rend invisible à qui configure par un System User.
   *
   * Le `pin` est le code de vérification en deux étapes du numéro. S'il n'a
   * jamais été posé, celui fourni ici le devient — d'où l'argument obligatoire :
   * choisir un code à la place de quelqu'un serait choisir son mot de passe.
   */
  const indexEnr = process.argv.indexOf('--enregistrer');

  if (indexEnr !== -1) {
    const pin = process.argv[indexEnr + 1];

    if (!pin || !/^\d{6}$/.test(pin)) {
      console.error(
        '\n✗ Code à six chiffres attendu :\n' +
          `  npm run essai:whatsapp-reel -- ${brut} --enregistrer 123456\n\n` +
          (pinDejaPose
            ? '  Ce numéro a DÉJÀ un code de vérification en deux étapes.\n' +
              '  Indiquez CELUI-LÀ : un autre sera refusé. Oublié, il se réinitialise\n' +
              '  dans WhatsApp Manager → Numéros → Vérification en deux étapes.\n'
            : '  Ce numéro n’a PAS ENCORE de code : celui que vous donnez le devient.\n' +
              '  Choisissez six chiffres quelconques et notez-les — ils seront demandés\n' +
              '  à toute réinscription du numéro.\n'),
      );
      process.exit(1);
    }

    console.log('\n=== Enregistrement du numéro émetteur ===');

    const r = await fetch(`https://graph.facebook.com/${VERSION_API}/${numeroId}/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });

    const corps = (await r.json().catch(() => null)) as
      | ({ success?: boolean } & ReponseMeta)
      | null;

    if (r.ok && corps?.success !== false) {
      console.log('  ok     numéro enregistré — les envois peuvent partir');
    } else {
      console.log(`  ÉCHEC  ${expliquer(corps?.error)}`);
      console.log('\n  Les envois qui suivent échoueront tant que ce point n’est pas réglé.');
    }
  }

  /* --- 2. Le modèle approuvé ---------------------------------------------- */

  console.log('\n=== Modèle approuvé (hello_world) ===');

  const modele = await envoyer(jeton, numeroId, destinataire, {
    type: 'template',
    template: { name: 'hello_world', language: { code: 'en_US' } },
  });

  console.log(modele.ok ? `  ok     message envoyé — ${modele.detail}` : `  ÉCHEC  ${modele.detail}`);

  /* --- 3. Le texte libre, celui de la plateforme --------------------------- */

  console.log('\n=== Texte libre (ce que la plateforme envoie) ===');

  const texte = await envoyer(jeton, numeroId, destinataire, {
    type: 'text',
    text: { preview_url: false, body: 'Vigon — contrôle de liaison. Aucune action attendue.' },
  });

  console.log(texte.ok ? `  ok     message envoyé — ${texte.detail}` : `  ÉCHEC  ${texte.detail}`);

  /* --- Lecture du résultat ------------------------------------------------- */

  console.log('\n=== Ce que cela signifie ===');

  if (modele.ok && texte.ok) {
    console.log(
      '  Les deux passent. Le destinataire vous a écrit dans les 24 h, la fenêtre\n' +
        '  de service est donc ouverte. Ce ne sera PAS le cas d’un approbateur qui\n' +
        '  reçoit sa première demande : prévoir un modèle malgré ce résultat.',
    );
  } else if (modele.ok && !texte.ok) {
    console.log(
      '  Le modèle passe, le texte libre non — le cas attendu, et celui de la\n' +
        '  production. La validation WhatsApp exige un modèle approuvé.',
    );
  } else if (!modele.ok && !texte.ok) {
    console.log('  Rien ne passe : le motif ci-dessus est à traiter avant tout le reste.');
  } else {
    console.log('  Le texte libre passe mais pas le modèle : vérifier son nom et sa langue.');
  }

  console.log('');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
