import { redirect } from 'next/navigation';

import { getUtilisateurCourant, type ProfilUtilisateur } from '@/lib/auth/session';
import { roleHasPermission, type RoleApp } from '@/lib/auth/permissions';

/** Erreur levée par les gardes utilisées dans les Route Handlers. */
export class ErreurAutorisation extends Error {
  constructor(
    readonly statut: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'ErreurAutorisation';
  }
}

/** Profil connecté ou redirection vers /login (pages et layouts). */
export async function requireUser(): Promise<ProfilUtilisateur> {
  const utilisateur = await getUtilisateurCourant();
  if (!utilisateur) redirect('/login');
  return utilisateur;
}

/** Profil connecté disposant de la permission, sinon redirection vers /403. */
export async function requirePermission(
  permission: string,
): Promise<ProfilUtilisateur> {
  const utilisateur = await requireUser();
  if (!roleHasPermission(utilisateur.role, permission)) redirect('/403');
  return utilisateur;
}

/** Profil connecté portant l'un des rôles attendus, sinon redirection vers /403. */
export async function requireRole(
  ...roles: RoleApp[]
): Promise<ProfilUtilisateur> {
  const utilisateur = await requireUser();
  if (!roles.includes(utilisateur.role)) redirect('/403');
  return utilisateur;
}

/**
 * Variante pour les Route Handlers et Server Actions : lève au lieu de rediriger.
 * À appeler en toute première ligne de chaque endpoint.
 */
export async function requirePermissionApi(
  permission: string,
): Promise<ProfilUtilisateur> {
  const utilisateur = await getUtilisateurCourant();
  if (!utilisateur) {
    throw new ErreurAutorisation(401, 'Authentification requise.');
  }
  if (!roleHasPermission(utilisateur.role, permission)) {
    throw new ErreurAutorisation(403, `Permission manquante : ${permission}`);
  }
  return utilisateur;
}
