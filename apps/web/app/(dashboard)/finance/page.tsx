import Link from 'next/link';
import { CheckCircle2, Wallet } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guards';
import { motifEscalade } from '@/lib/costing/escalade';
import { formaterMontant, listerFeuillesEnAttente } from '@/lib/costing/requetes';
import { formaterDateHeure } from '@/lib/demandes/statuts';

export default async function Page() {
  const utilisateur = await requirePermission('dashboard.finance');

  const { lireParametres } = await import('@vigon/services');
  const parametres = await lireParametres(utilisateur.tenant_id);

  const seuils = {
    margeMin: parametres.seuilValidationFinanceMargeMin,
    montantMax: parametres.seuilValidationFinanceMontant,
  };

  const feuilles = await listerFeuillesEnAttente(utilisateur.tenant_id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="text-sm text-muted-foreground">
          Validations escaladées — seuils en vigueur : marge ≥ {seuils.margeMin} %,
          montant ≤ {seuils.montantMax.toLocaleString('fr-FR')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="size-4" />
            Costings à valider
            {feuilles.length > 0 && (
              <Badge variant="attention">{feuilles.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {feuilles.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="size-8 text-muted-foreground" />
              <p className="font-medium">Aucune validation en attente</p>
              <p className="text-sm text-muted-foreground">
                Les feuilles hors seuils apparaissent ici dès leur soumission par
                l&apos;avant-vente.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Demande</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Achat HT</TableHead>
                  <TableHead className="text-right">Total TTC</TableHead>
                  <TableHead className="text-right">Marge</TableHead>
                  <TableHead>Motif d&apos;escalade</TableHead>
                  <TableHead>Soumise le</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {feuilles.map((f) => {
                  const motif = motifEscalade(
                    { marge_globale_pct: f.margeGlobalePct, total_ttc: f.totalTtc },
                    seuils,
                  );

                  return (
                    <TableRow key={f.id}>
                      <TableCell className="whitespace-nowrap">
                        <Link
                          href={`/demandes/${f.demandeId}/costing`}
                          className="font-mono text-xs font-medium hover:underline"
                        >
                          {f.demandeCode}
                        </Link>
                        <Badge variant="neutre" className="ml-1.5 px-1 py-0 text-[10px]">
                          v{f.version}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[12rem]">
                        <span className="line-clamp-1">{f.clientNom ?? '—'}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {formaterMontant(f.totalAchatHt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                        {formaterMontant(f.totalTtc)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            f.margeGlobalePct < seuils.margeMin
                              ? 'font-medium text-destructive'
                              : undefined
                          }
                        >
                          {f.margeGlobalePct.toFixed(1)} %
                        </span>
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {motif ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formaterDateHeure(f.creeLe)}
                      </TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/demandes/${f.demandeId}/costing`}>Examiner</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
