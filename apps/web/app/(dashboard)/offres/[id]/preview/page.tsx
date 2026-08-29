import { notFound, redirect } from 'next/navigation';

import { EcranPreview } from '@/components/offres/EcranPreview';
import type { BoqAffiche } from '@/components/offres/RenduOffre';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { estStatutPublic } from '@/lib/offres/public';
import { createAdminClient } from '@/lib/supabase/admin';

import { urlApplication } from '@vigon/shared';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const utilisateur = await requireUser();

  if (!roleHasPermission(utilisateur.role, 'offre.previsualiser')) {
    // ADMIN passe par le joker de la matrice ; FINANCE et AFTER_SALES non.
    if (!roleHasPermission(utilisateur.role, 'offre.voir')) redirect('/403');
  }

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const db = createAdminClient();

  const { data: offre } = await db
    .from('offres')
    .select(
      'id, numero, version, statut, token_public, source_json, pdf_url, gamma_url',
    )
    .eq('id', id)
    .eq('tenant_id', utilisateur.tenant_id)
    .maybeSingle();

  if (!offre?.source_json) notFound();

  const { data: produits } = await db
    .from('offre_produits')
    .select('id, ordre, designation, description_technique, points_cles, image_url, image_source, image_validee')
    .eq('offre_id', id)
    .order('ordre', { ascending: true });

  const boq = offre.source_json as unknown as BoqAffiche;
  const appUrl = urlApplication();

  return (
    <EcranPreview
      offreId={id}
      numero={offre.numero}
      statut={offre.statut ?? 'brouillon'}
      boq={boq}
      produits={(produits ?? []).map((p) => ({
        id: p.id,
        ordre: p.ordre ?? 0,
        designation: p.designation,
        descriptionTechnique: p.description_technique,
        pointsCles: p.points_cles ?? [],
        imageUrl: p.image_url,
        imageSource: p.image_source,
        // Sans image ET validé = retrait décidé par un humain. Sans image et
        // non validé = visuel jamais trouvé, que la recherche peut encore
        // combler. L'écran doit proposer « Rétablir » dans le premier cas et
        // « Chercher » dans le second.
        visuelRetire: p.image_url === null && p.image_validee === true,
      }))}
      pdfUrl={offre.pdf_url}
      gammaUrl={offre.gamma_url}
      // `null` tant que l'offre n'est pas validée : la page publique refuse ce
      // jeton, et un bouton qui copie une adresse en 404 passe pour une panne.
      lienPublic={
        estStatutPublic(offre.statut) ? `${appUrl}/offre/${offre.token_public}` : null
      }
      peutModifier={roleHasPermission(utilisateur.role, 'offre.modifier')}
      peutEnvoyer={roleHasPermission(utilisateur.role, 'offre.envoyer')}
    />
  );
}
