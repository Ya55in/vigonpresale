import Link from 'next/link';
import { Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/guards';
import { formaterMontant } from '@/lib/costing/requetes';
import { formaterDate, STATUTS } from '@/lib/demandes/statuts';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Opportunités en cours.
 *
 * La table `opportunites` n'est pas encore alimentée automatiquement : tant
 * qu'elle est vide, l'écran présente les demandes actives, qui portent
 * aujourd'hui la réalité du pipeline commercial.
 */
export default async function Page() {
  const utilisateur = await requirePermission('demande.voir');

  const db = createAdminClient();

  const [{ data: opportunites }, { data: demandes }] = await Promise.all([
    db
      .from('opportunites')
      .select('id, code, titre, revenu_attendu, probabilite, deadline, statut')
      .eq('tenant_id', utilisateur.tenant_id)
      .order('id', { ascending: false }),
    db
      .from('demandes')
      .select('id, code, titre, statut, deadline, clients(nom)')
      .eq('tenant_id', utilisateur.tenant_id)
      .not('statut', 'in', '("gagnee","perdue","bloquee")')
      .order('id', { ascending: false }),
  ]);

  const aOpportunites = (opportunites ?? []).length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Opportunités</h1>
        <p className="text-sm text-muted-foreground">
          {aOpportunites
            ? `${opportunites!.length} opportunité(s) enregistrée(s)`
            : `${(demandes ?? []).length} dossier(s) actif(s) — pipeline dérivé des demandes en cours`}
        </p>
      </div>

      {aOpportunites ? (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Code</TableHead>
                <TableHead>Titre</TableHead>
                <TableHead className="text-right">Revenu attendu</TableHead>
                <TableHead className="text-right">Probabilité</TableHead>
                <TableHead>Échéance</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opportunites!.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-mono text-xs">{o.code}</TableCell>
                  <TableCell>{o.titre}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.revenu_attendu ? formaterMontant(Number(o.revenu_attendu)) : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.probabilite ?? '—'} %
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formaterDate(o.deadline)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="info">{o.statut}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (demandes ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <Target className="size-8 text-muted-foreground" />
          <p className="font-medium">Aucun dossier actif</p>
          <p className="text-sm text-muted-foreground">
            Le pipeline se remplit dès qu&apos;une demande client arrive.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Dossier</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Étape</TableHead>
                <TableHead>Échéance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(demandes ?? []).map((d) => {
                const client = Array.isArray(d.clients) ? d.clients[0] : d.clients;
                const statut = STATUTS[d.statut];
                return (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      <Link href={`/demandes/${d.id}`} className="font-medium hover:underline">
                        {d.code}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="line-clamp-1">{d.titre ?? '—'}</span>
                    </TableCell>
                    <TableCell>{client?.nom ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={statut.apparence}>{statut.libelle}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formaterDate(d.deadline)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
