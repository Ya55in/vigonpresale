import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CriteresFournisseur } from '@/lib/costing/requetes';
import { formaterMontant } from '@/lib/costing/requetes';
import { cn } from '@/lib/utils';

type Props = {
  criteres: CriteresFournisseur[];
  devise: string;
};

/** Cellule d'un critère annoncé en clair ; l'absence est une information. */
function Critere({ valeur }: { valeur: string | null }) {
  if (!valeur) {
    return <span className="text-sm text-muted-foreground/70">non précisé</span>;
  }
  return <span className="text-sm">{valeur}</span>;
}

/**
 * Comparaison des fournisseurs sur les critères portés par le devis.
 *
 * Le tableau par article ne peut pas les montrer : garantie, paiement et
 * validité s'annoncent une fois pour tout le devis. Les laisser de côté
 * reviendrait à arbitrer sur le seul prix, alors qu'une garantie de 12 mois
 * contre 36 pèse souvent davantage que quelques pourcents.
 *
 * La couverture est affichée à côté du total, et commande le tri : un total
 * plus bas sur trois articles ne se compare pas à un total sur dix. Sans elle,
 * le fournisseur le plus incomplet paraîtrait toujours le moins cher.
 */
export function SyntheseFournisseurs({ criteres, devise }: Props) {
  if (criteres.length === 0) return null;

  const complets = criteres.filter(
    (c) => c.articlesCouverts === c.articlesDemandes,
  );

  // Référence de prix prise sur les seuls devis complets : comparer un total
  // partiel au total le plus bas désignerait un « meilleur prix » trompeur.
  const meilleurTotal =
    complets.length > 0 ? Math.min(...complets.map((c) => c.totalHt)) : null;

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="min-w-40">Fournisseur</TableHead>
            <TableHead className="text-right">Total HT</TableHead>
            <TableHead className="text-right">Couverture</TableHead>
            <TableHead className="min-w-32">Livraison</TableHead>
            <TableHead className="min-w-40">Paiement</TableHead>
            <TableHead className="min-w-36">Garantie</TableHead>
            <TableHead className="min-w-28">Validité</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {criteres.map((c) => {
            const partiel = c.articlesCouverts < c.articlesDemandes;
            const estMeilleur = !partiel && c.totalHt === meilleurTotal;

            return (
              <TableRow key={`${c.id ?? c.nom}`}>
                <TableCell>
                  <p className="font-medium">{c.nom}</p>
                  {c.numeroDevis && (
                    <p className="font-mono text-xs text-muted-foreground">
                      {c.numeroDevis}
                    </p>
                  )}
                </TableCell>

                <TableCell className="text-right">
                  <span
                    className={cn(
                      'tabular-nums',
                      estMeilleur &&
                        'font-semibold text-emerald-700 dark:text-emerald-400',
                    )}
                  >
                    {formaterMontant(c.totalHt, devise)}
                  </span>
                </TableCell>

                <TableCell className="text-right">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 tabular-nums text-sm',
                      partiel && 'text-amber-700 dark:text-amber-500',
                    )}
                  >
                    {partiel && <AlertTriangle className="size-3.5" />}
                    {c.articlesCouverts} / {c.articlesDemandes}
                  </span>
                </TableCell>

                <TableCell>
                  <Critere valeur={c.delaiLivraison} />
                </TableCell>
                <TableCell>
                  <Critere valeur={c.conditionsPaiement} />
                </TableCell>
                <TableCell>
                  <Critere valeur={c.garantie} />
                </TableCell>
                <TableCell>
                  <Critere valeur={c.validiteOffre} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {complets.length === 0 && (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          <Badge variant="attention" className="mr-1.5 px-1 py-0 text-[10px]">
            partiel
          </Badge>
          Aucun fournisseur ne couvre toute la demande : les totaux ne sont pas
          comparables entre eux.
        </p>
      )}
    </div>
  );
}
