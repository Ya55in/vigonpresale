/**
 * Contrôle le schéma de la réponse fournisseur saisie en ligne.
 *
 * Ne touche ni la base ni la boîte mail : tout est déterministe. Le chemin
 * complet (jeton, création du devis) est exercé par l'application.
 *
 * Usage : npm run essai:reponse-fournisseur
 */
import {
  LANGUES,
  reponseFournisseurSchema,
  validerReponse,
  sourceOuDefaut,
  SOURCES_DEMANDE,
} from '@vigon/shared';
import { buildRfqHtml } from '@vigon/services';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

const conditions = {
  delaiLivraison: '12 jours ouvrés',
  conditionsPaiement: '30 jours net',
  garantie: '36 mois sur site',
  validiteOffre: '45 jours',
  numeroDevis: 'MN-2026-0042',
};

/* --- 1. Saisie nominale --------------------------------------------------- */

console.log('\n=== Saisie du fournisseur ===');

const nominale = reponseFournisseurSchema.safeParse({
  lignes: [
    // Virgule décimale et espaces : c'est ainsi qu'on tape un prix en France.
    { demandeItemId: 38, chiffree: true, prixUnitaireHt: '4 250,50', remisePct: '10', disponibilite: 'En stock' },
    { demandeItemId: 39, chiffree: true, prixUnitaireHt: '18900', remisePct: 0, disponibilite: '' },
    // Ligne décochée : le formulaire la poste quand même, champ vide.
    { demandeItemId: 40, chiffree: false, prixUnitaireHt: '', remisePct: 0, disponibilite: '' },
  ],
  ...conditions,
});

verifier(
  'saisie nominale acceptée',
  nominale.success,
  nominale.success ? '' : nominale.error.issues[0]?.message,
);

if (nominale.success) {
  verifier(
    'virgule décimale et espaces convertis',
    nominale.data.lignes[0]?.prixUnitaireHt === 4250.5,
    String(nominale.data.lignes[0]?.prixUnitaireHt),
  );
  verifier(
    'ligne décochée : prix vide -> non renseigné, pas invalide',
    nominale.data.lignes[2]?.prixUnitaireHt === undefined,
  );
  verifier(
    'disponibilité vide -> null, jamais chaîne blanche',
    nominale.data.lignes[1]?.disponibilite === null,
  );
  verifier('les quatre conditions traversent', validerReponse(nominale.data) === null);
  verifier('garantie conservée', nominale.data.garantie === '36 mois sur site');
}

/* --- 2. Refus attendus ---------------------------------------------------- */

console.log('\n=== Refus attendus ===');

const cocheeSansPrix = reponseFournisseurSchema.parse({
  lignes: [{ demandeItemId: 1, chiffree: true, prixUnitaireHt: '', remisePct: 0 }],
  ...conditions,
});
verifier(
  'article coché sans prix -> refusé',
  validerReponse(cocheeSansPrix) !== null,
  validerReponse(cocheeSansPrix) ?? 'accepté à tort',
);

const rienDeCoche = reponseFournisseurSchema.parse({
  lignes: [{ demandeItemId: 1, chiffree: false, prixUnitaireHt: '', remisePct: 0 }],
  ...conditions,
});
verifier('aucune ligne cochée -> refusé', validerReponse(rienDeCoche) !== null);

const prixNegatif = reponseFournisseurSchema.safeParse({
  lignes: [{ demandeItemId: 1, chiffree: true, prixUnitaireHt: '-500', remisePct: 0 }],
  ...conditions,
});
verifier('prix négatif -> refusé', !prixNegatif.success);

const remiseAberrante = reponseFournisseurSchema.safeParse({
  lignes: [{ demandeItemId: 1, chiffree: true, prixUnitaireHt: '100', remisePct: 150 }],
  ...conditions,
});
verifier('remise supérieure à 100 % -> refusée', !remiseAberrante.success);

const sansLigne = reponseFournisseurSchema.safeParse({ lignes: [], ...conditions });
verifier('aucune ligne du tout -> refusé', !sansLigne.success);

/* --- 3. Lien du formulaire dans la RFQ ------------------------------------ */

console.log('\n=== Lien dans la demande de devis ===');

const rfq = {
  sujet: 'Demande de devis',
  intro: 'Bonjour,',
  transition: 'Merci de nous chiffrer :',
  articles: ['3 x Switch 48 ports'],
  questions_intro: 'Merci de préciser :',
  questions: ['Délai'],
  cloture: 'Cordialement,',
};

const lien = 'https://exemple.test/devis/jeton-de-test';

for (const langue of LANGUES) {
  const html = buildRfqHtml(rfq, { langue, lienFormulaire: lien });
  verifier(`${langue} : le lien figure et le bouton est traduit`, html.includes(lien));
}

const sansLien = buildRfqHtml(rfq, { langue: 'fr' });
verifier(
  'sans jeton -> aucun bouton, comportement d’avant inchangé',
  !sansLien.includes('/devis/'),
);

// Le lien vient de la base : il doit rester échappé.
const injection = buildRfqHtml(rfq, {
  langue: 'fr',
  lienFormulaire: 'https://x.test/"><script>alert(1)</script>',
});
verifier(
  'lien échappé',
  !injection.includes('<script>alert(1)') && injection.includes('&lt;script&gt;'),
);

/* --- 4. Sources de demande ------------------------------------------------ */

console.log('\n=== Sources de demande ===');

verifier('les trois portes d’entrée sont déclarées', SOURCES_DEMANDE.length === 3);
verifier('valeur inconnue -> repli sur email', sourceOuDefaut('portail') === 'email');
verifier('valeur nulle -> repli sur email', sourceOuDefaut(null) === 'email');
verifier('cps reconnue', sourceOuDefaut('cps') === 'cps');

/* --- Bilan ---------------------------------------------------------------- */

console.log(`\n${echecs === 0 ? '✓ Tout est conforme.' : `✗ ${echecs} échec(s).`}\n`);
if (echecs > 0) process.exit(1);
