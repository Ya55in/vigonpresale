/**
 * Éprouve la chaîne de secours entre fournisseurs IA.
 *
 * La panne de Groq du 2026-08-19 a arrêté l'extraction : un seul fournisseur,
 * aucun repli. La chaîne existe pour que cela ne se reproduise pas — encore
 * faut-il qu'elle bascule vraiment, ce qu'aucun test ne prouvait.
 *
 * Les fournisseurs sont simulés : aucun appel réseau, aucune clé consommée.
 * C'est le comportement de la CHAÎNE qu'on vérifie, pas celui des API.
 *
 * Usage : npm run essai:ia-secours
 */
import { z } from 'zod';

import { chargerEnv } from './charger-env.js';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

async function main(): Promise<void> {
  chargerEnv();

  const { genererJson, genererTexte, ErreurIA, ErreurQuotaIA, chaineFournisseurs } =
    await import('@vigon/services');
  type FournisseurIA = import('@vigon/services').FournisseurIA;

  const schema = z.object({ ok: z.boolean() });

  /** Fournisseur simulé : répond, tombe en panne, ou épuise son quota. */
  function faux(
    nom: string,
    comportement: 'repond' | 'panne' | 'quota',
    journal: string[],
  ): FournisseurIA {
    return {
      nom,
      modeleUtilise: () => `${nom}-modele`,
      estConfigure: () => true,
      async completer() {
        journal.push(nom);
        if (comportement === 'panne') throw new Error(`${nom} injoignable`);
        if (comportement === 'quota') throw new Error(`${nom} 429 rate limit per day`);
        return '{"ok": true}';
      },
      analyserErreur: (e: unknown) => {
        const m = e instanceof Error ? e.message : String(e);
        const quota = /429|rate limit/i.test(m);
        return { quota, permanent: quota && /per day/i.test(m), delaiMs: 1 };
      },
    };
  }

  /* --- 1. Le principal répond : personne d'autre n'est sollicité ---------- */

  console.log('\n=== Le principal répond ===');
  {
    const journal: string[] = [];
    const chaine = [faux('principal', 'repond', journal), faux('secours', 'repond', journal)];

    const r = await genererJson('essai', schema, { chaine, tentatives: 1 });

    verifier('sortie obtenue', r.ok === true);
    verifier('le secours n’est PAS appelé', !journal.includes('secours'), journal.join(' → '));
  }

  /* --- 2. Le principal tombe : le secours prend le relais ----------------- */

  console.log('\n=== Le principal tombe ===');
  {
    const journal: string[] = [];
    const chaine = [faux('principal', 'panne', journal), faux('secours', 'repond', journal)];

    const r = await genererJson('essai', schema, { chaine, tentatives: 1 });

    verifier('la plateforme ne tombe pas', r.ok === true);
    verifier('le secours a bien traité', journal.join(' → ') === 'principal → secours', journal.join(' → '));
  }

  /* --- 3. Quota épuisé : c'est aussi un cas de bascule -------------------- */

  console.log('\n=== Quota du principal épuisé ===');
  {
    const journal: string[] = [];
    const chaine = [faux('principal', 'quota', journal), faux('secours', 'repond', journal)];

    const r = await genererJson('essai', schema, { chaine, tentatives: 1 });

    // Un quota « permanent » arrêtait tout avant : insister sur ce fournisseur
    // ne sert à rien, mais changer de fournisseur, si.
    verifier('un quota épuisé bascule au lieu de bloquer', r.ok === true, journal.join(' → '));
  }

  /* --- 4. Toute la chaîne tombe : l'erreur reste exploitable -------------- */

  console.log('\n=== Toute la chaîne tombe ===');
  {
    const journal: string[] = [];
    const chaine = [faux('principal', 'quota', journal), faux('secours', 'quota', journal)];

    let erreur: unknown = null;
    try {
      await genererJson('essai', schema, { chaine, tentatives: 1 });
    } catch (e) {
      erreur = e;
    }

    verifier('une erreur est levée', erreur instanceof ErreurIA);
    // Le type compte : sur quota, le worker laisse la demande récupérable et la
    // reprendra. Une ErreurIA générique la ferait passer en « bloquee ».
    verifier(
      'le quota est conservé comme tel',
      erreur instanceof ErreurQuotaIA,
      erreur instanceof Error ? erreur.name : '—',
    );
    verifier('les deux ont été essayés', journal.join(' → ') === 'principal → secours');
  }

  /* --- 5. Le texte libre suit la même chaîne ------------------------------ */

  console.log('\n=== Génération de texte ===');
  {
    const journal: string[] = [];
    const chaine = [faux('principal', 'panne', journal), faux('secours', 'repond', journal)];

    const texte = await genererTexte('essai', { chaine });

    verifier('le texte est produit par le secours', texte.includes('ok'), journal.join(' → '));
  }

  /* --- 6. Un fournisseur imposé n'est jamais contourné -------------------- */

  console.log('\n=== Fournisseur imposé ===');
  {
    const journal: string[] = [];
    let erreur: unknown = null;
    try {
      await genererJson('essai', schema, {
        fournisseur: faux('impose', 'panne', journal),
        tentatives: 1,
      });
    } catch (e) {
      erreur = e;
    }

    // Un appelant qui nomme son fournisseur a une raison : lui en substituer un
    // autre trahirait sa demande, même pour « sauver » l'appel.
    verifier('aucun secours ne se substitue', Boolean(erreur) && journal.join('') === 'impose');
  }

  /* --- 7. La chaîne réelle, telle qu'elle est configurée ------------------ */

  console.log('\n=== Configuration effective ===');
  {
    // Les clés gérées vivent en base : sans ce chargement, la chaîne ne
    // refléterait que l'environnement et paraîtrait dépourvue de secours.
    const { assurerChaine, chargerSecrets, tenantId } = await import('@vigon/services');
    await chargerSecrets(await tenantId(), { force: true });

    // Les clés chargées ne suffisent pas : la chaîne s'en DÉDUIT, et cette
    // déduction n'a lieu qu'ici ou au premier appel de génération. Sans elle,
    // `chaineFournisseurs()` retombe sur l'ancien `AI_PROVIDER` et cet essai
    // jugeait une configuration que plus rien n'utilise.
    await assurerChaine();

    const reelle = chaineFournisseurs();
    console.log(`  chaîne : ${reelle.map((f) => f.nom).join(' → ')}`);

    verifier(
      'au moins un secours est configuré',
      reelle.length > 1,
      reelle.length > 1 ? `${reelle.length - 1} secours` : '⚠ AUCUN — une panne arrête la plateforme',
    );
  }

  console.log(
    `\n${echecs === 0 ? '✓ La chaîne de secours bascule comme prévu.' : `✗ ${echecs} ÉCHEC(S).`}\n`,
  );

  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
