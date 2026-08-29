/**
 * Contrôle le cycle complet d'un prompt : défaut -> retouche -> rétablissement.
 *
 * Écrit réellement dans `parametres`, puis nettoie derrière lui — y compris en
 * cas d'échec, sinon un essai interrompu laisserait un prompt retouché actif.
 *
 * Usage : npm run essai:gabarits
 */
import {
  GABARITS,
  cleGabarit,
  clientAdmin,
  invaliderCacheGabarits,
  lireGabarit,
  lireTousGabarits,
  tenantId,
  validerGabarit,
} from '@vigon/services';

import { chargerEnv } from './charger-env.js';
import { preserverParametres } from './preserver-parametres.js';

/** Code d'essai : le sourcing n'est pas dans le chemin critique de la réception. */
const CODE = 'sourcing_fournisseur' as const;

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

async function nettoyer(tenant: string): Promise<void> {
  await clientAdmin()
    .from('parametres')
    .delete()
    .eq('tenant_id', tenant)
    .eq('cle', cleGabarit(CODE));
  invaliderCacheGabarits();
}

async function main(): Promise<void> {
  chargerEnv();

  const db = clientAdmin();
  const tenant = await tenantId();

  // AVANT toute écriture : ce harnais supprimait la ligne du gabarit dès son
  // départ, emportant une retouche que l'utilisateur aurait faite dans /admin.
  // Le prompt du flux serait revenu au défaut du code sans que rien ne le dise.
  // Même faute qu'essai:whatsapp le 2026-08-20, sur une autre clé.
  const restituer = await preserverParametres(tenant, [cleGabarit(CODE)]);

  // Un essai précédent interrompu laisserait une ligne : on part au propre.
  await nettoyer(tenant);

  try {
    // --- 1. Sans ligne en base, le défaut du code s'applique ---
    const initial = await lireGabarit(tenant, CODE);
    verifier('sans ligne en base -> défaut du code', initial === GABARITS[CODE].defaut);

    const avant = await lireTousGabarits(tenant);
    verifier(
      'non signalé comme personnalisé',
      avant.find((g) => g.code === CODE)?.personnalise === false,
    );

    // --- 2. Une retouche valide est reprise ---
    const retouche = GABARITS[CODE].defaut.replace(
      'RÈGLES :',
      'RÈGLES (retouche automatisée) :',
    );
    verifier('la retouche passe la validation', validerGabarit(CODE, retouche).ok);

    const { error } = await db.from('parametres').insert({
      tenant_id: tenant,
      cle: cleGabarit(CODE),
      valeur: retouche,
      type_valeur: 'texte',
      categorie: 'prompt',
      description: GABARITS[CODE].libelle,
    });
    if (error) throw new Error(`Écriture impossible : ${error.message}`);

    invaliderCacheGabarits();

    const apres = await lireGabarit(tenant, CODE);
    verifier('la retouche est bien relue', apres === retouche);
    verifier(
      'signalé comme personnalisé',
      (await lireTousGabarits(tenant)).find((g) => g.code === CODE)?.personnalise === true,
    );

    // --- 3. Le cache empêche-t-il de voir un changement ? ---
    // Sans invalidation, la valeur doit rester celle du cache : c'est le
    // comportement attendu, borné à 60 s.
    await db
      .from('parametres')
      .update({ valeur: `${retouche}\n(seconde retouche)` })
      .eq('tenant_id', tenant)
      .eq('cle', cleGabarit(CODE));

    const sansInvalidation = await lireGabarit(tenant, CODE);
    verifier('sans invalidation -> valeur en cache conservée', sansInvalidation === apres);

    invaliderCacheGabarits();
    const avecInvalidation = await lireGabarit(tenant, CODE);
    verifier(
      'après invalidation -> nouvelle valeur',
      avecInvalidation.endsWith('(seconde retouche)'),
    );

    // --- 4. Rétablissement ---
    await nettoyer(tenant);

    const retabli = await lireGabarit(tenant, CODE);
    verifier('après suppression -> défaut du code', retabli === GABARITS[CODE].defaut);
    verifier(
      'plus signalé comme personnalisé',
      (await lireTousGabarits(tenant)).find((g) => g.code === CODE)?.personnalise === false,
    );
  } finally {
    // Même en cas d'échec : ne jamais laisser le prompt du harnais en base, et
    // rendre la retouche qui s'y trouvait avant.
    await nettoyer(tenant);
    await restituer();
    invaliderCacheGabarits();
  }

  console.log(`\n${echecs === 0 ? '✓ Cycle conforme, état restitué.' : `✗ ${echecs} échec(s).`}\n`);
  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
