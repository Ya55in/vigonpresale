import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { cleAnonyme, urlSupabase } from '@/lib/supabase/env';
import type { Database } from '@/lib/supabase/types';

/**
 * Routes publiques (sans session requise).
 *
 * `/invitation` en fait partie : c'est elle qui pose la session à partir du
 * jeton reçu par courriel. L'exiger déjà connecté renverrait l'invité vers
 * /login, c'est-à-dire exactement là où il ne peut rien faire.
 */
// `/devis` : formulaire de réponse du fournisseur, autorisé par son jeton comme
// `/offre` l'est par le sien. Sans cette entrée, le fournisseur serait renvoyé
// vers une page de connexion pour laquelle il n'a aucun compte.
// `/validation` s'y ajoute au même titre que `/offre` et `/devis` : les trois
// s'ouvrent sur un jeton reçu par message, hors de toute session. Une route
// publique oubliée ici redirige vers la connexion, et le destinataire n'a pas
// de compte — le lien paraît cassé.
const PUBLIC_PATHS = ['/login', '/offre', '/devis', '/validation', '/invitation'];

/** Seul écran accessible tant que l'invité n'a pas choisi son mot de passe. */
const CHEMIN_MOT_DE_PASSE = '/definir-mot-de-passe';

/** Préfixes API sans authentification (webhooks, page publique). */
const PUBLIC_API_PREFIXES = ['/api/webhooks', '/api/offres/'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  if (pathname.startsWith('/api/')) {
    return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  }
  return false;
}

/**
 * Rafraîchit la session Supabase et protège les routes du dashboard.
 * La vérification fine des rôles se fait dans les layouts et Route Handlers (étape 2).
 */
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    urlSupabase(),
    cleAnonyme(),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      } satisfies CookieMethodsServer,
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/callback')) {
    return supabaseResponse;
  }

  // Une session Auth sans profil applicatif (invitation absente) doit pouvoir
  // atteindre /login : c'est la page login, qui connaît le profil, qui redirige.
  if (isPublicPath(pathname)) {
    return supabaseResponse;
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  // Invitation pas encore menée à son terme : tant que le mot de passe n'est
  // pas choisi, la session ouverte par le lien ne donne accès qu'à cet écran.
  //
  // Contrôlé ici plutôt que dans un layout : le lien du courriel ouvre une
  // session valide, et sans ce passage obligé l'invité pouvait naviguer
  // ailleurs, puis se retrouver sans aucun moyen de se reconnecter.
  //
  // Le marqueur vit dans les métadonnées Auth, que l'application maîtrise —
  // le schéma distant, lui, ne se modifie pas d'ici.
  if (
    user.user_metadata?.mot_de_passe_a_definir === true &&
    pathname !== CHEMIN_MOT_DE_PASSE
  ) {
    const url = request.nextUrl.clone();
    url.pathname = CHEMIN_MOT_DE_PASSE;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
