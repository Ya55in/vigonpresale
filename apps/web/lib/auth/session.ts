import { cache } from 'react';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/lib/supabase/types';

export type ProfilUtilisateur = Tables<'users'>;

/**
 * Profil applicatif de l'utilisateur connecté, ou null.
 *
 * La lecture passe par le client service role : les policies RLS de `users`
 * s'appuient sur current_tenant_id(), lui-même alimenté par `users`, ce qui
 * rendrait la lecture du profil récursive. Le filtre auth_user_id ci-dessous
 * est donc la barrière effective — il vient de la session vérifiée, pas du client.
 */
export const getUtilisateurCourant = cache(
  async (): Promise<ProfilUtilisateur | null> => {
    const supabase = await createClient();
    const {
      data: { user },
      error: erreurAuth,
    } = await supabase.auth.getUser();

    /*
     * Une panne réseau vers Supabase renvoie aussi user = null : sans log, la
     * déconnexion apparente qui en découle est indiagnosticable.
     *
     * Mais « Auth session missing! » n'est PAS une panne : c'est la réponse
     * normale à une visite sans session, sur /login ou sur une page publique.
     * La journaliser en erreur remplissait la console à chaque visite anonyme,
     * et l'indicateur de développement de Next la comptait comme un incident —
     * ce qui noie les vraies pannes dans un bruit permanent.
     */
    if (erreurAuth) {
      const absente = /session missing|session_not_found/i.test(erreurAuth.message);

      if (absente) console.info('[auth] Aucune session (visiteur anonyme).');
      else console.error('[auth] Vérification de session échouée', erreurAuth.message);

      return null;
    }

    if (!user) return null;

    const { data, error } = await createAdminClient()
      .from('users')
      .select('*')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[auth] Lecture du profil échouée', {
        auth_user_id: user.id,
        message: error.message,
      });
      return null;
    }

    if (!data || !data.actif) return null;

    return data;
  },
);
