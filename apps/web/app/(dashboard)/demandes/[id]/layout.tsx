import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { OngletsDemande } from '@/components/demandes/onglets';
import { Badge } from '@/components/ui/badge';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { lireDemande } from '@/lib/demandes/requetes';
import { STATUTS } from '@/lib/demandes/statuts';
import { redirect } from 'next/navigation';

/**
 * Onglets de la fiche demande, dans l'ordre du déroulé d'une affaire.
 *
 * « Historique » ferme la liste plutôt que de l'ouvrir : c'est un écran de
 * relecture, consulté quand une question se pose, pas l'écran par lequel on
 * commence.
 */
const ONGLETS = [
  { libelle: "Vue d'ensemble", segment: '' },
  { libelle: 'Articles', segment: 'articles' },
  { libelle: 'Consultations', segment: 'consultations' },
  { libelle: 'Costing', segment: 'costing' },
  { libelle: 'Offre', segment: 'offre' },
  { libelle: 'Documents', segment: 'documents' },
  { libelle: 'Historique', segment: 'historique' },
];

export default async function LayoutDemande(
  props: {
    children: React.ReactNode;
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  const utilisateur = await requireUser();

  const autorise =
    roleHasPermission(utilisateur.role, 'demande.voir') ||
    roleHasPermission(utilisateur.role, 'demande.voir_gagnees');
  if (!autorise) redirect('/403');

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  // Hors périmètre et inexistante donnent le même 404 : on ne révèle pas
  // l'existence d'une demande que l'utilisateur n'a pas le droit de voir.
  const demande = await lireDemande(utilisateur, id);
  if (!demande) notFound();

  const statut = STATUTS[demande.statut];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Link
          href="/demandes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Demandes
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {demande.titre ?? demande.code}
          </h1>
          <Badge variant={statut.apparence}>{statut.libelle}</Badge>
        </div>

        <p className="font-mono text-xs text-muted-foreground">{demande.code}</p>
      </div>

      <OngletsDemande demandeId={id} onglets={ONGLETS} />

      {children}
    </div>
  );
}
