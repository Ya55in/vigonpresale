/**
 * Envoie un message réel à soi-même et vérifie qu'il arrive dans la boîte.
 *
 * Usage : npm run essai:smtp
 */
import { envoyer, descriptionEnvoi, verifierAccesImap } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

async function main(): Promise<void> {
  chargerEnv();

  const destinataire = process.env.IMAP_CLIENT_USER;
  if (!destinataire) throw new Error('IMAP_CLIENT_USER requis.');

  console.log(`Transport fournisseur : ${descriptionEnvoi('fournisseur')}`);
  console.log(`Destinataire (soi-même) : ${destinataire}\n`);

  const avant = await verifierAccesImap();
  const marqueur = `essai-smtp-${Date.now()}`;

  const message = await envoyer('fournisseur', {
    a: destinataire,
    sujet: `Vigon — essai d'envoi SMTP (${marqueur})`,
    html: `<p>Message de contrôle émis par <strong>npm run essai:smtp</strong>.</p>
           <p>Marqueur : ${marqueur}</p>`,
    texte: `Message de contrôle. Marqueur : ${marqueur}`,
    // Même motif que `essai:envoi-offre` : ce message revient par la relève, et
    // sans cet en-tête il devient une demande aussitôt bloquée. C'est ce qui a
    // produit DM-2026-000021.
    entetes: { 'Auto-Submitted': 'auto-generated' },
  });

  console.log('✓ Message accepté par le serveur');
  console.log(`  transport  : ${message.transport}`);
  console.log(`  message-id : ${message.messageId}`);
  console.log(`  thread-id  : ${message.threadId}`);
  console.log(`\n  boîte avant envoi : ${avant} message(s)`);
  console.log('  (la réception peut prendre quelques secondes)');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
