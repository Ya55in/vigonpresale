'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { lierProfilApresConnexion } from '@/lib/auth/liaison';
import { createClient } from '@/lib/supabase/server';

import { urlApplication } from '@vigon/shared';

const schemaConnexion = z.object({
  email: z.string().email('Adresse e-mail invalide.'),
  motDePasse: z.string().min(1, 'Mot de passe requis.'),
  redirectTo: z.string().optional(),
});

export type EtatConnexion = { erreur?: string };

/** N'accepte qu'un chemin interne : empêche une redirection ouverte via ?redirectTo=. */
function cheminInterne(valeur: string | undefined): string {
  if (!valeur || !valeur.startsWith('/') || valeur.startsWith('//')) return '/';
  return valeur;
}

export async function connexionMotDePasse(
  _etat: EtatConnexion,
  formData: FormData,
): Promise<EtatConnexion> {
  const parse = schemaConnexion.safeParse({
    email: formData.get('email'),
    motDePasse: formData.get('motDePasse'),
    redirectTo: formData.get('redirectTo') ?? undefined,
  });

  if (!parse.success) {
    return { erreur: parse.error.issues[0]?.message ?? 'Formulaire invalide.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parse.data.email,
    password: parse.data.motDePasse,
  });

  if (error || !data.user) {
    // Message volontairement générique : ne pas révéler si l'e-mail existe.
    return { erreur: 'Identifiants incorrects.' };
  }

  const liaison = await lierProfilApresConnexion(data.user);

  if (!liaison.ok) {
    // Sans profil, la session serait orpheline : on la détruit pour éviter
    // une boucle de redirection entre le dashboard et /login.
    await supabase.auth.signOut();
    return {
      erreur:
        liaison.erreur === 'desactive'
          ? 'Ce compte est désactivé. Contactez un administrateur.'
          : "Ce compte n'est rattaché à aucun utilisateur Vigon. Contactez un administrateur.",
    };
  }

  redirect(cheminInterne(parse.data.redirectTo));
}

export async function connexionGoogle(formData: FormData): Promise<void> {
  const redirectTo = cheminInterne(
    (formData.get('redirectTo') as string | null) ?? undefined,
  );
  const origine = urlApplication();

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origine}/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
    },
  });

  if (error || !data.url) {
    redirect('/login?erreur=oauth');
  }

  redirect(data.url);
}

export async function deconnexion(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
