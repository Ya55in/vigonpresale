/**
 * Contrôle les parties déterministes du comparatif et de la relance client.
 *
 * Ne touche ni la base ni la boîte mail. Les chemins qui lisent `parametres`
 * ou envoient un courriel sont exercés par l'application et le worker.
 *
 * Usage : npm run essai:comparatif
 */
import { DEFAUTS_METIER, devisSchema } from '@vigon/shared';
import {
  GABARITS,
  buildRelanceClientHtml,
  sujetRelanceClient,
  validerGabarit,
} from '@vigon/services';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

/* --- 1. La garantie traverse le schéma d'extraction ----------------------- */

console.log('\n=== Extraction de la garantie ===');

const avecGarantie = devisSchema.parse({
  devise: 'MAD',
  garantie: '  24 mois retour atelier  ',
  lignes: [{ designation: 'Switch 48 ports', quantite: 2, prix_achat_ht: 4200 }],
});
verifier(
  'garantie reprise et détourée',
  avecGarantie.garantie === '24 mois retour atelier',
  String(avecGarantie.garantie),
);

const sansGarantie = devisSchema.parse({ devise: 'MAD', lignes: [] });
verifier('garantie absente -> null', sansGarantie.garantie === null);

const garantieVide = devisSchema.parse({ devise: 'MAD', garantie: '   ', lignes: [] });
verifier(
  'garantie vide -> null, jamais chaîne blanche',
  garantieVide.garantie === null,
);

// Le gabarit doit annoncer le champ, sans quoi le modèle ne le remplira pas.
verifier(
  'le gabarit d’extraction décrit "garantie"',
  GABARITS.extraction_devis.defaut.includes('"garantie"'),
);
verifier(
  'le gabarit reste valide après retouche',
  validerGabarit('extraction_devis', GABARITS.extraction_devis.defaut).ok,
);

/* --- 2. Objet de la relance selon l'échéance ------------------------------ */

console.log('\n=== Objet de la relance client ===');

const cas: [number, string][] = [
  [3, 'Votre offre PR-2026-000005-V01 expire dans 3 jours'],
  [1, 'Votre offre PR-2026-000005-V01 expire demain'],
  [0, 'Dernier jour — offre PR-2026-000005-V01'],
  [-1, 'Dernier jour — offre PR-2026-000005-V01'],
];

for (const [jours, attendu] of cas) {
  const obtenu = sujetRelanceClient({ reference: 'PR-2026-000005-V01', joursRestants: jours });
  verifier(`${jours} jour(s) restant(s)`, obtenu === attendu, obtenu);
}

/* --- 3. Corps de la relance ----------------------------------------------- */

console.log('\n=== Corps de la relance ===');

const base = {
  titreOffre: 'Infrastructure réseau',
  reference: 'PR-2026-000005-V01',
  lienPublic: 'https://exemple.test/offre/jeton',
  dateExpiration: '14/08/2026',
};

const consultee = buildRelanceClientHtml({ ...base, joursRestants: 3, jamaisConsultee: false });
const jamaisVue = buildRelanceClientHtml({ ...base, joursRestants: 3, jamaisConsultee: true });

verifier('le lien public figure dans le message', consultee.includes(base.lienPublic));
verifier("l'échéance est annoncée", consultee.includes('14/08/2026'));
verifier(
  'un client qui a ouvert et un qui n’a pas ouvert reçoivent des textes distincts',
  consultee !== jamaisVue,
);
verifier(
  'jamais consultée -> on ne prétend pas qu’il a étudié l’offre',
  jamaisVue.includes('bien parvenue'),
);

// Le titre vient de la base : il doit rester échappé.
const injection = buildRelanceClientHtml({
  ...base,
  titreOffre: '<img src=x onerror="alert(1)">',
  joursRestants: 2,
  jamaisConsultee: false,
});
verifier(
  'titre échappé',
  !injection.includes('<img src=x') && injection.includes('&lt;img'),
);

// Rien d'interne ne doit fuiter vers le client.
for (const interdit of ['marge', 'prix d’achat', 'fournisseur']) {
  verifier(
    `aucune mention « ${interdit} »`,
    !consultee.toLowerCase().includes(interdit.toLowerCase()),
  );
}

/* --- 4. Défaut du délai de relance ---------------------------------------- */

console.log('\n=== Paramètre de relance ===');

verifier(
  'délai par défaut strictement avant expiration',
  DEFAUTS_METIER.delaiRelanceClientJours > 0 &&
    DEFAUTS_METIER.delaiRelanceClientJours < DEFAUTS_METIER.delaiExpirationOffreJours,
  `${DEFAUTS_METIER.delaiRelanceClientJours} j avant échéance de ${DEFAUTS_METIER.delaiExpirationOffreJours} j`,
);

/* --- Bilan ---------------------------------------------------------------- */

console.log(`\n${echecs === 0 ? '✓ Tout est conforme.' : `✗ ${echecs} échec(s).`}\n`);
if (echecs > 0) process.exit(1);
