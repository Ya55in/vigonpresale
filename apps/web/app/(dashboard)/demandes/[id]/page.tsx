import { notFound, redirect } from 'next/navigation';
import { AlertTriangle, FileWarning, Paperclip } from 'lucide-react';

import { BoutonRelancerExtraction } from '@/components/demandes/BoutonRelancerExtraction';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { lireDemande, listerPiecesJointes } from '@/lib/demandes/requetes';
import { formaterDate, formaterDateHeure } from '@/lib/demandes/statuts';

/** Taille lisible : les tailles brutes en octets ne disent rien à l'écran. */
function formaterTaille(octets: number | null): string {
  if (!octets) return '—';
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(1)} Ko`;
  return `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
}

function Champ({ libelle, valeur }: { libelle: string; valeur: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {libelle}
      </dt>
      <dd className="text-sm">{valeur}</dd>
    </div>
  );
}

export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const utilisateur = await requireUser();

  const autorise =
    roleHasPermission(utilisateur.role, 'demande.voir') ||
    roleHasPermission(utilisateur.role, 'demande.voir_gagnees');
  if (!autorise) redirect('/403');

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const demande = await lireDemande(utilisateur, id);
  if (!demande) notFound();

  const pieces = await listerPiecesJointes(id);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        {demande.statut === 'bloquee' && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertTitle>Demande bloquée</AlertTitle>
            <AlertDescription>
              {demande.motif_blocage ?? 'Motif non enregistré.'}
              {/* Le motif cite souvent une panne depuis réparée — modèle retiré,
                  quota épuisé. Sans ce bouton la demande restait close pour une
                  cause qui n'existait plus. */}
              {roleHasPermission(utilisateur.role, 'demande.modifier') && (
                <BoutonRelancerExtraction demandeId={demande.id} />
              )}
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message d&apos;origine</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Champ libelle="Expéditeur" valeur={demande.expediteur_brut ?? '—'} />
              <Champ libelle="Objet" valeur={demande.sujet_original ?? '—'} />
            </dl>

            {demande.corps_original && (
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Corps
                </p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-sm">
                  {demande.corps_original}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Paperclip className="size-4" />
              Pièces jointes
              {pieces.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">
                  ({pieces.length})
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieces.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aucune pièce jointe.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {pieces.map((piece) => (
                  <li
                    key={piece.id}
                    className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p
                        className={
                          piece.parent_archive_id
                            ? 'truncate pl-4 text-muted-foreground'
                            : 'truncate'
                        }
                        title={piece.nom_fichier}
                      >
                        {piece.parent_archive_id ? '↳ ' : ''}
                        {piece.nom_fichier}
                      </p>
                      {piece.erreur_extraction && (
                        <p className="flex items-center gap-1 text-xs text-destructive">
                          <FileWarning className="size-3" />
                          {piece.erreur_extraction}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {piece.est_archive && (
                        <Badge variant="neutre">archive</Badge>
                      )}
                      {piece.statut_extraction === 'echec' && (
                        <Badge variant="attention">illisible</Badge>
                      )}
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {formaterTaille(piece.taille_octets)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {demande.contenu_consolide && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Contenu analysé
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {demande.contenu_consolide.length.toLocaleString('fr-FR')}{' '}
                  caractères
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-sans text-xs">
                {demande.contenu_consolide}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Client</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Champ
                libelle="Nom"
                valeur={demande.client?.nom ?? 'Non identifié'}
              />
              <Champ
                libelle="E-mail"
                valeur={demande.email_client ?? demande.client?.email_principal ?? '—'}
              />
              {demande.client?.telephone && (
                <Champ libelle="Téléphone" valeur={demande.client.telephone} />
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Suivi</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <Champ
                libelle="Reçue le"
                valeur={formaterDateHeure(demande.date_reception)}
              />
              <Champ
                libelle="Specs extraites"
                valeur={formaterDateHeure(demande.date_extraction)}
              />
              <Champ libelle="Échéance" valeur={formaterDate(demande.deadline)} />
              <Champ libelle="Priorité" valeur={demande.priorite ?? '—'} />
              <Champ
                libelle="TVA"
                valeur={demande.tva_pct != null ? `${demande.tva_pct} %` : '—'}
              />
              <Champ libelle="Devise" valeur={demande.devise ?? '—'} />
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
