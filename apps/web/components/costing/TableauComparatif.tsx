'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formaterMontant } from '@/lib/costing/requetes';
import { cn } from '@/lib/utils';

export type OffreAffichee = {
  ligneDevisId: number;
  /** Devis d'origine : c'est lui qui rattache l'offre à sa colonne. */
  devisId: number;
  fournisseurNom: string;
  prixAchatNetHt: number;
  remisePct: number;
  disponibilite: string | null;
  delaiLivraison: string | null;
  mappingType: string | null;
};

export type LigneAffichee = {
  demandeItemId: number;
  ligneNum: number;
  designation: string;
  reference: string | null;
  quantite: number;
  offres: OffreAffichee[];
  meilleurPrixNet: number | null;
};

type Props = {
  lignes: LigneAffichee[];
  /**
   * UNE COLONNE PAR DEVIS, jamais par fournisseur.
   *
   * L'appariement se faisait par nom, et perdait toute offre qu'un homonyme ou
   * un second devis du même fournisseur venait masquer — 6 sur 16 sur une
   * demande réelle. Le devis est l'unité qui rend chaque offre atteignable.
   */
  colonnes: { devisId: number; libelle: string }[];
  /** ligneDevisId retenu par demande_item. */
  selection: Record<number, number>;
  onSelection: (demandeItemId: number, ligneDevisId: number) => void;
  modifiable: boolean;
  devise: string;
};

/**
 * Comparatif des prix d'achat : articles en lignes, DEVIS en colonnes.
 *
 * Le meilleur prix comparable est mis en évidence, mais jamais présélectionné :
 * le choix reste explicite, car le prix n'est pas le seul critère — un délai de
 * trois semaines peut disqualifier l'offre la moins chère.
 */
export function TableauComparatif({
  lignes,
  colonnes,
  selection,
  onSelection,
  modifiable,
  devise,
}: Props) {
  const [survol, setSurvol] = useState<string | null>(null);

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8">#</TableHead>
            <TableHead className="min-w-48">Article</TableHead>
            <TableHead className="text-right">Qté</TableHead>
            {colonnes.map((c) => (
              <TableHead key={c.devisId} className="min-w-36 text-right">
                {c.libelle}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lignes.map((ligne) => {
            const retenu = selection[ligne.demandeItemId];

            return (
              <TableRow key={ligne.demandeItemId}>
                <TableCell className="text-xs text-muted-foreground">
                  {ligne.ligneNum}
                </TableCell>
                <TableCell>
                  <p className="font-medium">{ligne.designation}</p>
                  {ligne.reference && (
                    <p className="font-mono text-xs text-muted-foreground">
                      {ligne.reference}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {ligne.quantite}
                </TableCell>

                {colonnes.map((c) => {
                  // Appariement par DEVIS : une offre appartient à exactement
                  // un devis, donc aucune ne peut en masquer une autre.
                  const offre = ligne.offres.find((o) => o.devisId === c.devisId);

                  if (!offre) {
                    return (
                      <TableCell
                        key={c.devisId}
                        className="text-right text-sm text-muted-foreground"
                      >
                        —
                      </TableCell>
                    );
                  }

                  const estMeilleur =
                    ligne.meilleurPrixNet !== null &&
                    offre.prixAchatNetHt === ligne.meilleurPrixNet;
                  const estRetenu = retenu === offre.ligneDevisId;
                  const cle = `${ligne.demandeItemId}-${offre.ligneDevisId}`;

                  return (
                    <TableCell key={c.devisId} className="p-1 text-right align-top">
                      <button
                        type="button"
                        disabled={!modifiable}
                        aria-pressed={estRetenu}
                        aria-label={`Retenir ${c.libelle} pour ${ligne.designation} à ${formaterMontant(offre.prixAchatNetHt, devise)}`}
                        onClick={() => onSelection(ligne.demandeItemId, offre.ligneDevisId)}
                        onMouseEnter={() => setSurvol(cle)}
                        onMouseLeave={() => setSurvol(null)}
                        className={cn(
                          'w-full rounded-md border px-2 py-1.5 text-right transition-colors',
                          estRetenu
                            ? 'border-primary bg-primary/10'
                            : 'border-transparent hover:border-input',
                          !modifiable && 'cursor-default',
                        )}
                      >
                        <span className="flex items-center justify-end gap-1.5">
                          {estRetenu && <Check className="size-3.5 text-primary" />}
                          <span
                            className={cn(
                              'tabular-nums',
                              estMeilleur && 'font-semibold text-emerald-700 dark:text-emerald-400',
                            )}
                          >
                            {offre.prixAchatNetHt.toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </span>

                        <span className="mt-0.5 flex flex-wrap items-center justify-end gap-1">
                          {offre.remisePct > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              −{offre.remisePct} %
                            </span>
                          )}
                          {offre.mappingType === 'alternative' && (
                            <Badge variant="attention" className="px-1 py-0 text-[10px]">
                              alt.
                            </Badge>
                          )}
                        </span>

                        {survol === cle && (offre.disponibilite ?? offre.delaiLivraison) && (
                          <span className="mt-1 block text-[11px] leading-tight text-muted-foreground">
                            {[offre.disponibilite, offre.delaiLivraison]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </button>
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
