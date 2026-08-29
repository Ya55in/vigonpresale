'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

type Onglet = { libelle: string; segment: string };

/**
 * Onglets de la fiche demande.
 *
 * Chaque onglet est une route à part entière : le rechargement d'une page
 * conserve l'onglet, et chaque écran refait sa propre garde serveur.
 */
export function OngletsDemande({
  demandeId,
  onglets,
}: {
  demandeId: number;
  onglets: Onglet[];
}) {
  const pathname = usePathname();
  const base = `/demandes/${demandeId}`;

  return (
    <nav className="flex gap-1 overflow-x-auto border-b" aria-label="Sections de la demande">
      {onglets.map((onglet) => {
        const href = onglet.segment ? `${base}/${onglet.segment}` : base;
        const actif = onglet.segment
          ? pathname.startsWith(href)
          : pathname === base;

        return (
          <Link
            key={onglet.segment || 'apercu'}
            href={href}
            aria-current={actif ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              actif
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground',
            )}
          >
            {onglet.libelle}
          </Link>
        );
      })}
    </nav>
  );
}
