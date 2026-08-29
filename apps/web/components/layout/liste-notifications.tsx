'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { BellOff, Check, CheckCheck, Loader2 } from 'lucide-react';

import {
  marquerLue,
  toutMarquerLu,
} from '@/app/(dashboard)/notifications/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formaterDateHeure } from '@/lib/demandes/statuts';
import { cn } from '@/lib/utils';

export type NotificationAffichee = {
  id: number;
  type: string;
  severite: string;
  titre: string;
  message: string | null;
  lien: string | null;
  lu: boolean;
  createdAt: string | null;
};

export function ListeNotifications({
  notifications,
  nonLues,
}: {
  notifications: NotificationAffichee[];
  nonLues: number;
}) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);

  async function marquer(id: number): Promise<void> {
    setEnCours(`lue-${id}`);
    const fd = new FormData();
    fd.set('id', String(id));
    await marquerLue(null, fd);
    setEnCours(null);
    router.refresh();
  }

  async function toutMarquer(): Promise<void> {
    setEnCours('toutes');
    await toutMarquerLu();
    setEnCours(null);
    router.refresh();
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
        <BellOff className="size-8 text-muted-foreground" />
        <p className="font-medium">Aucune notification</p>
        <p className="text-sm text-muted-foreground">
          Les événements du flux avant-vente apparaîtront ici.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {nonLues > 0 && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={enCours !== null}
            onClick={() => void toutMarquer()}
          >
            {enCours === 'toutes' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCheck className="size-4" />
            )}
            Tout marquer comme lu
          </Button>
        </div>
      )}

      <ul className="divide-y rounded-lg border">
        {notifications.map((notification) => (
          <li
            key={notification.id}
            className={cn(
              'flex flex-wrap items-start gap-3 p-3',
              !notification.lu && 'bg-primary/5',
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {!notification.lu && (
                  <span
                    aria-label="Non lue"
                    className="size-1.5 shrink-0 rounded-full bg-primary"
                  />
                )}
                {notification.titre}
                {notification.severite === 'avertissement' && (
                  <Badge variant="attention">à traiter</Badge>
                )}
              </p>
              {notification.message && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {notification.message}
                </p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {formaterDateHeure(notification.createdAt)}
              </p>
            </div>

            <div className="flex shrink-0 gap-1">
              {notification.lien && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={notification.lien}>Ouvrir</Link>
                </Button>
              )}
              {!notification.lu && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`Marquer « ${notification.titre} » comme lue`}
                  disabled={enCours !== null}
                  onClick={() => void marquer(notification.id)}
                >
                  {enCours === `lue-${notification.id}` ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
