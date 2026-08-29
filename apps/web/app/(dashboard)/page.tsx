import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requireUser } from '@/lib/auth/guards';
import { LIBELLE_ROLE } from '@/lib/auth/navigation';
import type { RoleApp } from '@/lib/auth/permissions';
import { kpiPourRole, type Kpi } from '@/lib/dashboard/kpi';
import { formaterDateHeure } from '@/lib/demandes/statuts';
import { listerNotifications } from '@/lib/notifications/requetes';
import { cn } from '@/lib/utils';

const ACCROCHE: Record<RoleApp, string> = {
  admin: 'Vous avez accès à toutes les branches de la plateforme.',
  presale:
    'Traitez les demandes clients, consultez les fournisseurs et préparez les offres.',
  finance: 'Validez les feuilles de coûts escaladées et suivez la rentabilité.',
  after_sales: 'Suivez les deals gagnés, les livraisons et la satisfaction client.',
};

export default async function DashboardPage() {
  const utilisateur = await requireUser();
  const prenom = utilisateur.prenom ?? utilisateur.email;

  const [kpi, { notifications }] = await Promise.all([
    kpiPourRole(utilisateur),
    listerNotifications(utilisateur, { limite: 5, seulementNonLues: true }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Bonjour {prenom}</h1>
        <p className="text-muted-foreground">
          {LIBELLE_ROLE[utilisateur.role]} — {ACCROCHE[utilisateur.role]}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpi.map((indicateur) => (
          <CarteKpi key={indicateur.libelle} indicateur={indicateur} />
        ))}
      </section>

      {notifications.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">À votre attention</h2>
            <Link href="/notifications" className="text-sm text-primary hover:underline">
              Tout voir
            </Link>
          </div>

          <ul className="divide-y rounded-lg border">
            {notifications.map((notification) => (
              <li key={notification.id} className="flex items-start gap-3 p-3">
                {notification.severite === 'avertissement' && (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{notification.titre}</p>
                  {notification.message && (
                    <p className="truncate text-sm text-muted-foreground">
                      {notification.message}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formaterDateHeure(notification.created_at)}
                  </p>
                </div>
                {notification.lien && (
                  <Link
                    href={notification.lien}
                    className="shrink-0 text-sm text-primary hover:underline"
                  >
                    Ouvrir
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

    </div>
  );
}

function CarteKpi({ indicateur }: { indicateur: Kpi }) {
  const contenu = (
    <Card
      className={cn(
        'h-full',
        indicateur.alerte && 'border-amber-500/50 bg-amber-500/5',
        indicateur.lien && 'transition-colors hover:border-primary',
      )}
    >
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wide">
          {indicateur.libelle}
        </CardDescription>
        <CardTitle className="text-3xl tabular-nums">{indicateur.valeur}</CardTitle>
      </CardHeader>
      {indicateur.detail && (
        <CardContent>
          <p className="text-xs text-muted-foreground">{indicateur.detail}</p>
        </CardContent>
      )}
    </Card>
  );

  return indicateur.lien ? <Link href={indicateur.lien}>{contenu}</Link> : contenu;
}
