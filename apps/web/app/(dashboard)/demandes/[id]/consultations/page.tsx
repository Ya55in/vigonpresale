import { notFound, redirect } from 'next/navigation';

import { parseRfqTexte } from '@vigon/shared';

import { ListeConsultations } from '@/components/demandes/liste-consultations';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import {
  listerConsultations,
  listerEchanges,
  marquesSansConsultation,
} from '@/lib/consultations/requetes';
import { lireDemande } from '@/lib/demandes/requetes';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const utilisateur = await requireUser();

  if (!roleHasPermission(utilisateur.role, 'consultation.voir')) redirect('/403');

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const demande = await lireDemande(utilisateur, id);
  if (!demande) notFound();

  const [consultations, marquesSansFournisseur, echanges] = await Promise.all([
    listerConsultations(id, utilisateur.tenant_id),
    marquesSansConsultation(id, utilisateur.tenant_id),
    listerEchanges(id, utilisateur.tenant_id),
  ]);

  return (
    <ListeConsultations
      demandeId={id}
      consultations={consultations.map((c) => ({
        id: c.id,
        marque: c.marque,
        fournisseur_nom: c.fournisseur_nom,
        fournisseur_email: c.fournisseur_email,
        sujet: c.sujet,
        corps_html: c.corps_html,
        // Le formulaire d'édition travaille sur le contenu, jamais sur le
        // HTML : on lui remet la structure d'origine du message.
        contenu: parseRfqTexte(c.corps_texte ?? ''),
        statut: c.statut,
        date_envoi_prevue: c.date_envoi_prevue,
        date_envoi_reelle: c.date_envoi_reelle,
        relances: c.relances ?? 0,
        echanges: echanges.get(c.id) ?? [],
      }))}
      marquesSansFournisseur={marquesSansFournisseur}
      modifiable={roleHasPermission(utilisateur.role, 'consultation.modifier')}
      planifiable={roleHasPermission(utilisateur.role, 'consultation.planifier')}
    />
  );
}
