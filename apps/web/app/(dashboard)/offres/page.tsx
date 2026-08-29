import Link from 'next/link';
import { FileText } from 'lucide-react';

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
import { formaterMontant } from '@/lib/costing/requetes';
import { formaterDateHeure } from '@/lib/demandes/statuts';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';

type Apparence = 'succes' | 'attention' | 'info' | 'neutre' | 'secondary';

const STATUTS: Record<string, { libelle: string; apparence: Apparence }> = {
  brouillon: { libelle: 'Brouillon', apparence: 'neutre' },
  generee: { libelle: 'Générée', apparence: 'info' },
  en_validation: { libelle: 'En relecture', apparence: 'attention' },
  validee: { libelle: 'Validée', apparence: 'info' },
  envoyee: { libelle: 'Envoyée', apparence: 'info' },
  consultee: { libelle: 'Consultée', apparence: 'attention' },
  approuvee: { libelle: 'Approuvée', apparence: 'succes' },
  refusee: { libelle: 'Refusée', apparence: 'secondary' },
  expiree: { libelle: 'Expirée', apparence: 'secondary' },
};

export default async function Page() {
  const utilisateur = await requireUser();

  // AFTER_SALES ne voit que les offres approuvées, conformément à son périmètre.
  const voitTout = roleHasPermission(utilisateur.role, 'offre.voir');
  const voitApprouvees = roleHasPermission(utilisateur.role, 'offre.voir_approuvees');
  if (!voitTout && !voitApprouvees) redirect('/403');

  const db = createAdminClient();

  let requete = db
    .from('offres')
    .select('id, numero, version, titre, statut, date_generation, date_envoi, nb_consultations, cost_sheet_id, demande_id')
    .eq('tenant_id', utilisateur.tenant_id)
    .order('id', { ascending: false });

  if (!voitTout) requete = requete.eq('statut', 'approuvee');

  const { data: offres } = await requete;

  // Montants : lus depuis la feuille de coûts, jamais recalculés ici.
  const idsFeuilles = (offres ?? [])
    .map((o) => o.cost_sheet_id)
    .filter((v): v is number => v !== null);

  const { data: feuilles } = idsFeuilles.length
    ? await db.from('cost_sheets').select('id, total_ttc, devise').in('id', idsFeuilles)
    : { data: [] };

  const montants = new Map(
    (feuilles ?? []).map((f) => [f.id, { ttc: Number(f.total_ttc ?? 0), devise: f.devise ?? 'MAD' }]),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Offres</h1>
        <p className="text-sm text-muted-foreground">
          {(offres ?? []).length} offre(s)
          {!voitTout && ' — périmètre : offres approuvées'}
        </p>
      </div>

      {(offres ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <FileText className="size-8 text-muted-foreground" />
          <p className="font-medium">Aucune offre</p>
          <p className="text-sm text-muted-foreground">
            Les offres se génèrent depuis une demande dont le costing est verrouillé.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Référence</TableHead>
                <TableHead>Objet</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Montant TTC</TableHead>
                <TableHead className="text-right">Vues</TableHead>
                <TableHead>Générée le</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(offres ?? []).map((o) => {
                const statut = STATUTS[o.statut ?? 'brouillon'] ?? {
                  libelle: o.statut ?? '—',
                  apparence: 'neutre' as Apparence,
                };
                const montant = o.cost_sheet_id ? montants.get(o.cost_sheet_id) : null;

                return (
                  <TableRow key={o.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-medium">
                      {o.numero}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="line-clamp-1">{o.titre ?? '—'}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statut.apparence}>{statut.libelle}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {montant ? formaterMontant(montant.ttc, montant.devise) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.nb_consultations || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formaterDateHeure(o.date_generation)}
                    </TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/offres/${o.id}/preview`}>Ouvrir</Link>
                      </Button>
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
