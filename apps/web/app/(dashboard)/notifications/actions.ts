'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat = { ok: boolean; message?: string };

export async function marquerLue(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  const utilisateur = await requireUser();

  const parse = z
    .object({ id: z.coerce.number().int().positive() })
    .safeParse(Object.fromEntries(donnees));

  if (!parse.success) return { ok: false, message: 'Données invalides.' };

  const db = createAdminClient();

  const requete = db
    .from('notifications')
    .update({ lu: true, lu_at: new Date().toISOString() })
    .eq('id', parse.data.id)
    .eq('tenant_id', utilisateur.tenant_id);

  // Sans ce filtre, un identifiant forgé marquerait comme lue la notification
  // d'un autre rôle et la ferait disparaître de son centre.
  const { error } = await (utilisateur.role === 'admin'
    ? requete
    : requete.or(
        `user_id.eq.${utilisateur.id},role_cible.eq.${utilisateur.role}`,
      ));

  if (error) return { ok: false, message: error.message };

  revalidatePath('/notifications');
  revalidatePath('/');
  return { ok: true };
}

export async function toutMarquerLu(): Promise<Resultat> {
  const utilisateur = await requireUser();
  const db = createAdminClient();

  const requete = db
    .from('notifications')
    .update({ lu: true, lu_at: new Date().toISOString() })
    .eq('tenant_id', utilisateur.tenant_id)
    .eq('lu', false);

  const { error } = await (utilisateur.role === 'admin'
    ? requete
    : requete.or(
        `user_id.eq.${utilisateur.id},role_cible.eq.${utilisateur.role}`,
      ));

  if (error) return { ok: false, message: error.message };

  revalidatePath('/notifications');
  revalidatePath('/');
  return { ok: true };
}
