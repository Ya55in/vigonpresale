import type { User } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/supabase/admin';

export type ResultatLiaison =
  | { ok: true }
  | { ok: false; erreur: 'non_autorise' | 'desactive' };

/**
 * Rattache un compte Supabase Auth à son profil applicatif.
 *
 * Modèle sur invitation : le profil `users` doit préexister avec la bonne
 * adresse e-mail. La première connexion se contente d'y inscrire auth_user_id.
 * Aucune auto-inscription — un e-mail inconnu est refusé.
 *
 * Appelé par les deux chemins de connexion (mot de passe et OAuth).
 */
export async function lierProfilApresConnexion(
  authUser: User,
): Promise<ResultatLiaison> {
  const email = authUser.email?.toLowerCase();
  if (!email) return { ok: false, erreur: 'non_autorise' };

  const admin = createAdminClient();
  const maintenant = new Date().toISOString();

  const { data: dejaLie } = await admin
    .from('users')
    .select('id, actif')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  if (dejaLie) {
    if (!dejaLie.actif) return { ok: false, erreur: 'desactive' };
    await admin
      .from('users')
      .update({ derniere_connexion: maintenant })
      .eq('id', dejaLie.id);
    return { ok: true };
  }

  const slug = process.env.TENANT_SLUG ?? 'vigon';
  const { data: tenant } = await admin
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (!tenant) {
    console.error('[auth] Tenant introuvable pour le slug', slug);
    return { ok: false, erreur: 'non_autorise' };
  }

  const { data: invite } = await admin
    .from('users')
    .select('id, actif, auth_user_id, nom, prenom, avatar_url')
    .eq('tenant_id', tenant.id)
    .ilike('email', email)
    .maybeSingle();

  // Pas d'invitation, ou invitation déjà consommée par un autre compte Auth.
  if (!invite || (invite.auth_user_id && invite.auth_user_id !== authUser.id)) {
    return { ok: false, erreur: 'non_autorise' };
  }

  if (!invite.actif) return { ok: false, erreur: 'desactive' };

  const metadata = authUser.user_metadata ?? {};
  const { error } = await admin
    .from('users')
    .update({
      auth_user_id: authUser.id,
      derniere_connexion: maintenant,
      nom: invite.nom ?? (metadata.family_name as string | undefined) ?? null,
      prenom: invite.prenom ?? (metadata.given_name as string | undefined) ?? null,
      avatar_url:
        invite.avatar_url ?? (metadata.avatar_url as string | undefined) ?? null,
    })
    .eq('id', invite.id);

  if (error) {
    console.error('[auth] Liaison du profil échouée', error.message);
    return { ok: false, erreur: 'non_autorise' };
  }

  return { ok: true };
}
