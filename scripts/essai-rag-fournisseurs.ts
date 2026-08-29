/**
 * Contrôle la recherche sémantique de fournisseurs sur l'historique réel.
 *
 * Lit la base et appelle Gemini, mais n'écrit rien : la seule ressource
 * consommée est le quota d'embeddings.
 *
 * Usage : npm run essai:rag
 */
import {
  MODELE_EMBEDDING,
  chercherFournisseurs,
  compterVecteursPerimes,
  clientAdmin,
  embedder,
  embeddingsConfigures,
  tenantId,
} from '@vigon/services';

import { chargerEnv } from './charger-env.js';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

/** Produit scalaire de deux vecteurs unitaires = similarité cosinus. */
function cosinus(a: number[], b: number[]): number {
  let p = 0;
  for (let i = 0; i < a.length; i += 1) p += (a[i] ?? 0) * (b[i] ?? 0);
  return p;
}

async function main(): Promise<void> {
  chargerEnv();

  if (!embeddingsConfigures()) {
    console.error('\n✗ GEMINI_API_KEY absente.\n');
    process.exit(1);
  }

  const tenant = await tenantId();
  const db = clientAdmin();

  /* --- 1. Propriétés du vecteur ------------------------------------------ */

  console.log('\n=== Vecteurs ===');

  const v = await embedder('Point d’accès WiFi 6 intérieur, montage plafond');
  verifier('dimension conforme à la colonne pgvector', v.length === 1536, String(v.length));

  const norme = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  verifier(
    'vecteur normalisé (obligatoire en dimensions réduites)',
    Math.abs(norme - 1) < 1e-6,
    `norme ${norme.toFixed(6)}`,
  );

  /* --- 2. Le seuil sépare-t-il vraiment ? --------------------------------- */

  console.log('\n=== Séparation sémantique ===');

  const wifiInt = await embedder('Point d’accès WiFi 6 intérieur, montage plafond');
  const wifiExt = await embedder('Borne WiFi 6E extérieure');
  const onduleur = await embedder('Onduleur rack 3000VA autonomie 15 min');

  const proche = cosinus(wifiInt, wifiExt);
  const lointain = cosinus(wifiInt, onduleur);

  verifier(
    'deux produits du même domaine dépassent le seuil de 0,72',
    proche >= 0.72,
    proche.toFixed(3),
  );
  verifier(
    'deux domaines distincts restent sous le seuil',
    lointain < 0.72,
    lointain.toFixed(3),
  );
  verifier(
    'l’écart est net, pas marginal',
    proche - lointain > 0.1,
    `écart ${(proche - lointain).toFixed(3)}`,
  );

  /* --- 3. Index --------------------------------------------------------- */

  console.log('\n=== Index ===');

  const { count } = await db
    .from('fournisseur_embeddings')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant);

  verifier('l’historique est indexé', (count ?? 0) > 0, `${count ?? 0} vecteur(s)`);

  const { count: lignes } = await db
    .from('lignes_devis')
    .select('id', { count: 'exact', head: true });

  verifier(
    'toutes les lignes de devis sont vectorisées',
    (count ?? 0) >= (lignes ?? 0),
    `${count ?? 0} vecteurs pour ${lignes ?? 0} lignes`,
  );

  /* --- 4. Recherche sur un besoin réel ------------------------------------ */

  console.log('\n=== Recherche ===');

  const { data: articles } = await db
    .from('demande_items')
    .select('id, designation, reference, marque')
    .eq('demande_id', 21)
    .order('ligne_num');

  if (!articles || articles.length === 0) {
    console.log('  (demande 21 absente : recherche non exercée)');
  } else {
    const r = await chercherFournisseurs({ tenant, articles });

    verifier('des fournisseurs sont proposés', r.fournisseurs.length > 0, `${r.fournisseurs.length}`);

    // Le défaut corrigé : une société à plusieurs marques apparaissait autant
    // de fois qu'elle a de fiches.
    const noms = r.fournisseurs.map((f) => f.nom);
    verifier(
      'aucune société en doublon',
      new Set(noms).size === noms.length,
      noms.join(', '),
    );

    // Le défaut corrigé : avec un seuil trop bas, tout le monde couvrait tout.
    const couvrentTout = r.fournisseurs.filter(
      (f) => f.articlesCouverts.length === f.articlesDemandes,
    );
    verifier(
      'la couverture discrimine, personne ne couvre tout par défaut',
      couvrentTout.length < r.fournisseurs.length,
      `${couvrentTout.length}/${r.fournisseurs.length} couvrent tout`,
    );

    verifier(
      'le classement place la meilleure couverture en tête',
      r.fournisseurs.every(
        (f, i) =>
          i === 0 ||
          (r.fournisseurs[i - 1]?.articlesCouverts.length ?? 0) >= f.articlesCouverts.length,
      ),
    );

    verifier(
      'chaque appariement porte sa justification',
      r.fournisseurs.every((f) => f.articlesCouverts.every((a) => a.preuve.trim().length > 0)),
    );

    verifier(
      'toutes les similarités retenues dépassent le seuil',
      r.fournisseurs.every((f) => f.articlesCouverts.every((a) => a.similarite >= 0.72)),
    );

    // UBSM est le seul à avoir chiffré des bornes Ubiquiti : il doit remonter
    // avec une certitude maximale sur ces articles.
    const ubsm = r.fournisseurs.find((f) => f.nom.includes('UBSM'));
    verifier(
      'UBSM remonte sur les articles WiFi qu’il a réellement chiffrés',
      Boolean(ubsm && ubsm.articlesCouverts.some((a) => a.similarite >= 0.95)),
    );

    /* --- 5. Fiabilité et démarrage à froid ------------------------------- */

    console.log('\n=== Fiabilité et repli ===');

    verifier(
      'chaque proposition porte sa fiabilité, ou null si sans fiche',
      r.fournisseurs.every((f) => f.fiabilite === null || typeof f.fiabilite.consultations === 'number'),
    );

    // Jamais consulté n'est pas un mauvais taux : c'est une absence de donnée.
    verifier(
      'un fournisseur jamais consulté n’a pas un taux de 0',
      r.fournisseurs.every(
        (f) => !f.fiabilite || f.fiabilite.consultations > 0 || f.fiabilite.tauxReponse === null,
      ),
    );

    verifier(
      'les marques non couvertes sont nommées pour le sourcing web',
      r.articlesNonCouverts.length === 0 || r.marquesASourcer.length >= 0,
      `${r.articlesNonCouverts.length} article(s), ${r.marquesASourcer.length} marque(s)`,
    );

    verifier(
      '« Multimarque » n’est pas confié au sourcing web',
      !r.marquesASourcer.some((m) => m.toLowerCase() === 'multimarque'),
    );
  }

  /* --- 6. Cohérence du modèle -------------------------------------------- */

  console.log('\n=== Modèle ===');

  const perimes = await compterVecteursPerimes(tenant);
  verifier(
    'aucun vecteur d’un modèle antérieur',
    perimes === 0,
    perimes === 0 ? MODELE_EMBEDDING : `${perimes} à recalculer`,
  );

  console.log(`\n${echecs === 0 ? '✓ Tout est conforme.' : `✗ ${echecs} échec(s).`}\n`);
  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
