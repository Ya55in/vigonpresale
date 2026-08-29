/**
 * Éprouve l'étape 8 de bout en bout, sur la vraie boîte.
 *
 * 1. Monte une consultation « envoyée » avec un Message-ID connu
 * 2. Dépose dans la boîte une réponse fournisseur (In-Reply-To) avec un devis
 * 3. Lance le vrai job de réception, qui doit aiguiller vers le flux devis
 * 4. Vérifie l'appariement, la classification, les lignes et le mapping
 *
 * Nettoie derrière lui, même en cas d'échec.
 *
 * Usage : npm run essai:reception-devis
 */
import { ImapFlow } from 'imapflow';

import { clientAdmin, tenantId } from '@vigon/services';

import { chargerEnv } from './charger-env.js';

const MARQUEUR = '__ESSAI_ETAPE8__';

async function nettoyer(tenant: string): Promise<void> {
  const db = clientAdmin();

  const { data: consultations } = await db
    .from('consultations')
    .select('id')
    .eq('tenant_id', tenant)
    .eq('marque', MARQUEUR);

  for (const c of consultations ?? []) {
    const { data: devis } = await db
      .from('devis_fournisseur')
      .select('id')
      .eq('consultation_id', c.id);

    for (const d of devis ?? []) {
      await db.from('lignes_devis').delete().eq('devis_id', d.id);
      await db.from('audit_events').delete().eq('entite', 'devis_fournisseur').eq('entite_id', d.id);
      await db.from('devis_fournisseur').delete().eq('id', d.id);
    }
    await db.from('communications').delete().eq('consultation_id', c.id);
    await db.from('consultations').delete().eq('id', c.id);
  }

  await db
    .from('notifications')
    .delete()
    .in('type', ['devis_recu', 'precision_demandee', 'devis_extraction_echouee']);
}

/** Corps du devis, tel qu'un fournisseur l'écrirait. */
const CORPS_DEVIS = `Bonjour,

Suite a votre demande, veuillez trouver notre offre ci-dessous.

Devis n DV-2026-0451 du 31/07/2026 - validite 30 jours
Delai de livraison : 10 jours ouvres
Conditions de paiement : 30 jours fin de mois

  Ref C9200L-48P-4G-E - Switch Cisco Catalyst 9200L 48 ports PoE+
  Quantite : 5 - Prix unitaire HT : 24 500,00 MAD - Remise 5% - En stock

  Ref SRT3000RMXLI - Onduleur APC Smart-UPS SRT 3000VA rack
  Quantite : 7 - Prix unitaire HT : 18 900,00 MAD - Sur commande

Prix exprimes en MAD hors taxes.

Cordialement,
Service commercial`;

