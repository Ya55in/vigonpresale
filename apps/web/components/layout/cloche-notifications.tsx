import Link from 'next/link';
import { Bell } from 'lucide-react';

import { requireUser } from '@/lib/auth/guards';
import { listerNotifications } from '@/lib/notifications/requetes';

/**
 * Compteur de notifications non lues, dans l'en-tête.
 *
 * Composant serveur : le compteur est recalculé au rendu de chaque page, ce qui
 * évite un appel client périodique pour une information qui change rarement.
 */
export async function ClocheNotifications() {
  const utilisateur = await requireUser();
  const { nonLues } = await listerNotifications(utilisateur, {
    limite: 1,
    seulementNonLues: true,
  });

  return (
    <Link
      href="/notifications"
      aria-label={
        nonLues > 0
          ? `Notifications — ${nonLues} non lue${nonLues > 1 ? 's' : ''}`
          : 'Notifications'
      }
      className="relative inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Bell className="size-5" />
      {nonLues > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground">
          {nonLues > 99 ? '99+' : nonLues}
        </span>
      )}
    </Link>
  );
}
