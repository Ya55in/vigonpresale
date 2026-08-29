import { notFound, redirect } from 'next/navigation';

import { EcranOffre } from '@/components/offres/EcranOffre';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { lireDemande } from '@/lib/demandes/requetes';
import { createAdminClient } from '@/lib/supabase/admin';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const utilisateur = await requireUser();

  if (!roleHasPermission(utilisateur.role, 'offre.voir')) redirect('/403');

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const demande = await lireDemande(utilisateur, id);
  if (!demande) notFound();

  const db = createAdminClient();

  const [{ data: feuille }, { data: offre }] = await Promise.all([
    db
      .from('cost_sheets')
      .select('statut, devise')
      .eq('demande_id', id)
      .eq('tenant_id', utilisateur.tenant_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('offres')
      .select('id, numero, version, statut, gamma_url, pdf_url, date_generation')
      .eq('demande_id', id)
      .eq('tenant_id', utilisateur.tenant_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const { data: produits } = offre
    ? await db
        .from('offre_produits')
        .select(
          'id, ordre, designation, reference, marque, description_technique, points_cles, image_url, image_source, quantite, prix_unitaire_ht, total_ht',
        )
        .eq('offre_id', offre.id)
        .order('ordre', { ascending: true })
    : { data: null };

  return (
    <EcranOffre
      demandeId={id}
      offre={
        offre
          ? {
              id: offre.id,
              numero: offre.numero,
              version: offre.version,
              statut: offre.statut ?? 'brouillon',
              gammaUrl: offre.gamma_url,
              pdfUrl: offre.pdf_url,
              dateGeneration: offre.date_generation,
              produits: (produits ?? []).map((p) => ({
                id: p.id,
                ordre: p.ordre ?? 0,
                designation: p.designation,
                reference: p.reference,
                marque: p.marque,
                descriptionTechnique: p.description_technique,
                pointsCles: p.points_cles ?? [],
                imageUrl: p.image_url,
                imageSource: p.image_source,
                quantite: Number(p.quantite ?? 1),
                prixUnitaireHt: Number(p.prix_unitaire_ht ?? 0),
                totalHt: Number(p.total_ht ?? 0),
              })),
            }
          : null
      }
      costingVerrouille={feuille?.statut === 'verrouille'}
      devise={feuille?.devise ?? demande.devise ?? 'MAD'}
      peutGenerer={roleHasPermission(utilisateur.role, 'offre.generer')}
    />
  );
}
