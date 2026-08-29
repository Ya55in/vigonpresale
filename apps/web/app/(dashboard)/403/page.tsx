import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { requireUser } from '@/lib/auth/guards';
import { LIBELLE_ROLE } from '@/lib/auth/navigation';

export default async function AccesRefusePage() {
  const utilisateur = await requireUser();

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <ShieldAlert className="h-10 w-10 text-destructive" />
      <h1 className="text-2xl font-semibold tracking-tight">Accès refusé</h1>
      <p className="text-muted-foreground">
        Votre rôle ({LIBELLE_ROLE[utilisateur.role]}) ne donne pas accès à cette
        section. Contactez un administrateur si vous pensez qu&apos;il s&apos;agit
        d&apos;une erreur.
      </p>
      <Button asChild>
        <Link href="/">Retour au tableau de bord</Link>
      </Button>
    </div>
  );
}
