import { NextResponse, type NextRequest } from 'next/server';

import { lierProfilApresConnexion } from '@/lib/auth/liaison';
import { createClient } from '@/lib/supabase/server';

/** N'accepte qu'un chemin interne : empêche une redirection ouverte. */
function cheminInterne(valeur: string | null): string {
  if (!valeur || !valeur.startsWith('/') || valeur.startsWith('//')) return '/';
  return valeur;
}

/** Callback OAuth : échange le code puis rattache le profil applicatif. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const redirectTo = cheminInterne(url.searchParams.get('redirectTo'));
  const origine = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;

  const versLogin = (erreur: string) =>
    NextResponse.redirect(new URL(`/login?erreur=${erreur}`, origine));

  if (!code) return versLogin('echange');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error('[auth] Échange du code échoué', error?.message);
    return versLogin('echange');
  }

  const liaison = await lierProfilApresConnexion(data.user);

  if (!liaison.ok) {
    // Sans profil, la session serait orpheline : on la détruit pour éviter
    // une boucle de redirection entre le dashboard et /login.
    await supabase.auth.signOut();
    return versLogin(liaison.erreur);
  }

  // Qui se connecte par Google dispose déjà d'un moyen d'accès : lui réclamer
  // un mot de passe n'a pas de sens, et le marqueur posé à l'invitation le
  // renverrait indéfiniment sur cet écran.
  if (data.user.user_metadata?.mot_de_passe_a_definir === true) {
    await supabase.auth.updateUser({
      data: { ...(data.user.user_metadata ?? {}), mot_de_passe_a_definir: false },
    });
  }

  return NextResponse.redirect(new URL(redirectTo, origine));
}
