/**
 * Relève les identifiants de chat Telegram des personnes ayant écrit au bot.
 *
 * POURQUOI CE SCRIPT EXISTE
 *
 * Un bot Telegram ne peut pas écrire le premier : le destinataire doit avoir
 * démarré la conversation. Cette contrainte a un effet utile — c'est ce premier
 * message qui révèle l'identifiant de chat, seule adresse que l'API accepte.
 *
 * Il n'existe aucun moyen de deviner cet identifiant depuis un nom ou un numéro.
 * Ce script lit la file des messages reçus (`getUpdates`) et affiche qui a
 * écrit, avec son identifiant, à recopier dans /admin.
 *
 * LECTURE SEULE, et volontairement : il n'écrit ni en base ni sur Telegram.
 * Associer automatiquement un chat à un compte supposerait de rapprocher un
 * prénom Telegram d'une adresse e-mail, ce qui se trompe de personne dès que
 * deux collègues partagent un prénom. Un humain recopie, et sait qui il associe.
 *
 * `getUpdates` ne rend que les messages des dernières 24 h environ, et Telegram
 * les purge après lecture par un webhook. Si la file est vide, il suffit de
 * redemander à la personne d'écrire au bot.
 *
 * Usage : npm run telegram:contacts
 */
import { chargerEnv } from './charger-env.js';

type Update = {
  message?: {
    chat?: { id?: number; first_name?: string; last_name?: string; username?: string; type?: string };
    text?: string;
    date?: number;
  };
};

async function main(): Promise<void> {
  chargerEnv();

  const { chargerSecrets, tenantId, telegramConfigure, requis, clientAdmin } =
    await import('@vigon/services');

  const tenant = await tenantId();
  await chargerSecrets(tenant, { force: true });

  if (!telegramConfigure()) {
    console.error(
      '\n✗ Aucun jeton de bot.\n\n' +
        '  1. Sur Telegram, écrire à @BotFather → /newbot\n' +
        '  2. Coller le jeton obtenu dans /admin → Telegram — jeton du bot\n',
    );
    process.exit(1);
  }

  const { TELEGRAM_BOT_TOKEN: jeton } = requis('TELEGRAM_BOT_TOKEN');

  const reponse = await fetch(`https://api.telegram.org/bot${jeton}/getUpdates`, {
    signal: AbortSignal.timeout(20_000),
  });

  const corps = (await reponse.json().catch(() => null)) as {
    ok?: boolean;
    result?: Update[];
    description?: string;
  } | null;

  if (!reponse.ok || !corps?.ok) {
    console.error(`\n✗ Telegram refuse : ${corps?.description ?? `HTTP ${reponse.status}`}\n`);
    process.exit(1);
  }

  // Dédoublonné par chat : quelqu'un qui a écrit trois fois ne doit apparaître
  // qu'une fois, avec son message le plus récent.
  const parChat = new Map<string, { nom: string; dernier: string; date: number }>();

  for (const update of corps.result ?? []) {
    const chat = update.message?.chat;
    if (!chat?.id) continue;

    const nom =
      [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
      (chat.username ? `@${chat.username}` : '(sans nom)');

    parChat.set(String(chat.id), {
      nom: chat.username && !nom.startsWith('@') ? `${nom} (@${chat.username})` : nom,
      dernier: (update.message?.text ?? '').slice(0, 40),
      date: update.message?.date ?? 0,
    });
  }

  if (parChat.size === 0) {
    console.log(
      '\nAucun message reçu par le bot.\n\n' +
        '  Demandez à chaque approbateur d’ouvrir Telegram, de chercher le bot\n' +
        '  et de lui envoyer un message — n’importe lequel, « bonjour » suffit.\n' +
        '  Relancez ensuite cette commande.\n\n' +
        '  À savoir : Telegram purge cette file après ~24 h.\n',
    );
    return;
  }

  // Les comptes déjà associés sont signalés, pour distinguer ce qui reste à
  // faire de ce qui est déjà en place.
  const { data: utilisateurs } = await clientAdmin()
    .from('users')
    .select('email, telegram_chat_id')
    .eq('tenant_id', tenant);

  const dejaAssocies = new Map(
    (utilisateurs ?? [])
      .filter((u) => u.telegram_chat_id)
      .map((u) => [u.telegram_chat_id as string, u.email]),
  );

  console.log(`\n${parChat.size} conversation(s) ouverte(s) avec le bot :\n`);
  console.log('  identifiant'.padEnd(20) + 'associé à'.padEnd(28) + 'personne');
  console.log('  ' + '-'.repeat(74));

  for (const [chatId, info] of parChat) {
    const associe = dejaAssocies.get(chatId);
    console.log(
      '  ' +
        chatId.padEnd(18) +
        (associe ?? '— à associer').padEnd(28) +
        `${info.nom}  « ${info.dernier} »`,
    );
  }

  console.log(
    '\n  Recopiez l’identifiant dans /admin → Utilisateurs → colonne « Telegram »,\n' +
      '  sur la ligne de la personne concernée.\n',
  );
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
