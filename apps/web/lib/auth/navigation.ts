import type { RoleApp } from '@/lib/auth/permissions';

export type EntreeNavigation = {
  libelle: string;
  href: string;
  icone: string;
  roles: RoleApp[];
};

/**
 * Navigation latérale. `roles` reflète le périmètre décrit dans la spec ;
 * il pilote l'affichage uniquement — chaque page refait sa propre garde serveur.
 */
export const NAVIGATION: EntreeNavigation[] = [
  {
    libelle: 'Tableau de bord',
    href: '/',
    icone: 'LayoutDashboard',
    roles: ['admin', 'presale', 'finance', 'after_sales'],
  },
  {
    libelle: 'Demandes',
    href: '/demandes',
    icone: 'Inbox',
    roles: ['admin', 'presale', 'finance'],
  },
  {
    libelle: 'Opportunités',
    href: '/opportunites',
    icone: 'Target',
    roles: ['admin', 'presale'],
  },
  {
    libelle: 'Clients',
    href: '/clients',
    icone: 'Building2',
    roles: ['admin', 'presale', 'after_sales'],
  },
  {
    libelle: 'Fournisseurs',
    href: '/fournisseurs',
    icone: 'Truck',
    roles: ['admin', 'presale'],
  },
  {
    libelle: 'Offres',
    href: '/offres',
    icone: 'FileText',
    roles: ['admin', 'presale', 'finance'],
  },
  {
    libelle: 'Finance',
    href: '/finance',
    icone: 'Wallet',
    roles: ['admin', 'finance'],
  },
  {
    libelle: 'Après-vente',
    href: '/apres-vente',
    icone: 'PackageCheck',
    roles: ['admin', 'after_sales'],
  },
  {
    libelle: 'Notifications',
    href: '/notifications',
    icone: 'Bell',
    roles: ['admin', 'presale', 'finance', 'after_sales'],
  },
  {
    // FINANCE y accède pour les seuils d'escalade, dont la spec lui confie
    // la définition ; l'écran masque la gestion des comptes.
    libelle: 'Administration',
    href: '/admin',
    icone: 'Settings',
    roles: ['admin', 'finance'],
  },
];

export function navigationPourRole(role: RoleApp): EntreeNavigation[] {
  return NAVIGATION.filter((entree) => entree.roles.includes(role));
}

export const LIBELLE_ROLE: Record<RoleApp, string> = {
  admin: 'Administrateur',
  presale: 'Avant-vente',
  finance: 'Finance',
  after_sales: 'Après-vente',
};
