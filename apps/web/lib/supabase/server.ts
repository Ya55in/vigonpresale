import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { cleAnonyme, urlSupabase } from '@/lib/supabase/env';
import type { Database } from '@/lib/supabase/types';

/**
 * Client Supabase côté serveur (Route Handlers, Server Components, Actions).
 * Respecte la session via les cookies Next.js.
 *
 * ASYNCHRONE depuis Next 16 : `cookies()` y rend une Promise. Le codemod
 * officiel avait posé un `UnsafeUnwrappedCookies` — un contournement de
 * transition que Next 16 ne fournit même plus. L'attendre pour de bon est plus
 * court et plus honnête que de le contourner.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    urlSupabase(),
    cleAnonyme(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // setAll peut échouer dans un Server Component en lecture seule — ignoré si middleware gère la session
          }
        },
      } satisfies CookieMethodsServer,
    },
  );
}
