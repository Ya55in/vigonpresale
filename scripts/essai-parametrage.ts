/**
 * Contrôle les fonctions pures du paramétrage : gabarits, langues, relances.
 *
 * Ne touche ni la base ni la boîte mail — tout ce qui est vérifié ici est
 * déterministe. Les chemins qui lisent `parametres` sont exercés par
 * l'application elle-même, pas par ce script.
 *
 * Usage : npm run essai:parametrage
 */
import {
  LANGUES,
  LIBELLES_LANGUE,
  langueDepuisPays,
  type Langue,
} from '@vigon/shared';
import {
  GABARITS,
  CODES_GABARIT,
  appliquerGabarit,
  buildRelanceHtml,
  validerGabarit,
} from '@vigon/services';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  const marque = condition ? '  ok  ' : ' ÉCHEC';
  console.log(`${marque}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

/* --- 1. Les gabarits livrés sont valides selon leur propre contrat --------- */

console.log('\n=== Gabarits par défaut ===');

for (const code of CODES_GABARIT) {
  const resultat = validerGabarit(code, GABARITS[code].defaut);
  verifier(
    GABARITS[code].libelle,
    resultat.ok,
    resultat.ok ? '' : resultat.motif,
  );
}

/* --- 2. La validation refuse ce qui casserait un job ---------------------- */

console.log('\n=== Refus attendus ===');

const sansContenu = GABARITS.specifications.defaut.replace('{{contenu}}', '');
const r1 = validerGabarit('specifications', sansContenu);
verifier(
  'variable obligatoire retirée -> refusé',
  !r1.ok,
  r1.ok ? 'accepté à tort' : r1.motif,
);

const r2 = validerGabarit('specifications', 'trop court {{contenu}}');
verifier('prompt trop court -> refusé', !r2.ok);

const avecInconnue = `${GABARITS.classification.defaut}\n{{inexistante}}`;
const r3 = validerGabarit('classification', avecInconnue);
verifier(
  'variable inconnue -> refusé',
  !r3.ok,
  r3.ok ? 'accepté à tort' : r3.motif,
);

/* --- 3. Substitution ------------------------------------------------------ */

console.log('\n=== Substitution ===');

const rendu = appliquerGabarit('Marque {{marque}} / {{articles}} / {{marque}}', {
  marque: 'Cisco',
  articles: '- 3 x Switch',
});
verifier(
  'toutes les occurrences remplacées',
  rendu === 'Marque Cisco / - 3 x Switch / Cisco',
  rendu,
);

const avecVide = appliquerGabarit('a{{absente}}b', {});
verifier(
  'variable sans valeur -> chaîne vide, pas de {{}} résiduel',
  avecVide === 'ab',
  avecVide,
);

/* --- 4. Déduction de la langue depuis le pays ----------------------------- */

console.log('\n=== Langue déduite du pays ===');

const attendus: [string | null, Langue][] = [
  ['Maroc', 'fr'],
  ['France', 'fr'],
  ['Allemagne', 'de'],
  ['Germany', 'de'],
  ['España', 'es'],
  ['Italie', 'it'],
  ['Émirats arabes unis', 'ar'],
  ['United States', 'en'],
  ['United Kingdom', 'en'],
  [null, 'fr'],
  ['Pays inconnu', 'fr'],
];

for (const [pays, attendu] of attendus) {
  const obtenu = langueDepuisPays(pays);
  verifier(
    `${pays ?? '(aucun)'} -> ${attendu}`,
    obtenu === attendu,
    obtenu === attendu ? '' : `obtenu ${obtenu}`,
  );
}

/* --- 5. Relances traduites ------------------------------------------------ */

console.log('\n=== Relances par langue ===');

const sujet = 'Demande de devis - Équipements réseau';

for (const langue of LANGUES) {
  const html = buildRelanceHtml({ numero: 1, sujetOrigine: sujet, langue });

  const balise = html.includes(`<html lang="${langue}"`);
  const rtlAttendu = langue === 'ar';
  const rtlPresent = html.includes('dir="rtl"');

  verifier(
    `${LIBELLES_LANGUE[langue]} : lang + sens de lecture`,
    balise && rtlPresent === rtlAttendu,
    balise ? '' : 'attribut lang absent',
  );
}

// Deux langues différentes ne doivent pas produire le même corps : ce serait le
// signe d'une traduction non appliquée.
const fr = buildRelanceHtml({ numero: 1, sujetOrigine: sujet, langue: 'fr' });
const en = buildRelanceHtml({ numero: 1, sujetOrigine: sujet, langue: 'en' });
verifier('français et anglais produisent des corps distincts', fr !== en);

// Le sujet vient de la base : il doit rester échappé dans toutes les langues.
const injection = buildRelanceHtml({
  numero: 1,
  sujetOrigine: '<img src=x onerror="alert(1)">',
  langue: 'ar',
});
verifier(
  'sujet échappé y compris en arabe',
  !injection.includes('<img src=x') && injection.includes('&lt;img'),
);

// Sans langue, le comportement d'avant doit être inchangé.
const parDefaut = buildRelanceHtml({ numero: 1, sujetOrigine: sujet });
verifier('absence de langue -> français', parDefaut === fr);

/* --- Bilan ---------------------------------------------------------------- */

console.log(`\n${echecs === 0 ? '✓ Tout est conforme.' : `✗ ${echecs} échec(s).`}\n`);
if (echecs > 0) process.exit(1);
