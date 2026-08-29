/**
 * Vérifie que le fournisseur IA actif tient le vrai prompt d'extraction
 * des spécifications, sur une demande client représentative.
 *
 * Sert à comparer deux fournisseurs sur pièce plutôt que sur intuition :
 *   AI_PROVIDER=groq   npm run essai:extraction
 *   AI_PROVIDER=gemini npm run essai:extraction
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { specificationsSchema } from '@vigon/shared';
import {
  descriptionIA,
  genererJson,
  promptSpecifications,
  tenantId,
} from '@vigon/services';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function chargerEnv(): void {
  const chemin = resolve(ROOT, 'apps/web/.env.local');
  if (!existsSync(chemin)) return;
  for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
    const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m?.[1] && !process.env[m[1]]) process.env[m[1]] = (m[2] ?? '').trim();
  }
}

/** Demande de référence : marques implicites, unités variées, date en JJ/MM. */
const DEMANDE = `
Bonjour,

Dans le cadre de l'équipement de notre nouvelle salle serveur à Casablanca,
merci de nous faire parvenir votre meilleure offre pour :

- 3 switchs administrables PoE+ 48 ports, réf C9200L-48P-4G-E, stackables
- Deux onduleurs Smart-UPS 3000VA rackables
- 5 x écran 27 pouces P2723DE
- 1 barre de visioconférence Rally Bar pour la salle de réunion

Livraison souhaitée avant le 15/08/2026.

Cordialement,
Dr. Karim Bennani — Clinique Al Amal
karim.bennani@clinique-alamal.ma
`;

/** Marque attendue pour chaque référence, déduite par le modèle. */
const MARQUES_ATTENDUES: Record<string, string> = {
  'C9200L-48P-4G-E': 'Cisco',
  'Smart-UPS': 'APC',
  P2723DE: 'Dell',
  'Rally Bar': 'Logitech',
};

async function main(): Promise<void> {
  chargerEnv();
  console.log(`Fournisseur : ${descriptionIA()}\n`);

  const debut = Date.now();
  const r = await genererJson(
    await promptSpecifications(await tenantId(), DEMANDE),
    specificationsSchema,
    { tentatives: 2 },
  );
  const duree = ((Date.now() - debut) / 1000).toFixed(1);

  console.log(`client    : ${r.client.nom ?? '—'} | ${r.client.email ?? '—'}`);
  console.log(`titre     : ${r.titre_projet}`);
  console.log(`deadline  : ${r.deadline_souhaitee ?? '—'}`);
  console.log(`articles  : ${r.articles.length} (attendu 4) en ${duree}s\n`);

  for (const a of r.articles) {
    console.log(`  ${a.ligne_num}. [${a.marque}] ${a.designation}`);
    console.log(
      `     réf=${a.reference ?? '—'} qté=${a.quantite} ${a.unite} conf=${a.confiance}`,
    );
  }

  const anomalies: string[] = [];
  if (r.articles.length !== 4) {
    anomalies.push(`${r.articles.length} article(s) au lieu de 4`);
  }
  if (r.deadline_souhaitee !== '2026-08-15') {
    anomalies.push(`deadline « ${r.deadline_souhaitee} » au lieu de 2026-08-15`);
  }

  for (const [indice, marque] of Object.entries(MARQUES_ATTENDUES)) {
    const ligne = r.articles.find(
      (a) =>
        a.reference?.includes(indice) ||
        a.designation.toLowerCase().includes(indice.toLowerCase()),
    );
    if (!ligne) {
      anomalies.push(`ligne « ${indice} » absente`);
    } else if (!ligne.marque.toLowerCase().includes(marque.toLowerCase())) {
      anomalies.push(`« ${indice} » → marque ${ligne.marque}, attendu ${marque}`);
    }
  }

  // Anonymisation : le nom du client ne doit jamais fuiter côté fournisseur,
  // mais il DOIT être extrait ici — c'est la fiche demande, pas le RFQ.
  console.log(
    anomalies.length === 0
      ? '\n✓ Extraction conforme.'
      : `\n! ${anomalies.length} anomalie(s) :\n  - ${anomalies.join('\n  - ')}`,
  );

  process.exit(anomalies.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('✗', e instanceof Error ? e.message : e);
  process.exit(1);
});
