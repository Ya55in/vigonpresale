/**
 * Remet un message en « non lu » pour rejouer le flux de réception.
 * Sert à vérifier l'idempotence : usage npm run essai:relire -- <uid>
 */
import { ImapFlow } from 'imapflow';

import { chargerEnv } from './charger-env.js';

async function main(): Promise<void> {
  chargerEnv();

  const uid = process.argv[2];
  if (!uid) throw new Error('Usage : npm run essai:relire -- <uid>');

  const client = new ImapFlow({
    host: process.env.IMAP_CLIENT_HOST!,
    port: Number(process.env.IMAP_CLIENT_PORT ?? 993),
    secure: true,
    auth: {
      user: process.env.IMAP_CLIENT_USER!,
      pass: process.env.IMAP_CLIENT_PASSWORD!,
    },
    logger: false,
  });

  await client.connect();
  const verrou = await client.getMailboxLock(process.env.IMAP_CLIENT_MAILBOX ?? 'INBOX');
  try {
    await client.messageFlagsRemove(uid, ['\\Seen'], { uid: true });
    console.log(`✓ uid ${uid} remis en non-lu.`);
  } finally {
    verrou.release();
    await client.logout().catch(() => undefined);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
