import { ListeNotifications } from '@/components/layout/liste-notifications';
import { requireUser } from '@/lib/auth/guards';
import { LIBELLE_ROLE } from '@/lib/auth/navigation';
import { listerNotifications } from '@/lib/notifications/requetes';

export default async function Page() {
  const utilisateur = await requireUser();
  const { notifications, nonLues } = await listerNotifications(utilisateur, {
    limite: 50,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Périmètre {LIBELLE_ROLE[utilisateur.role]}
          {nonLues > 0 && ` — ${nonLues} non lue${nonLues > 1 ? 's' : ''}`}
        </p>
      </div>

      <ListeNotifications
        notifications={notifications.map((n) => ({
          id: n.id,
          type: n.type,
          severite: n.severite ?? 'info',
          titre: n.titre,
          message: n.message,
          lien: n.lien,
          lu: n.lu ?? false,
          createdAt: n.created_at,
        }))}
        nonLues={nonLues}
      />
    </div>
  );
}
