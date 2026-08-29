'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, Loader2, Plus, RotateCcw } from 'lucide-react';

import {
  changerStatutTicket,
  ouvrirTicket,
  type Resultat,
} from '@/app/(dashboard)/apres-vente/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  LIBELLES_PRIORITE_SAV,
  LIBELLES_STATUT_SAV,
  PRIORITES_SAV,
  type TicketSav,
} from '@/lib/sav/requetes';
import { cn } from '@/lib/utils';

type Props = {
  tickets: TicketSav[];
  affaires: { id: number; code: string; titre: string | null }[];
  modifiable: boolean;
};

/** Une priorité haute doit se repérer sans lire : la couleur porte l'urgence. */
const APPARENCE_PRIORITE: Record<string, string> = {
  critique: 'bg-destructive/10 text-destructive border-destructive/30',
  haute: 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400',
  normale: '',
  basse: 'text-muted-foreground',
};

/**
 * Suivi des demandes de support après-vente.
 *
 * Les tickets ouverts remontent, par priorité décroissante : c'est la file de
 * travail. Les traités restent visibles en dessous — ils constituent
 * l'historique du support sur une affaire, et les masquer priverait
 * l'après-vente du contexte au prochain appel du même client.
 */
export function SuiviTickets({ tickets, affaires, modifiable }: Props) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<Resultat | null>(null);
  const [ouverture, setOuverture] = useState(false);

  async function envoyer(
    cle: string,
    action: (etat: Resultat | null, donnees: FormData) => Promise<Resultat>,
    donnees: FormData,
    apres?: () => void,
  ): Promise<void> {
    setEnCours(cle);
    setRetour(null);

    const resultat = await action(null, donnees);

    setEnCours(null);
    setRetour(resultat);
    if (resultat.ok) {
      apres?.();
      router.refresh();
    }
  }

  const ouverts = tickets.filter((t) => t.statut !== 'traite');

  return (
    <div className="space-y-4">
      {retour && (
        <p
          role="status"
          className={
            retour.ok
              ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300'
              : 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'
          }
        >
          {retour.message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {ouverts.length} en cours sur {tickets.length} ticket(s)
        </p>
        {modifiable && !ouverture && (
          <Button size="sm" onClick={() => setOuverture(true)}>
            <Plus className="size-4" />
            Ouvrir un ticket
          </Button>
        )}
      </div>

      {ouverture && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nouvelle demande de support</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void envoyer('ouvrir', ouvrirTicket, new FormData(e.currentTarget), () =>
                  setOuverture(false),
                );
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="objet">Objet *</Label>
                <Input
                  id="objet"
                  name="objet"
                  required
                  maxLength={300}
                  placeholder="Borne WiFi hors service en chambre 214"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="demandeId">Affaire concernée</Label>
                  <select
                    id="demandeId"
                    name="demandeId"
                    defaultValue=""
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {/* Facultatif : un client peut appeler pour un matériel
                        livré avant la plateforme. */}
                    <option value="">Aucune / hors plateforme</option>
                    {affaires.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} — {a.titre ?? 'sans titre'}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="priorite">Priorité</Label>
                  <select
                    id="priorite"
                    name="priorite"
                    defaultValue="normale"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {PRIORITES_SAV.map((p) => (
                      <option key={p} value={p}>
                        {LIBELLES_PRIORITE_SAV[p]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" rows={3} maxLength={5000} />
              </div>

              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={enCours !== null}>
                  {enCours === 'ouvrir' && <Loader2 className="size-4 animate-spin" />}
                  Ouvrir
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setOuverture(false)}
                >
                  Annuler
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {tickets.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
          Aucune demande de support enregistrée.
        </p>
      ) : (
        <ul className="space-y-2">
          {tickets.map((t) => (
            <LigneTicket
              key={t.id}
              ticket={t}
              modifiable={modifiable}
              enCours={enCours}
              onChanger={(statut, resolution) => {
                const fd = new FormData();
                fd.set('id', String(t.id));
                fd.set('statut', statut);
                if (resolution) fd.set('resolution', resolution);
                void envoyer(`statut-${t.id}`, changerStatutTicket, fd);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LigneTicket({
  ticket: t,
  modifiable,
  enCours,
  onChanger,
}: {
  ticket: TicketSav;
  modifiable: boolean;
  enCours: string | null;
  onChanger: (statut: 'traite' | 'rouvert', resolution?: string) => void;
}) {
  const [resolution, setResolution] = useState('');
  const [cloture, setCloture] = useState(false);

  const traite = t.statut === 'traite';

  return (
    <li className={cn('rounded-lg border p-3', traite && 'bg-muted/30')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{t.numero}</span>
            <span className={cn('font-medium', traite && 'text-muted-foreground')}>
              {t.objet}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              t.clientNom,
              t.demandeCode,
              new Date(t.dateOuverture).toLocaleDateString('fr-FR'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!traite && (
            <Badge variant="outline" className={cn('text-[10px]', APPARENCE_PRIORITE[t.priorite])}>
              {LIBELLES_PRIORITE_SAV[t.priorite]}
            </Badge>
          )}
          <Badge variant={traite ? 'secondary' : 'attention'} className="text-[10px]">
            {LIBELLES_STATUT_SAV[t.statut]}
          </Badge>
        </div>
      </div>

      {t.description && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
          {t.description}
        </p>
      )}

      {t.resolution && (
        <p className="mt-2 rounded-md border bg-background px-3 py-2 text-sm">
          <span className="text-xs text-muted-foreground">Résolution — </span>
          {t.resolution}
        </p>
      )}

      {modifiable && (
        <div className="mt-2.5 border-t pt-2.5">
          {traite ? (
            <Button
              variant="outline"
              size="sm"
              disabled={enCours !== null}
              onClick={() => onChanger('rouvert')}
            >
              {enCours === `statut-${t.id}` ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Rouvrir
            </Button>
          ) : cloture ? (
            <div className="space-y-2">
              <Textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Ce qui a été fait — sert au prochain appel du même client."
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={enCours !== null}
                  onClick={() => onChanger('traite', resolution)}
                >
                  {enCours === `statut-${t.id}` && <Loader2 className="size-4 animate-spin" />}
                  Confirmer
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCloture(false)}>
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setCloture(true)}>
              <Check className="size-4" />
              Marquer traité
            </Button>
          )}
        </div>
      )}
    </li>
  );
}
