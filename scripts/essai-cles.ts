/**
 * Vérifie que les clés stockées en base priment sur l'environnement et
 * deviennent actives sans redémarrage.
 *
 * Nettoie derrière lui, même en cas d'échec.
 *
 * Usage : npm run essai:cles
 */
import {
  chargerSecrets,
  clientAdmin,
  etatDesCles,
  masquer,
  oublierSecrets,
  optionnel,
  tenantId,
  CATEGORIE_SECRET,
} from '@vigon/services';

import { chargerEnv } from './charger-env.js';
import { preserverParametres, type Restitution } from './preserver-parametres.js';

/** Clé de test : sans effet sur les services, contrairement à une vraie. */
const CLE = 'GAMMA_API_KEY';
const VALEUR_TEST = 'valeur-de-test-ne-pas-utiliser-1234';

/**
 * Retrait de la ligne — étape du scénario, pas le nettoyage final.
 *
 * Le harnais éprouve précisément la transition « base → absente », donc il DOIT
 * supprimer en cours de route. Ce que ce `delete` ne doit pas faire, c'est
 * emporter une valeur que l'utilisateur avait saisie dans /admin : c'est le rôle
 * de `preserverParametres`, qui la relève au départ et la remet à la fin.
 */
async function nettoyer(tenant: string): Promise<void> {
  await clientAdmin()
    .from('parametres')
    .delete()
    .eq('tenant_id', tenant)
    .eq('cle', CLE)
    .eq('categorie', CATEGORIE_SECRET);
  oublierSecrets();
}

/** Restitution en attente, pour que le gestionnaire d'échec y accède aussi. */
let restituer: Restitution | null = null;

async function main(): Promise<void> {
  chargerEnv();

  const db = clientAdmin();
  const tenant = await tenantId();

  // AVANT toute écriture : ce harnais effaçait la clé Gamma dès sa première
  // ligne, sans regarder si elle venait de /admin. Même faute qu'essai:whatsapp
  // le 2026-08-20, sur une autre clé.
  restituer = await preserverParametres(tenant, [CLE]);

  await nettoyer(tenant);

  const valeurEnv = process.env[CLE]?.trim() ?? null;
  console.log(`Clé testée : ${CLE}`);
  console.log(`  dans l'environnement : ${valeurEnv ? masquer(valeurEnv) : 'absente'}\n`);

  // --- 1. Avant écriture : l'environnement fait foi ---
  await chargerSecrets(tenant, { force: true });
  const avant = optionnel(CLE, '(aucune)');
  const etatAvant = (await etatDesCles(tenant)).find((c) => c.nom === CLE);

  console.log('=== Avant enregistrement ===');
  console.log(`  valeur lue par les services : ${avant === '(aucune)' ? '(aucune)' : masquer(avant)}`);
  console.log(`  source affichée à l'écran   : ${etatAvant?.source}`);

  // --- 2. Écriture en base ---
  const { error } = await db.from('parametres').insert({
    tenant_id: tenant,
    cle: CLE,
    valeur: VALEUR_TEST,
    type_valeur: 'texte',
    categorie: CATEGORIE_SECRET,
    description: 'Clé de test.',
  });
  if (error) throw new Error(`Écriture impossible : ${error.message}`);

  await chargerSecrets(tenant, { force: true });
  const apres = optionnel(CLE, '(aucune)');
  const etatApres = (await etatDesCles(tenant)).find((c) => c.nom === CLE);

  console.log('\n=== Après enregistrement ===');
  console.log(`  valeur lue par les services : ${masquer(apres)}`);
  console.log(`  source affichée à l'écran   : ${etatApres?.source}`);
  console.log(`  aperçu affiché              : ${etatApres?.apercu}`);

  // --- 3. Suppression : l'environnement reprend la main ---
  await nettoyer(tenant);
  await chargerSecrets(tenant, { force: true });
  const final = optionnel(CLE, '(aucune)');
  const etatFinal = (await etatDesCles(tenant)).find((c) => c.nom === CLE);

  console.log('\n=== Après suppression ===');
  console.log(`  valeur lue par les services : ${final === '(aucune)' ? '(aucune)' : masquer(final)}`);
  console.log(`  source affichée à l'écran   : ${etatFinal?.source}`);

  // --- Contrôles ---
  console.log('\n=== Contrôles ===');
  const controles: [string, boolean][] = [
    ['la base prime sur l’environnement', apres === VALEUR_TEST],
    ['la source passe à « base »', etatApres?.source === 'base'],
    ["l'aperçu ne révèle pas la valeur", !etatApres?.apercu?.includes(VALEUR_TEST)],
    ["l'aperçu garde de quoi reconnaître la clé", Boolean(etatApres?.apercu?.endsWith('1234'))],
    [
      'la suppression rend la main à l’environnement',
      valeurEnv ? final === valeurEnv : final === '(aucune)',
    ],
    [
      'la source revient à son état initial',
      etatFinal?.source === (valeurEnv ? 'environnement' : 'absente'),
    ],
  ];

  let echecs = 0;
  for (const [libelle, ok] of controles) {
    if (!ok) echecs += 1;
    console.log(`  ${ok ? '✓' : '✗'} ${libelle}`);
  }

  // Restitution APRÈS les contrôles : l'un d'eux porte justement sur l'état
  // « clé absente », qu'une remise en place anticipée effacerait.
  await restituer?.();
  await chargerSecrets(tenant, { force: true });

  const etatRendu = (await etatDesCles(tenant)).find((c) => c.nom === CLE);
  console.log(`\nÉtat restitué : ${etatRendu?.source}`);

  if (echecs > 0) process.exit(1);
}

main().catch(async (e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  try {
    await restituer?.();
    console.error('État des paramètres restitué malgré l’échec.');
  } catch {
    console.error(`Restitution impossible — vérifier le paramètre ${CLE}.`);
  }
  process.exit(1);
});
