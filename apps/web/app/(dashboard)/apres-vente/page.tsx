import Link from 'next/link';
import { PackageCheck } from 'lucide-react';

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
import { SuiviTickets } from '@/components/sav/SuiviTickets';
import { requireRole } from '@/lib/auth/guards';
import { lireAffairesGagnees, lireTickets } from '@/lib/sav/requetes';
import { formaterDate, formaterDateHeure } from '@/lib/demandes/statuts';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Espace après-vente : dossiers gagnés uniquement.
 *
 * Aucun montant d'achat ni marge n'est lu ici — la spec l'interdit à ce rôle,
 * et ne pas récupérer ces colonnes est plus sûr que les masquer à l'affichage.
 */
export default async function Page() {
  const utilisateur = await requireRole('after_sales', 'admin');

  const db = createAdminClient();

  const { data: demandes } = await db
    .from('demandes')
    .select('id, code, titre, date_decision, deadline, clients(nom, email_principal, telephone)')
    .eq('tenant_id', utilisateur.tenant_id)
    .eq('statut', 'gagnee')
    .order('date_decision', { ascending: false });

  const { data: offres } = await db
    .from('offres')
    .select('id, numero, demande_id, date_approbation')
    .eq('tenant_id', utilisateur.tenant_id)
    .eq('statut', 'approuvee');

  const offreParDemande = new Map(
    (offres ?? [])
      .filter((o) => o.demande_id !== null)
      .map((o) => [o.demande_id as number, o]),
  );

  const [tickets, affaires] = await Promise.all([
    lireTickets(utilisateur.tenant_id),
    lireAffairesGagnees(utilisateur.tenant_id),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Après-vente</h1>
        <p className="text-sm text-muted-foreground">
          {(demandes ?? []).length} dossier(s) gagné(s) à suivre — livraison et
          satisfaction client.
        </p>
      </div>

      {/* Le suivi du support d'abord : c'est la file de travail quotidienne.
          La liste des affaires gagnées reste dessous, comme contexte. */}
      <SuiviTickets
        tickets={tickets}
        affaires={affaires.map((a) => ({ id: a.id, code: a.code, titre: a.titre }))}
        modifiable
      />

      <h2 className="pt-2 text-lg font-semibold tracking-tight">Affaires gagnées</h2>

      {(demandes ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-16 text-center">
          <PackageCheck className="size-8 text-muted-foreground" />
          <p className="font-medium">Aucun dossier gagné</p>
          <p className="text-sm text-muted-foreground">
            Un dossier arrive ici dès que le client approuve son offre.
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
                <TableHead>Offre</TableHead>
                <TableHead>Gagné le</TableHead>
                <TableHead>Échéance annoncée</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(demandes ?? []).map((d) => {
                const client = Array.isArray(d.clients) ? d.clients[0] : d.clients;
                const offre = offreParDemande.get(d.id);

                return (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-medium">
                      {d.code}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="line-clamp-1">{d.titre ?? '—'}</span>
                    </TableCell>
                    <TableCell className="max-w-[14rem]">
                      <p className="truncate">{client?.nom ?? '—'}</p>
                      {client?.email_principal && (
                        <p className="truncate text-xs text-muted-foreground">
                          {client.email_principal}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {offre ? (
                        <Badge variant="succes">{offre.numero}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formaterDateHeure(d.date_decision)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formaterDate(d.deadline)}
                    </TableCell>
                    <TableCell>
                      {offre && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/offres/${offre.id}/preview`}>Offre</Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Le suivi de livraison n&apos;est pas encore instrumenté : la table dédiée
        n&apos;existe pas au schéma.
      </p>
    </div>
  );
}