function construireReponse(params: {
  destinataire: string;
  expediteur: string;
  sujetOrigine: string;
  messageIdOrigine: string;
}): string {
  return [
    `From: Service commercial <${params.expediteur}>`,
    `To: ${params.destinataire}`,
    `Subject: Re: ${params.sujetOrigine}`,
    `Message-ID: <reponse-essai-${Date.now()}@fournisseur-essai.test>`,
    `In-Reply-To: ${params.messageIdOrigine}`,
    `References: ${params.messageIdOrigine}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    CORPS_DEVIS,
    '',
  ].join('\r\n');
}

async function main(): Promise<void> {
  chargerEnv();

  const db = clientAdmin();
  const tenant = await tenantId();

  const boite = process.env.IMAP_CLIENT_USER;
  if (!boite) throw new Error('IMAP_CLIENT_USER requis.');

  await nettoyer(tenant);

  const { data: demande } = await db
    .from('demandes')
    .select('id, code')
    .eq('tenant_id', tenant)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!demande) {
    console.log('Aucune demande : lancer le worker sur un mail de test.');
    return;
  }

  // --- 1. Consultation « envoyée » avec un Message-ID connu ---
  const messageIdOrigine = `<rfq-essai-${Date.now()}@vigon.test>`;
  const sujet = 'Demande de devis - essai etape 8';

  const { data: consultation, error } = await db
    .from('consultations')
    .insert({
      tenant_id: tenant,
      demande_id: demande.id,
      marque: MARQUEUR,
      fournisseur_nom: 'Fournisseur essai',
      fournisseur_email: boite,
      sujet,
      corps_html: '<p>Demande de devis de test.</p>',
      statut: 'envoyee',
      message_id: messageIdOrigine,
      thread_id: messageIdOrigine,
      date_envoi_reelle: new Date().toISOString(),
      prochaine_relance: new Date(Date.now() + 86_400_000).toISOString(),
    })
    .select('id')
    .single();

  if (error || !consultation) throw new Error(`Montage : ${error?.message}`);

  // La communication sortante est ce qui relie le fil à la consultation.
  await db.from('communications').insert({
    tenant_id: tenant,
    demande_id: demande.id,
    consultation_id: consultation.id,
    direction: 'sortant',
    type: 'demande_devis',
    message_id: messageIdOrigine,
    destinataires: [boite],
    sujet,
  });

  console.log(`Demande ${demande.code} — consultation #${consultation.id} montée.`);
  console.log(`  Message-ID d'origine : ${messageIdOrigine}\n`);

  // --- 2. Dépôt de la réponse dans la boîte ---
  const client = new ImapFlow({
    host: process.env.IMAP_CLIENT_HOST!,
    port: Number(process.env.IMAP_CLIENT_PORT ?? 993),
    secure: true,
    auth: { user: boite, pass: process.env.IMAP_CLIENT_PASSWORD! },
    logger: false,
  });

  await client.connect();
  try {
    await client.append(
      process.env.IMAP_CLIENT_MAILBOX ?? 'INBOX',
      construireReponse({
        destinataire: boite,
        expediteur: 'commercial@fournisseur-essai.test',
        sujetOrigine: sujet,
        messageIdOrigine,
      }),
      ['\\Recent'],
    );
    console.log('✓ Réponse fournisseur déposée dans la boîte\n');
  } finally {
    await client.logout().catch(() => undefined);
  }

  // --- 3. Le vrai job ---
  const { pollClientMailbox } = await import('../apps/worker/src/jobs/pollClientMailbox.js');
  console.log('Lancement de pollClientMailbox…\n');
  await pollClientMailbox();

  // --- 4. Contrôles ---
  const { data: apres } = await db
    .from('consultations')
    .select('statut, date_reponse, prochaine_relance')
    .eq('id', consultation.id)
    .single();

  const { data: devis } = await db
    .from('devis_fournisseur')
    .select('id, numero_devis, date_devis, devise, delai_livraison, conditions_paiement, validite_offre')
    .eq('consultation_id', consultation.id)
    .maybeSingle();

  const { data: lignes } = devis
    ? await db
        .from('lignes_devis')
        .select('designation_fournisseur, reference, quantite, prix_achat_ht, remise_pct, prix_achat_net_ht, disponibilite, mapping_type, demande_item_id')
        .eq('devis_id', devis.id)
    : { data: [] };

  console.log('=== Consultation ===');
  console.log(`  statut            : ${apres?.statut}`);
  console.log(`  date de réponse   : ${apres?.date_reponse ? 'renseignée' : 'ABSENTE'}`);
  console.log(`  relance suivante  : ${apres?.prochaine_relance ? 'ENCORE PLANIFIÉE' : 'annulée'}`);

  console.log('\n=== Devis extrait ===');
  if (!devis) {
    console.log('  AUCUN');
  } else {
    console.log(`  numéro     : ${devis.numero_devis}`);
    console.log(`  date       : ${devis.date_devis}`);
    console.log(`  devise     : ${devis.devise}`);
    console.log(`  validité   : ${devis.validite_offre}`);
    console.log(`  livraison  : ${devis.delai_livraison}`);
    console.log(`  paiement   : ${devis.conditions_paiement}`);
  }

  console.log('\n=== Lignes ===');
  for (const l of lignes ?? []) {
    console.log(
      `  ${l.reference ?? '?'} — ${l.quantite} × ${l.prix_achat_ht} ` +
        `(-${l.remise_pct}% → net ${l.prix_achat_net_ht}) ` +
        `[${l.mapping_type}, article ${l.demande_item_id ?? 'non rattaché'}]`,
    );
  }

  const { data: notifs } = await db
    .from('notifications')
    .select('type, titre, message')
    .in('type', ['devis_recu', 'precision_demandee', 'devis_extraction_echouee']);

  console.log('\n=== Notifications ===');
  for (const n of notifs ?? []) console.log(`  [${n.type}] ${n.titre} — ${n.message}`);

  console.log('\n=== Contrôles ===');
  const controles: [string, boolean][] = [
    ['consultation passée à « devis_recu »', apres?.statut === 'devis_recu'],
    ['relances annulées', apres?.prochaine_relance === null],
    ['devis enregistré', Boolean(devis)],
    ['numéro de devis extrait', devis?.numero_devis === 'DV-2026-0451'],
    ['2 lignes extraites', (lignes ?? []).length === 2],
    [
      'lignes rattachées aux articles',
      (lignes ?? []).every((l) => l.demande_item_id !== null),
    ],
    [
      'prix unitaire (et non total) retenu',
      (lignes ?? []).some((l) => Number(l.prix_achat_ht) === 24500),
    ],
    ['remise appliquée en base', (lignes ?? []).some((l) => Number(l.prix_achat_net_ht) === 23275)],
  ];

  let echecs = 0;
  for (const [libelle, ok] of controles) {
    if (!ok) echecs += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${libelle}`);
  }

  await nettoyer(tenant);
  console.log('\nDonnées de test supprimées.');

  if (echecs > 0) process.exit(1);
}

main().catch(async (e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  try {
    await nettoyer(await tenantId());
    console.error('Données de test supprimées malgré l’échec.');
  } catch {
    console.error('Nettoyage impossible — vérifier les lignes __ESSAI_ETAPE8__.');
  }
  process.exit(1);
});
