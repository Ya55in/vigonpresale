/**
 * Crée les 4 comptes de test (un par rôle) dans le tenant courant.
 *
 * Idempotent : relancer le script ne duplique ni le compte Auth ni le profil.
 * Le mot de passe est lu depuis SEED_PASSWORD, jamais codé en dur. Sur un
 * compte Auth déjà existant, SEED_PASSWORD écrase aussi le mot de passe.
 *
 * SEED_ONLY_ROLE restreint le script à un seul rôle (admin, presale,
 * finance, after_sales) : les autres comptes ne sont pas touchés.
 *
 * Usage : SEED_PASSWORD='...' node scripts/seed-users.mjs
 *         SEED_PASSWORD='...' SEED_ONLY_ROLE=presale node scripts/seed-users.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const envPath = resolve(ROOT, 'apps/web/.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const COMPTES = [
  { role: 'admin', prenom: 'Amina', nom: 'Admin' },
  { role: 'presale', prenom: 'Karim', nom: 'Avantvente' },
  { role: 'finance', prenom: 'Sofia', nom: 'Finance' },
  { role: 'after_sales', prenom: 'Youssef', nom: 'Apresvente' },
];

async function main() {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const motDePasse = process.env.SEED_PASSWORD;
  const slug = process.env.TENANT_SLUG ?? 'vigon';
  const domaine = process.env.SEED_EMAIL_DOMAIN ?? 'vigon.test';
  const seulRole = process.env.SEED_ONLY_ROLE;

  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis.');
  if (!motDePasse || motDePasse.length < 12) {
    throw new Error('SEED_PASSWORD requis (12 caractères minimum).');
  }
  if (seulRole && !COMPTES.some((c) => c.role === seulRole)) {
    throw new Error(`SEED_ONLY_ROLE invalide : « ${seulRole} ».`);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: tenant, error: erreurTenant } = await supabase
    .from('tenants')
    .select('id, nom')
    .eq('slug', slug)
    .maybeSingle();

  if (erreurTenant) throw new Error(`Lecture du tenant : ${erreurTenant.message}`);
  if (!tenant) throw new Error(`Aucun tenant pour le slug « ${slug} ».`);

  console.log(`Tenant : ${tenant.nom} (${slug})\n`);

  const { data: listeAuth } = await supabase.auth.admin.listUsers({ perPage: 1000 });

  for (const compte of COMPTES) {
    if (seulRole && compte.role !== seulRole) continue;

    const email = `${compte.role.replace('_', '')}@${domaine}`;

    let authUser = listeAuth?.users.find(
      (u) => u.email?.toLowerCase() === email,
    );

    if (!authUser) {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: motDePasse,
        email_confirm: true,
      });
      if (error) throw new Error(`Création Auth ${email} : ${error.message}`);
      authUser = data.user;
      console.log(`  compte Auth créé   ${email}`);
    } else {
      const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
        password: motDePasse,
      });
      if (error) throw new Error(`Réinitialisation du mot de passe ${email} : ${error.message}`);
      console.log(`  compte Auth existant, mot de passe réinitialisé ${email}`);
    }

    const { data: profil } = await supabase
      .from('users')
      .select('id')
      .eq('tenant_id', tenant.id)
      .ilike('email', email)
      .maybeSingle();

    if (profil) {
      const { error } = await supabase
        .from('users')
        .update({ role: compte.role, actif: true, auth_user_id: authUser.id })
        .eq('id', profil.id);
      if (error) throw new Error(`Mise à jour profil ${email} : ${error.message}`);
      console.log(`  profil mis à jour    ${email} → ${compte.role}\n`);
    } else {
      const { error } = await supabase.from('users').insert({
        id: authUser.id,
        auth_user_id: authUser.id,
        tenant_id: tenant.id,
        email,
        nom: compte.nom,
        prenom: compte.prenom,
        role: compte.role,
        actif: true,
      });
      if (error) throw new Error(`Création profil ${email} : ${error.message}`);
      console.log(`  profil créé          ${email} → ${compte.role}\n`);
    }
  }

  console.log('Terminé. Connectez-vous avec le mot de passe fourni via SEED_PASSWORD.');
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
