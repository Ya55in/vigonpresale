import { createAdminClient } from '@/lib/supabase/admin';
import type { ProfilUtilisateur } from '@/lib/auth/session';
import type { Tables } from '@/lib/supabase/types';

export type Notification = Pick<
  Tables<'notifications'>,
  'id' | 'type' | 'severite' | 'titre' | 'message' | 'lien' | 'lu' | 'created_at'
>;

/**
 * Notifications destinées à l'utilisateur.
 *
 * Une notification cible soit un utilisateur précis (`user_id`), soit un rôle
 * (`role_cible`). ADMIN voit en plus celles de tous les rôles : la spec lui
 * donne accès à toutes les branches, il doit donc voir ce qui remonte partout.
 */
export async function listerNotifications(
  utilisateur: ProfilUtilisateur,
  options: { limite?: number; seulementNonLues?: boolean } = {},
): Promise<{ notifications: Notification[]; nonLues: number }> {
  const db = createAdminClient();

  const champs =
    'id, type, severite, titre, message, lien, lu, created_at';

  let requete = db
    .from('notifications')
    .select(champs)
    .eq('tenant_id', utilisateur.tenant_id);

  if (utilisateur.role !== 'admin') {
    requete = requete.or(
      `user_id.eq.${utilisateur.id},role_cible.eq.${utilisateur.role}`,
    );
  }

  if (options.seulementNonLues) requete = requete.eq('lu', false);

  const { data, error } = await requete
    .order('created_at', { ascending: false })
    .limit(options.limite ?? 30);

  if (error) {
    console.error('[notifications] lecture impossible', error.message);
    return { notifications: [], nonLues: 0 };
  }

  // Le compteur porte sur l'ensemble, pas seulement sur la page lue.
  let compteur = db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', utilisateur.tenant_id)
    .eq('lu', false);

  if (utilisateur.role !== 'admin') {
    compteur = compteur.or(
      `user_id.eq.${utilisateur.id},role_cible.eq.${utilisateur.role}`,
    );
  }

  const { count } = await compteur;

  return { notifications: data ?? [], nonLues: count ?? 0 };
}
