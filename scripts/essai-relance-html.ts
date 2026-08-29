/**
 * Contrôle le rendu déterministe des relances et l'échappement du sujet.
 *
 * Usage : npm run essai:relance-html
 */
import { buildRelanceHtml } from '@vigon/services';

const sujet = 'Demande de devis - Équipements réseau Cisco';

for (const numero of [1, 2, 3]) {
  const html = buildRelanceHtml({ numero, sujetOrigine: sujet });
  const texte = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  console.log(`--- relance ${numero} ---`);
  console.log(texte.slice(0, 230));
  console.log(`  gabarit déterministe : ${html.startsWith('<!DOCTYPE html>') ? 'oui' : 'NON'}\n`);
}

// Le sujet provient de la base : il doit être échappé, jamais injecté brut.
const injection = buildRelanceHtml({
  numero: 1,
  sujetOrigine: '<img src=x onerror="alert(1)">',
});

console.log('=== Échappement du sujet ===');
const brut = injection.includes('<img src=x');
console.log(`  balise brute présente   : ${brut ? 'OUI (FAILLE)' : 'non'}`);
console.log(`  version échappée        : ${injection.includes('&lt;img') ? 'oui' : 'NON'}`);

if (brut) process.exit(1);
