'use client';

import { useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { tauxAAfficher, type ModeCalcul } from '@/lib/costing/marge';
import { formaterMontant } from '@/lib/costing/requetes';

export type LigneCout = {
  id: number;
  ligneNum: number;
  designationClient: string;
  reference: string | null;
  fournisseurNom: string | null;
  quantite: number;
  prixAchatHt: number;
  coutAdditionnel: number;
  coutLibelle: string | null;
  margePct: number;
  tvaPct: number;
  prixVenteHt: number;
  totalLigneHt: number;
  commentaire: string | null;
};

type Props = {
  lignes: LigneCout[];
  mode: ModeCalcul;
  devise: string;
  modifiable: boolean;
  enCours: string | null;
  onModifierLigne: (
    ligneId: number,
    champs: { margePct?: number; coutAdditionnel?: number; coutLibelle?: string; commentaire?: string },
  ) => void;
};

/**
 * Détail des lignes de la feuille de coûts, avec marge et coûts additionnels
 * éditables ligne par ligne.
 *
 * Les prix de vente affichés viennent des colonnes générées en base : rien
 * n'est recalculé ici, l'écran ne fait que restituer ce que Postgres a produit.
 */
export function EditeurMarge({
  lignes,
  mode,
  devise,
  modifiable,
  enCours,
  onModifierLigne,
}: Props) {
  const [edition, setEdition] = useState<number | null>(null);

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-8">#</TableHead>
            <TableHead className="min-w-44">Article</TableHead>
            <TableHead>Fournisseur</TableHead>
            <TableHead className="text-right">Qté</TableHead>
            <TableHead className="text-right">Achat HT</TableHead>
            <TableHead className="text-right">Coût add.</TableHead>
            <TableHead className="text-right">
              {mode === 'marge' ? 'Marge %' : 'Markup %'}
            </TableHead>
            <TableHead className="text-right">Vente HT</TableHead>
            <TableHead className="text-right">Total HT</TableHead>
            {modifiable && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lignes.map((ligne) =>
            edition === ligne.id ? (
              <TableRow key={ligne.id} className="bg-muted/30 hover:bg-muted/30">
                <TableCell colSpan={modifiable ? 10 : 9} className="p-3">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      onModifierLigne(ligne.id, {
                        margePct: Number(fd.get('margePct')),
                        coutAdditionnel: Number(fd.get('coutAdditionnel')),
                        coutLibelle: String(fd.get('coutLibelle') ?? ''),
                        commentaire: String(fd.get('commentaire') ?? ''),
                      });
                      setEdition(null);
                    }}
                    className="space-y-3"
                  >
                    <p className="text-sm font-medium">{ligne.designationClient}</p>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">
                          {mode === 'marge' ? 'Marge brute %' : 'Markup %'}
                        </span>
                        <Input
                          name="margePct"
                          type="number"
                          step="0.1"
                          min="0"
                          max={mode === 'marge' ? '99' : '1000'}
                          defaultValue={tauxAAfficher(ligne.margePct, mode).toFixed(1)}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-xs text-muted-foreground">
                          Coût additionnel (unitaire)
                        </span>
                        <Input
                          name="coutAdditionnel"
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={ligne.coutAdditionnel}
                        />
                      </label>
                      <label className="space-y-1 lg:col-span-2">
                        <span className="text-xs text-muted-foreground">
                          Nature du coût (obligatoire si non nul)
                        </span>
                        <Input
                          name="coutLibelle"
                          defaultValue={ligne.coutLibelle ?? ''}
                          placeholder="Transport, installation, douane…"
                          maxLength={200}
                        />
                      </label>
                    </div>

                    <label className="block space-y-1">
                      <span className="text-xs text-muted-foreground">Commentaire</span>
                      <Input
                        name="commentaire"
                        defaultValue={ligne.commentaire ?? ''}
                        maxLength={1000}
                      />
                    </label>

                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={enCours !== null}>
                        {enCours === `ligne-${ligne.id}` && (
                          <Loader2 className="size-4 animate-spin" />
                        )}
                        Enregistrer
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEdition(null)}
                      >
                        Annuler
                      </Button>
                    </div>
                  </form>
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={ligne.id}>
                <TableCell className="text-xs text-muted-foreground">
                  {ligne.ligneNum}
                </TableCell>
                <TableCell>
                  <p className="font-medium">{ligne.designationClient}</p>
                  {ligne.reference && (
                    <p className="font-mono text-xs text-muted-foreground">
                      {ligne.reference}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {ligne.fournisseurNom ?? '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">{ligne.quantite}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {ligne.prixAchatHt.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {ligne.coutAdditionnel > 0 ? (
                    <span title={ligne.coutLibelle ?? undefined}>
                      {ligne.coutAdditionnel.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                      {ligne.coutLibelle && (
                        <Badge variant="neutre" className="ml-1 px-1 py-0 text-[10px]">
                          {ligne.coutLibelle.slice(0, 12)}
                        </Badge>
                      )}
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {tauxAAfficher(ligne.margePct, mode).toFixed(1)} %
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {ligne.prixVenteHt.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formaterMontant(ligne.totalLigneHt, devise)}
                </TableCell>
                {modifiable && (
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={`Modifier ${ligne.designationClient}`}
                      disabled={enCours !== null}
                      onClick={() => setEdition(ligne.id)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
    </div>
  );
}
