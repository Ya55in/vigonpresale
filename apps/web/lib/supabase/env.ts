/**
 * Variables Supabase, lues avec un message d'erreur qui dit quoi faire.
 *
 * Elles étaient lues en `process.env.NEXT_PUBLIC_SUPABASE_URL!` — une assertion
 * TypeScript, qui fait taire le compilateur et ne vaut RIEN à l'exécution.
 * Absentes, elles arrivaient donc `undefined` jusque dans `@supabase/ssr`, qui
 * répondait « Your project's URL and Key are required to create a Supabase
 * client! » en pleine page, sans dire laquelle manquait ni où la poser.
 *
 * C'est arrivé au premier déploiement Netlify : le build passe — rien n'échoue,
 * puisque `undefined` est une valeur valide à la compilation — et l'application
 * ne s'affiche qu'une fois en ligne.
 *
 * LE PIÈGE À CONNAÎTRE : les variables `NEXT_PUBLIC_*` sont **inlinées dans le
 * bundle au moment du build**, pas lues à l'exécution. Les ajouter à
 * l'hébergeur après coup ne change rien tant qu'un NOUVEAU build n'a pas eu
 * lieu — rejouer le déploiement d'un artefact déjà construit ne suffit pas.
 */

function lire(nom: string): string {
  // L'accès doit être écrit en toutes lettres : Next remplace `process.env.X`
  // par sa valeur à la compilation, et ne saurait pas quoi faire d'un accès
  // calculé comme `process.env[nom]`.
  const valeurs: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  const valeur = valeurs[nom]?.trim();

  if (!valeur) {
    throw new Error(
      `${nom} est absente. Cette variable est inlinée dans le bundle AU BUILD : ` +
        `la poser chez l'hébergeur ne suffit pas, il faut relancer un build complet. ` +
        `Valeurs attendues : tableau de bord Supabase > Settings > API.`,
    );
  }

  return valeur;
}

export const urlSupabase = (): string => lire('NEXT_PUBLIC_SUPABASE_URL');
export const cleAnonyme = (): string => lire('NEXT_PUBLIC_SUPABASE_ANON_KEY');
