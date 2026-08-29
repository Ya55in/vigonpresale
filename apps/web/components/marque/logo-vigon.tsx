import Image from 'next/image';

import { APP_NAME } from '@vigon/shared';
import { cn } from '@/lib/utils';

/**
 * Logo Vigon Systems.
 *
 * Un seul composant pour toute l'application : la marque ne doit pas être
 * recomposée à la main d'un écran à l'autre. Le fichier source est le même
 * visuel que celui embarqué dans les offres PDF (`public/marque/`).
 *
 * `priority` sur les usages au-dessus de la ligne de flottaison (connexion,
 * barre latérale) : le logo y est le premier repère visuel, un chargement
 * différé ferait sauter la mise en page.
 */
export function LogoVigon({
  largeur = 150,
  className,
  priority = false,
}: {
  largeur?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/marque/vigon-logo.png"
      alt={APP_NAME}
      width={largeur}
      // Ratio du fichier source (520 × 167).
      height={Math.round((largeur * 167) / 520)}
      priority={priority}
      className={cn('h-auto', className)}
    />
  );
}
