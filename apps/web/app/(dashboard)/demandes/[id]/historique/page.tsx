import { notFound, redirect } from 'next/navigation';

import { ChronologieAffaire } from '@/components/demandes/chronologie';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { lireDemande } from '@/lib/demandes/requetes';
import { lireStoryline } from '@/lib/documents/storyline';

/**
 * Historique d'une affaire.
 *
 * La garde est refaite ici alors que le layout la porte déjà : chaque onglet
 * est une route à part entière, et un écran qui compterait sur le contrôle d'un
 * parent deviendrait ouvert le jour où l'arborescence bouge.
 *
 * `lireDemande` filtre le locataire et le périmètre du rôle ; `lireStoryline`
 * refiltre sur `tenant_id`. Deux fois plutôt qu'une, parce que la seconde lit
 * par la clé service role, qui contourne le RLS.
 */
export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const utilisateur = await requireUser();

  const autorise =
    roleHasPermission(utilisateur.role, 'demande.voir') ||
    roleHasPermission(utilisateur.role, 'demande.voir_gagnees');
  if (!autorise) redirect('/403');

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const demande = await lireDemande(utilisateur, id);
  if (!demande) notFound();

  const evenements = await lireStoryline(utilisateur.tenant_id, id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2 text-base">
          Historique
          <span className="text-sm font-normal text-muted-foreground">
            {evenements.length} événement{evenements.length > 1 ? 's' : ''}, du plus récent
            au plus ancien
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChronologieAffaire evenements={evenements} />
      </CardContent>
    </Card>
  );
}
