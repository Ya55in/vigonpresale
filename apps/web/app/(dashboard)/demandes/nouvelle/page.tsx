import { redirect } from 'next/navigation';

import { FormulaireDemande } from '@/components/demandes/formulaire-demande';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';

export const metadata = { title: 'Nouvelle demande' };

export default async function NouvelleDemandePage() {
  const utilisateur = await requireUser();

  // Garde serveur : FINANCE voit les demandes mais ne les crée pas. L'absence
  // du bouton dans la liste ne suffit pas, l'URL est devinable.
  if (!roleHasPermission(utilisateur.role, 'demande.creer')) redirect('/403');

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Nouvelle demande
        </h1>
        <p className="text-sm text-muted-foreground">
          Pour une opportunité ouverte hors messagerie — appel, réunion, salon.
          Les articles saisis ici ne passent pas par l&apos;extraction
          automatique.
        </p>
      </div>

      <FormulaireDemande />
    </div>
  );
}
