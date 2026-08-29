'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, FileText, Loader2, Plus, Send, X } from 'lucide-react';

import {
  LIBELLES_DOCUMENT,
  LIBELLES_STATUT_DOCUMENT,
  TYPES_DOCUMENT,
  type TypeDocument,
} from '@vigon/shared';

import {
  annulerDocument,
  emettreDocumentFinancier,
  envoyerDocumentAuClient,
  marquerRegle,
  type ResultatDocument,
} from '@/app/(dashboard)/demandes/[id]/documents/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DocumentFinancier, OffreEmettable } from '@/lib/documents/requetes';
import { cn } from '@/lib/utils';

type Props = {
  demandeId: number;
  documents: DocumentFinancier[];
  offres: OffreEmettable[];
  peutEmettre: boolean;
  peutRegler: boolean;
};

const APPARENCE_STATUT: Record<string, 'succes' | 'attention' | 'neutre'> = {
  emis: 'attention',
  regle: 'succes',
  annule: 'neutre',
};

/**
 * L'ordre commercial habituel, qui n'est pas imposé.
 *
 * Un bon de commande précède normalement la pro-forma, qui précède la facture —
 * mais une affaire peut légitimement sauter une étape, et une facture d'acompte
 * peut partir avant le solde. L'écran suggère la suite ; il ne l'exige pas.
 */
const ORDRE: TypeDocument[] = [...TYPES_DOCUMENT];

const montant = (n: number, devise: string): string =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;

