import Link from 'next/link';

import { ClocheNotifications } from '@/components/layout/cloche-notifications';
import { APP_NAME } from '@vigon/shared';

import { LogoVigon } from '@/components/marque/logo-vigon';
import { Sidebar } from '@/components/layout/sidebar';
import { UserMenu } from '@/components/layout/user-menu';
import { requireUser } from '@/lib/auth/guards';
import { LIBELLE_ROLE, navigationPourRole } from '@/lib/auth/navigation';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const utilisateur = await requireUser();

  const nomComplet =
    [utilisateur.prenom, utilisateur.nom].filter(Boolean).join(' ') ||
    utilisateur.email;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-muted/30 md:block">
        <div className="flex h-14 items-center border-b px-5">
          <Link href="/" aria-label={APP_NAME}>
            <LogoVigon largeur={124} priority />
          </Link>
        </div>
        <Sidebar entrees={navigationPourRole(utilisateur.role)} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b px-5">
          <Link href="/" aria-label={APP_NAME} className="md:hidden">
            <LogoVigon largeur={104} />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ClocheNotifications />
            <UserMenu
              nomComplet={nomComplet}
              email={utilisateur.email}
              libelleRole={LIBELLE_ROLE[utilisateur.role]}
              avatarUrl={utilisateur.avatar_url}
            />
          </div>
        </header>

        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
