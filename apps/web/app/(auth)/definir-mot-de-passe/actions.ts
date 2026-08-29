'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { createClient } from '@/lib/supabase/server';

export type Resultat = { ok: boolean; message: string };

/**
 * Longueur minimale. Volontairement au-dessus des 6 caractères de Supabase :
 * ces comptes ouvrent l'accès aux prix d'achat et aux marges.
 */
const LONGUEUR_MIN = 12;

const schema = z
  .object({
    motDePasse: z
      .string()
      .min(LONGUEUR_MIN, `Le mot de passe doit faire au moins ${LONGUEUR_MIN} caractères.`)
      .max(200),
    confirmation: z.string(),
  })
  .refine((v) => v.motDePasse === v.confirmation, {
    message: 'Les deux saisies ne correspondent pas.',
    path: ['confirmation'],
  });

/**
 * Enregistre le mot de passe choisi par l'invité.
 *
 * La session vient du lien à usage unique reçu par courriel : sans elle,
 * `updateUser` échoue côté Supabase. On ne fait donc pas confiance à un
 * paramètre d'URL pour désigner le compte à modifier.
 */
export async function definirMotDePasse(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  const parse = schema.safeParse(Object.fromEntries(donnees));
  if (!parse.success) {
    return { ok: false, message: parse.error.issues[0]?.message ?? 'Saisie invalide.' };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      message: "Lien expiré ou déjà utilisé. Demandez une nouvelle invitation.",
    };
  }

  // Le mot de passe et la levée du marqueur dans le même appel : deux appels
  // séparés laisseraient une fenêtre où le mot de passe existe mais où le
  // middleware ramène encore ici, donc une boucle.
  const { error } = await supabase.auth.updateUser({
    password: parse.data.motDePasse,
    data: { ...(user.user_metadata ?? {}), mot_de_passe_a_definir: false },
  });

  if (error) return { ok: false, message: error.message };

  redirect('/');
}
