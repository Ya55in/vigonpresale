import type { Database } from '@vigon/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { optionnel, requis } from './env.js';

export type ClientAdmin = SupabaseClient<Database>;

let cache: ClientAdmin | null = null;

/**
 * Client service_role partagé par le worker.
 *
 * Contourne RLS : chaque requête doit filtrer explicitement sur `tenant_id`.
 * Les policies restent une seconde barrière, jamais la seule.
 */
export function clientAdmin(): ClientAdmin {
  if (cache) return cache;

  const env = requis('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');

  cache = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  return cache;
}

let tenantCache: string | null = null;

/** Identifiant du tenant courant, résolu depuis TENANT_SLUG puis mémorisé. */
export async function tenantId(): Promise<string> {
  if (tenantCache) return tenantCache;

  const slug = optionnel('TENANT_SLUG', 'vigon');
  const { data, error } = await clientAdmin()
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .single();

  if (error || !data) {
    throw new Error(
      `Tenant « ${slug} » introuvable : ${error?.message ?? 'aucune ligne'}`,
    );
  }

  tenantCache = data.id;
  return data.id;
}

/**
 * Génère un code métier séquentiel (DM-2026-000001) via la fonction Postgres.
 *
 * La numérotation vit en base : c'est la seule façon d'éviter les collisions
 * entre le worker et l'application.
 */
export async function genererCode(prefixe: string, sequence: string): Promise<string> {
  const { data, error } = await clientAdmin().rpc('gen_code', {
    prefixe,
    seq: sequence,
  });

  if (error || !data) {
    throw new Error(`Génération de code impossible (${prefixe}) : ${error?.message}`);
  }

  return data as string;
}
