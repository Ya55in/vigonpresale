import { notFound, redirect } from 'next/navigation';

import { GestionDocuments } from '@/components/documents/GestionDocuments';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { lireDemande } from '@/lib/demandes/requetes';
import { lireDocuments, lireOffresEmettables } from '@/lib/documents/requetes';

/**
 * Documents financiers d'une affaire.
 *
 * La garde est refaite ici alors que le layout la porte déjà : chaque onglet
 * est une route à part entière, et un écran qui compterait sur le contrôle d'un
 * parent deviendrait ouvert le jour où l'arborescence bouge.
 *
 * Les deux droits sont calculés au serveur et passés au client pour l'affichage
 * seul — chaque action les revérifie de son côté, parce qu'un bouton masqué
 * n'est pas une autorisation.
 */
export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const utilisateur = await requireUser();

  if (!roleHasPermission(utilisateur.role, 'document.voir')) redirect('/403');

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const demande = await lireDemande(utilisateur, id);
  if (!demande) notFound();

  const [documents, offres] = await Promise.all([
    lireDocuments(utilisateur.tenant_id, id),
    lireOffresEmettables(utilisateur.tenant_id, id),
  ]);

  return (
    <GestionDocuments
      demandeId={id}
      documents={documents}
      offres={offres}
      peutEmettre={roleHasPermission(utilisateur.role, 'document.emettre')}
      peutRegler={roleHasPermission(utilisateur.role, 'document.regler')}
    />
  );
}
