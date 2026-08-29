'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  Building2,
  FileText,
  Inbox,
  LayoutDashboard,
  PackageCheck,
  Settings,
  Target,
  Truck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { EntreeNavigation } from '@/lib/auth/navigation';

const ICONES: Record<string, LucideIcon> = {
  LayoutDashboard,
  Bell,
  Inbox,
  Target,
  Building2,
  Truck,
  FileText,
  Wallet,
  PackageCheck,
  Settings,
};

export function Sidebar({ entrees }: { entrees: EntreeNavigation[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3">
      {entrees.map((entree) => {
        const Icone = ICONES[entree.icone] ?? LayoutDashboard;
        const actif =
          entree.href === '/'
            ? pathname === '/'
            : pathname.startsWith(entree.href);

        return (
          <Link
            key={entree.href}
            href={entree.href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              actif
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icone className="h-4 w-4" />
            {entree.libelle}
          </Link>
        );
      })}
    </nav>
  );
}