const jour = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function GestionDocuments({
  demandeId,
  documents,
  offres,
  peutEmettre,
  peutRegler,
}: Props) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<ResultatDocument | null>(null);
  const [formulaire, setFormulaire] = useState<TypeDocument | null>(null);
  const [annulation, setAnnulation] = useState<number | null>(null);

  async function envoyer(
    cle: string,
    action: (
      demandeId: number,
      etat: ResultatDocument | null,
      donnees: FormData,
    ) => Promise<ResultatDocument>,
    donnees: FormData,
    apres?: () => void,
  ): Promise<void> {
    setEnCours(cle);
    setRetour(null);

    const resultat = await action(demandeId, null, donnees);

    setEnCours(null);
    setRetour(resultat);

    if (resultat.ok) {
      apres?.();
      router.refresh();
    }
  }

  const dejaEmis = new Set(
    documents.filter((d) => d.statut !== 'annule').map((d) => d.type),
  );

  return (
    <div className="space-y-5">
      {retour && (
        <p
          className={cn(
            'rounded-md border px-3 py-2 text-sm',
            retour.ok
              ? 'border-emerald-600/30 bg-emerald-600/5 text-emerald-700 dark:text-emerald-400'
              : 'border-destructive/30 bg-destructive/5 text-destructive',
          )}
        >
          {retour.message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Émettre un document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {offres.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune offre approuvée sur cette affaire. Un document financier se
              fonde sur l’accord du client : tant qu’il n’a pas approuvé une
              offre, il n’y a rien à facturer.
            </p>
          ) : !peutEmettre ? (
            <p className="text-sm text-muted-foreground">
              Vous pouvez consulter les documents, pas en émettre.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {ORDRE.map((type) => (
                  <Button
                    key={type}
                    type="button"
                    variant={formulaire === type ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFormulaire(formulaire === type ? null : type)}
                  >
                    <Plus className="mr-1.5 size-3.5" />
                    {LIBELLES_DOCUMENT[type]}
                    {dejaEmis.has(type) && (
                      <span className="ml-1.5 text-xs opacity-60">déjà émis</span>
                    )}
                  </Button>
                ))}
              </div>

              {formulaire && (
                <form
                  action={(donnees) => {
                    donnees.set('type', formulaire);
                    void envoyer('emission', emettreDocumentFinancier, donnees, () =>
                      setFormulaire(null),
                    );
                  }}
                  className="grid gap-3 rounded-md border p-3 sm:grid-cols-3"
                >
                  <div className="space-y-1 sm:col-span-1">
                    <Label htmlFor="offreId" className="text-xs">
                      Offre approuvée
                    </Label>
                    <select
                      id="offreId"
                      name="offreId"
                      required
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      {offres.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.numero}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="dateEcheance" className="text-xs">
                      Échéance de règlement
                    </Label>
                    {/* Facultative : une échéance inventée engagerait le client
                        sur une date que personne n'a convenue. */}
                    <Input id="dateEcheance" name="dateEcheance" type="date" className="h-9" />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="notes" className="text-xs">
                      Mention (facultative)
                    </Label>
                    <Input id="notes" name="notes" className="h-9" placeholder="Acompte 30 %…" />
                  </div>

                  <div className="sm:col-span-3">
                    <Button type="submit" size="sm" disabled={enCours === 'emission'}>
                      {enCours === 'emission' && (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      )}
                      Émettre le {LIBELLES_DOCUMENT[formulaire].toLowerCase()}
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-baseline gap-2 text-base">
            Documents émis
            {documents.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground">
                {documents.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun document émis sur cette affaire.
            </p>
          ) : (
            <ul className="divide-y">
              {documents.map((d) => (
                <li key={d.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <Link
                        href={`/documents/${d.id}`}
                        className="flex items-baseline gap-1.5 text-sm font-medium hover:underline"
                      >
                        <FileText className="size-3.5 translate-y-0.5" />
                        {d.numero}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {LIBELLES_DOCUMENT[d.type]}
                      </span>
                      <Badge variant={APPARENCE_STATUT[d.statut] ?? 'neutre'}>
                        {LIBELLES_STATUT_DOCUMENT[d.statut]}
                      </Badge>
                    </div>

                    <span className="tabular-nums text-sm font-medium">
                      {montant(d.totalTtc, d.devise)} TTC
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <span>Émis le {jour(d.dateEmission)}</span>
                    {d.offreNumero && <span>Offre {d.offreNumero}</span>}
                    {d.dateEcheance && <span>Échéance {jour(d.dateEcheance)}</span>}
                    {d.dateReglement && <span>Réglé le {jour(d.dateReglement)}</span>}
                    {d.notes && <span>{d.notes}</span>}
                    {!d.contenu && (
                      <span className="text-destructive">contenu illisible</span>
                    )}
                  </div>

                  {d.statut === 'emis' && (peutRegler || peutEmettre) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Refusé sur un contenu figé illisible : le PDF serait
                          faux, et un document faux chez un client ne se
                          rattrape pas. */}
                      {peutEmettre && d.contenu && (
                        <form
                          action={(donnees) => {
                            donnees.set('documentId', String(d.id));
                            void envoyer(`envoi-${d.id}`, envoyerDocumentAuClient, donnees);
                          }}
                        >
                          <Button
                            type="submit"
                            variant="outline"
                            size="sm"
                            disabled={enCours === `envoi-${d.id}`}
                            title="Produit le PDF et l’envoie au client, en pièce jointe"
                          >
                            {enCours === `envoi-${d.id}` ? (
                              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            ) : (
                              <Send className="mr-1.5 size-3.5" />
                            )}
                            Envoyer le PDF au client
                          </Button>
                        </form>
                      )}

                      {peutRegler && (
                        <form
                          action={(donnees) => {
                            donnees.set('documentId', String(d.id));
                            void envoyer(`regle-${d.id}`, marquerRegle, donnees);
                          }}
                        >
                          <Button
                            type="submit"
                            variant="outline"
                            size="sm"
                            disabled={enCours === `regle-${d.id}`}
                          >
                            {enCours === `regle-${d.id}` ? (
                              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                            ) : (
                              <Check className="mr-1.5 size-3.5" />
                            )}
                            Marquer réglé
                          </Button>
                        </form>
                      )}

                      {peutEmettre &&
                        (annulation === d.id ? (
                          <form
                            action={(donnees) => {
                              donnees.set('documentId', String(d.id));
                              void envoyer(`annule-${d.id}`, annulerDocument, donnees, () =>
                                setAnnulation(null),
                              );
                            }}
                            className="flex flex-wrap items-center gap-2"
                          >
                            {/* Le motif est exigé : un document annulé sans
                                raison laisse le suivant deviner s'il doit le
                                réémettre. */}
                            <Input
                              name="motif"
                              required
                              placeholder="Motif de l’annulation"
                              className="h-8 w-56 text-xs"
                            />
                            <Button
                              type="submit"
                              variant="destructive"
                              size="sm"
                              disabled={enCours === `annule-${d.id}`}
                            >
                              Confirmer
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setAnnulation(null)}
                            >
                              Renoncer
                            </Button>
                          </form>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setAnnulation(d.id)}
                          >
                            <X className="mr-1.5 size-3.5" />
                            Annuler
                          </Button>
                        ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
