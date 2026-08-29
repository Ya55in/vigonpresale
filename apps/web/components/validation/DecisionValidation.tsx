'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

import {
  approuverGeneration,
  refuserGeneration,
  type ResultatDecision,
} from '@/app/validation/[token]/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

type Validation = {
  demandeCode: string | null;
  clientNom: string | null;
  objet: string | null;
  totalHt: number;
  totalTtc: number;
  margePct: number | null;
  statut: string;
  expiree: boolean;
  decidable: boolean;
};

type Props = {
  token: string;
  validation: Validation;
};

const montant = (v: number, devise = 'MAD'): string =>
  `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;

/**
 * Décision d'approbation, prise depuis le lien reçu.
 *
 * Les deux issues ne sont pas symétriques : approuver est un clic, refuser
 * exige un motif. Un refus sans raison obligerait l'avant-vente à deviner ce
 * qu'il faut corriger avant de resoumettre, et le circuit tournerait en rond.
 */
export function DecisionValidation({ token, validation }: Props) {
  const [retour, setRetour] = useState<ResultatDecision | null>(null);
  const [refus, setRefus] = useState(false);
  const [enCours, lancer] = useTransition();

  // Une décision rendue dans cette session : l'écran ne se recharge pas
  // forcément, et laisser les boutons actifs inviterait à recliquer.
  const decide = retour?.ok === true;

  return (
    <div className="mt-6 space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <dl className="space-y-2 text-sm">
            {validation.demandeCode && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Affaire</dt>
                <dd className="font-mono">{validation.demandeCode}</dd>
              </div>
            )}
            {validation.clientNom && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Client</dt>
                <dd className="font-medium">{validation.clientNom}</dd>
              </div>
            )}
            {validation.objet && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Objet</dt>
                <dd className="text-right">{validation.objet}</dd>
              </div>
            )}
          </dl>

          <div className="space-y-2 border-t pt-3">
            <div className="flex justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Montant HT</span>
              <span className="tabular-nums">{montant(validation.totalHt)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="font-medium">Montant TTC</span>
              <span className="text-lg font-semibold tabular-nums">
                {montant(validation.totalTtc)}
              </span>
            </div>
            {validation.margePct !== null && (
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Marge globale</span>
                <span className="tabular-nums">{validation.margePct.toFixed(1)} %</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {retour && (
        <p
          role="status"
          className={
            retour.ok
              ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800 dark:text-emerald-300'
              : 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive'
          }
        >
          {retour.message}
        </p>
      )}

      {validation.expiree && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Cette demande est caduque faute de réponse. Demandez à
          l&apos;avant-vente d&apos;en émettre une nouvelle.
        </p>
      )}

      {!validation.decidable && !validation.expiree && !decide && (
        <p className="rounded-md border px-3 py-2.5 text-sm text-muted-foreground">
          Une décision a déjà été prise sur cette demande.
        </p>
      )}

      {validation.decidable && !decide && (
        <>
          {refus ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const donnees = new FormData(e.currentTarget);
                lancer(async () => {
                  setRetour(await refuserGeneration(token, null, donnees));
                });
              }}
            >
              <label className="block space-y-1">
                <span className="text-sm font-medium">Motif du refus</span>
                <Textarea
                  name="motif"
                  rows={3}
                  required
                  maxLength={1000}
                  placeholder="Ce qu'il faut corriger avant de resoumettre — marge insuffisante, délai intenable, prix à renégocier…"
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" variant="destructive" disabled={enCours}>
                  {enCours ? 'Envoi…' : 'Confirmer le refus'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setRefus(false)}>
                  Annuler
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={enCours}
                onClick={() =>
                  lancer(async () => {
                    setRetour(await approuverGeneration(token, null));
                  })
                }
              >
                <Check className="size-4" />
                {enCours ? 'Enregistrement…' : 'Approuver la génération'}
              </Button>
              <Button variant="outline" disabled={enCours} onClick={() => setRefus(true)}>
                <X className="size-4" />
                Refuser
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            L&apos;offre ne sera pas générée tant que la décision n&apos;est pas
            prise.
          </p>
        </>
      )}
    </div>
  );
}
