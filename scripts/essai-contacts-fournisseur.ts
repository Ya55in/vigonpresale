/**
 * Contrôle la résolution des destinataires d'une consultation.
 *
 * Fonctions pures : ne touche ni la base ni la boîte mail.
 *
 * L'enjeu principal n'est pas la nouveauté mais la NON-RÉGRESSION — un
 * fournisseur sans contact déclaré doit recevoir exactement le message d'avant,
 * à la même adresse, sans copie.
 *
 * Usage : npm run essai:contacts
 */
import {
  initialesSuggerees,
  resoudreDestinataires,
  type ContactFournisseur,
} from '@vigon/services';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

const contact = (
  id: number,
  email: string,
  principal = false,
): ContactFournisseur => ({
  id,
  fournisseurId: 1,
  nom: null,
  email,
  telephone: null,
  fonction: null,
  principal,
});

/* --- 1. Non-régression : aucun contact déclaré ---------------------------- */

console.log('\n=== Non-régression (le cas de tous les fournisseurs actuels) ===');

const sansContact = resoudreDestinataires('fiche@fournisseur.ma', []);

verifier(
  'destinataire inchangé',
  sansContact.a === 'fiche@fournisseur.ma',
  sansContact.a,
);
verifier(
  'aucune copie ajoutée — message identique à avant',
  sansContact.cc.length === 0,
  `${sansContact.cc.length} copie(s)`,
);

/* --- 2. Contacts secondaires --------------------------------------------- */

console.log('\n=== Contacts sans principal désigné ===');

const secondaires = resoudreDestinataires('fiche@fournisseur.ma', [
  contact(1, 'devis@fournisseur.ma'),
  contact(2, 'technique@fournisseur.ma'),
]);

verifier(
  "l'adresse de la fiche reste le destinataire",
  secondaires.a === 'fiche@fournisseur.ma',
  secondaires.a,
);
verifier(
  'les deux contacts passent en copie',
  secondaires.cc.length === 2 &&
    secondaires.cc.includes('devis@fournisseur.ma') &&
    secondaires.cc.includes('technique@fournisseur.ma'),
  secondaires.cc.join(', '),
);

/* --- 3. Contact principal ------------------------------------------------ */

console.log('\n=== Contact principal désigné ===');

const avecPrincipal = resoudreDestinataires('fiche@fournisseur.ma', [
  contact(1, 'devis@fournisseur.ma'),
  contact(2, 'commercial@fournisseur.ma', true),
]);

verifier(
  'le principal devient le destinataire',
  avecPrincipal.a === 'commercial@fournisseur.ma',
  avecPrincipal.a,
);

// L'adresse générale est souvent la seule réellement relevée : la perdre ferait
// disparaître des réponses.
verifier(
  "l'adresse de la fiche n'est jamais perdue, elle passe en copie",
  avecPrincipal.cc.includes('fiche@fournisseur.ma'),
  avecPrincipal.cc.join(', '),
);

/* --- 4. Doublons --------------------------------------------------------- */

console.log('\n=== Doublons ===');

const doublons = resoudreDestinataires('fiche@fournisseur.ma', [
  contact(1, 'fiche@fournisseur.ma'),
  contact(2, 'FICHE@Fournisseur.MA'),
  contact(3, '  fiche@fournisseur.ma  '),
]);

verifier(
  'une même adresse n’est jamais en To et en Cc',
  !doublons.cc.some((e) => e.trim().toLowerCase() === doublons.a.trim().toLowerCase()),
  `To=${doublons.a} Cc=[${doublons.cc.join(', ')}]`,
);
verifier(
  'casse et espaces ne créent pas de doublon',
  doublons.cc.length === 0,
  `${doublons.cc.length} copie(s)`,
);

/* --- 5. Initiales suggérées ---------------------------------------------- */

console.log('\n=== Initiales suggérées ===');

const attendus: [string, string][] = [
  ['Medina Networks', 'MN'],
  ['Atlas Distribution', 'AD'],
  ['UBSM', 'UBS'],
  ['Pure Solutions', 'PS'],
  ['Société Générale de Distribution Informatique', 'SGDI'],
  ['Tech-Nord', 'TN'],
];

for (const [nom, attendu] of attendus) {
  const obtenu = initialesSuggerees(nom);
  verifier(`${nom} → ${attendu}`, obtenu === attendu, obtenu === attendu ? '' : obtenu);
}

verifier('nom vide → chaîne vide, jamais d’erreur', initialesSuggerees('') === '');

// Deux sociétés distinctes peuvent produire les mêmes initiales : c'est
// précisément pourquoi la suggestion n'est jamais appliquée d'office.
verifier(
  'collision possible entre deux noms — la suggestion reste une proposition',
  initialesSuggerees('Medina Networks') === initialesSuggerees('Maroc Numérique'),
  'MN pour les deux',
);

/* --- Bilan ---------------------------------------------------------------- */

console.log(`\n${echecs === 0 ? '✓ Tout est conforme.' : `✗ ${echecs} échec(s).`}\n`);
if (echecs > 0) process.exit(1);
