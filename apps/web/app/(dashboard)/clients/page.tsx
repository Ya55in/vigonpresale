import Link from 'next/link';
import { Building2 } from 'lucide-react';

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
import { createAdminClient } from '@/lib/supabase/admin';

export default async function Page() {
  const utilisateur = await requirePermission('client.voir');

  const db = createAdminClient();

  const { data: clients } = await db
    .from('clients')
    .select('id, nom, email_principal, telephone, ville, pays, secteur')
    .eq('tenant_id', utilisateur.tenant_id)
    .order('nom', { ascending: true });

  // Compteurs de demandes par client, pour situer chaque compte d'un coup d'œil.
  const { data: demandes } = await db
    .from('demandes')
    .select('client_id, statut')
    .eq('tenant_id', utilisateur.tenant_id);

  const parClient = new Map<number, { total: number; gagnees: number }>();
  for (const d of demandes ?? []) {
    if (d.client_id === null) continue;
    const courant = parClient.get(d.client_id) ?? { total: 0, gagnees: 0 };
    courant.total += 1;
    if (d.statut === 'gagnee') courant.gagnees += 1;
    parClient.set(d.client_id, courant);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">
          {(clients ?? []).length} client(s) — créés automatiquement à la réception
          d&apos;une première demande.
        </p>
      </div>

      {(clients ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <Building2 className="size-8 text-muted-foreground" />
          <p className="font-medium">Aucun client</p>
          <p className="text-sm text-muted-foreground">
            Une fiche est créée dès qu&apos;une demande arrive d&apos;une nouvelle
            adresse.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Client</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Localisation</TableHead>
                <TableHead className="text-right">Demandes</TableHead>
                <TableHead className="text-right">Gagnées</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(clients ?? []).map((c) => {
                const stats = parClient.get(c.id) ?? { total: 0, gagnees: 0 };
                return (
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-medium">{c.nom}</p>
                      {c.secteur && (
                        <p className="text-xs text-muted-foreground">{c.secteur}</p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      <p className="truncate text-sm">{c.email_principal ?? '—'}</p>
                      {c.telephone && (
                        <p className="text-xs text-muted-foreground">{c.telephone}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[c.ville, c.pays].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {stats.total > 0 ? (
                        <Link
                          href={`/demandes?q=${encodeURIComponent(c.email_principal ?? c.nom)}`}
                          className="hover:underline"
                        >
                          {stats.total}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {stats.gagnees > 0 ? (
                        <Badge variant="succes">{stats.gagnees}</Badge>
                      ) : (
                        <span className="tabular-nums text-muted-foreground">—</span>
                      )}
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
