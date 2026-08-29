import { notFound, redirect } from 'next/navigation';

import { TableauArticles } from '@/components/demandes/tableau-articles';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { lireDemande, listerArticles } from '@/lib/demandes/requetes';

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const utilisateur = await requireUser();

  const autorise =
    roleHasPermission(utilisateur.role, 'article.voir') ||
    roleHasPermission(utilisateur.role, 'demande.voir') ||
    roleHasPermission(utilisateur.role, 'demande.voir_gagnees');
  if (!autorise) redirect('/403');

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const demande = await lireDemande(utilisateur, id);
  if (!demande) notFound();

  const articles = await listerArticles(id);

  // Les droits sont recalculés côté serveur à chaque action : ce qui suit
  // n'ajuste que l'affichage.
  const modifiable = roleHasPermission(utilisateur.role, 'article.modifier');
  const validable = roleHasPermission(utilisateur.role, 'article.valider');

  return (
    <TableauArticles
      demandeId={id}
      articles={articles.map((a) => ({
        id: a.id,
        ligne_num: a.ligne_num,
        designation: a.designation,
        reference: a.reference,
        // Colonnes nullables en base : on retombe sur les mêmes valeurs que
        // celles imposées au modèle, pour ne jamais afficher de case vide.
        marque: a.marque ?? 'Non specifie',
        quantite: Number(a.quantite),
        unite: a.unite ?? 'unité',
        categorie: a.categorie,
        specifications: a.specifications,
        confiance_ia: a.confiance_ia === null ? null : Number(a.confiance_ia),
        valide_at: a.valide_at,
      }))}
      modifiable={modifiable}
      validable={validable}
    />
  );
}
