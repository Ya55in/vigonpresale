import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/supabase/types';

/**
 * Client Supabase service role — uniquement côté serveur (API, workers via import partagé).
 * Contourne RLS : toujours filtrer explicitement sur tenant_id en application.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Variables NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requises pour le client admin.',
    );
  }

  return createClient<Database>(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      /*
       * Next 14 met en cache les `fetch` par défaut, et supabase-js passe par
       * fetch : sans `no-store`, une lecture est figée au premier appel et
       * l'application continue de servir un état périmé — un statut d'offre
       * dépassé, une marge d'avant modification. `dynamic = 'force-dynamic'`
       * ne suffit pas : il rend la route dynamique, pas les fetchs qu'elle fait.
       *
       * `AbortSignal.timeout` borne l'attente : sans lui, une requête qui
       * n'aboutit pas laisse le rendu serveur pendant indéfiniment, et
       * l'utilisateur regarde une page qui ne vient jamais plutôt qu'un message
       * d'erreur. Vingt secondes laissent passer les lectures lourdes du
       * comparatif tout en libérant le rendu bien avant qu'on croie l'appli
       * plantée. Un `signal` déjà fourni par l'appelant reste prioritaire.
       */
      fetch: (entree, init) =>
        fetch(entree, {
          ...init,
          cache: 'no-store',
          signal: init?.signal ?? AbortSignal.timeout(20_000),
        }),
    },
  });
}
