import { NextResponse, type NextRequest } from 'next/server';

import { lierProfilApresConnexion } from '@/lib/auth/liaison';
import { createClient } from '@/lib/supabase/server';

/**
 * Ouverture d'une invitation : vérifie le jeton puis conduit au choix du mot de passe.
 *
 * Route dédiée plutôt que le lien Supabase par défaut, pour deux raisons.
 *
 * D'abord la destination : le lien standard renvoie vers `/callback?redirectTo=…`,
 * donc une query imbriquée dans le paramètre `redirect_to`. Supabase y ajoute
 * les siens, le `redirectTo` se perdait, et l'invité atterrissait sur le
 * tableau de bord sans jamais voir l'écran de mot de passe. Ici la destination
 * est en dur : il n'y a rien à perdre.
 *
 * Ensuite le transport du jeton : le flux `recovery` place ses jetons dans le
 * FRAGMENT de l'URL, que le navigateur n'envoie jamais au serveur. On utilise
 * donc `verifyOtp` avec le jeton haché passé en query — vérifié côté serveur,
 * la session étant posée en cookie.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') ?? 'recovery';
  const origine = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;

  const versLogin = (erreur: string) =>
    NextResponse.redirect(new URL(`/login?erreur=${erreur}`, origine));

  if (!tokenHash) return versLogin('echange');

  const supabase = await createClient();

  const { data, error } = await supabase.auth.verifyOtp({
    type: type === 'invite' ? 'invite' : 'recovery',
    token_hash: tokenHash,
  });

  if (error || !data.user) {
    console.error('[auth] Invitation invalide ou expirée', error?.message);
    return versLogin('invitation');
  }

  const liaison = await lierProfilApresConnexion(data.user);

  if (!liaison.ok) {
    // Sans profil applicatif la session serait orpheline : on la détruit pour
    // éviter une boucle entre le dashboard et /login.
    await supabase.auth.signOut();
    return versLogin(liaison.erreur);
  }

  return NextResponse.redirect(new URL('/definir-mot-de-passe', origine));
}
