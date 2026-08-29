import Link from 'next/link';
import { Inbox, Plus } from 'lucide-react';

import { AIDES_SOURCE, LIBELLES_SOURCE, sourceOuDefaut } from '@vigon/shared';

import { FiltresListe } from '@/components/demandes/filtres-liste';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { lireFiltres, listerDemandes, TAILLE_PAGE } from '@/lib/demandes/requetes';
import { formaterDate, formaterDateHeure, STATUTS } from '@/lib/demandes/statuts';
import { redirect } from 'next/navigation';

type Props = {
  // Promise depuis Next 16 : le codemod ne l'a pas vu, le type étant déclaré à
  // part plutôt qu'en ligne dans la signature.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page(props: Props) {
  const searchParams = await props.searchParams;
  const utilisateur = await requireUser();

  // AFTER_SALES n'a pas `demande.voir` mais `demande.voir_gagnees` : les deux
  // ouvrent cette page, le périmètre est restreint par la requête elle-même.
  const autorise =
    roleHasPermission(utilisateur.role, 'demande.voir') ||
    roleHasPermission(utilisateur.role, 'demande.voir_gagnees');
  if (!autorise) redirect('/403');

  const filtres = lireFiltres(searchParams);
  const { lignes, total } = await listerDemandes(utilisateur, filtres);

  const pages = Math.max(1, Math.ceil(total / TAILLE_PAGE));
  const lienPage = (page: number): string => {
    const p = new URLSearchParams();
    if (filtres.recherche) p.set('q', filtres.recherche);
    if (filtres.statut) p.set('statut', filtres.statut);
    if (filtres.tri !== 'recent') p.set('tri', filtres.tri);
    if (page > 1) p.set('page', String(page));
    const q = p.toString();
    return q ? `/demandes?${q}` : '/demandes';
  };

  const peutCreer = roleHasPermission(utilisateur.role, 'demande.creer');

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Demandes</h1>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? 'Aucune demande'
              : `${total} demande${total > 1 ? 's' : ''}`}
            {utilisateur.role === 'after_sales' && ' — périmètre : deals gagnés'}
          </p>
        </div>

        {peutCreer && (
          <Button asChild size="sm">
            <Link href="/demandes/nouvelle">
              <Plus className="size-4" />
              Nouvelle demande
            </Link>
          </Button>
        )}
      </div>

      <FiltresListe />

      {lignes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <Inbox className="size-8 text-muted-foreground" />
          <p className="font-medium">Aucune demande ne correspond</p>
          <p className="text-sm text-muted-foreground">
            Les demandes arrivent automatiquement depuis la boîte avant-vente.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Origine</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Articles</TableHead>
                <TableHead>Reçue le</TableHead>
                <TableHead>Échéance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lignes.map((ligne) => {
                const statut = STATUTS[ligne.statut];
                return (
                  <TableRow key={ligne.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      <Link
                        href={`/demandes/${ligne.id}`}
                        className="font-medium hover:underline"
                      >
                        {ligne.code}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <Link
                        href={`/demandes/${ligne.id}`}
                        className="line-clamp-1 hover:underline"
                      >
                        {ligne.titre ?? '—'}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[14rem]">
                      <span className="line-clamp-1">
                        {ligne.client?.nom ?? ligne.email_client ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span
                        className="text-xs text-muted-foreground"
                        title={AIDES_SOURCE[sourceOuDefaut(ligne.source)]}
                      >
                        {LIBELLES_SOURCE[sourceOuDefaut(ligne.source)]}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statut.apparence}>{statut.libelle}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ligne.nb_articles || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formaterDateHeure(ligne.date_reception)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formaterDate(ligne.deadline)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {filtres.page} sur {pages}
          </p>
          {/* `asChild` rendrait un <a>, que l'attribut disabled n'inhibe pas :
              on retire donc le lien plutôt que de le désactiver visuellement. */}
          <div className="flex gap-2">
            {filtres.page > 1 ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={lienPage(filtres.page - 1)}>Précédent</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Précédent
              </Button>
            )}
            {filtres.page < pages ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={lienPage(filtres.page + 1)}>Suivant</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled>
                Suivant
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
