'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FileText, Loader2, Save } from 'lucide-react';

import {
  enregistrerConditionOffre,
  type Resultat,
} from '@/app/(dashboard)/admin/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export type ChampCondition = 'livraison' | 'paiement' | 'garantie';

export type ConditionAffichee = {
  champ: ChampCondition;
  valeur: string;
};

const LIBELLES: Record<ChampCondition, { titre: string; aide: string }> = {
  livraison: {
    titre: 'Livraison',
    aide: 'Délai annoncé au client, en pied d’offre.',
  },
  paiement: {
    titre: 'Paiement',
    aide: 'Conditions de règlement proposées par défaut.',
  },
  garantie: {
    titre: 'Garantie',
    aide: 'Couverture annoncée sur le matériel proposé.',
  },
};

/**
 * Conditions commerciales figurant au pied de chaque offre.
 *
 * Elles sont gelées dans l'offre au moment de sa génération : le texte modifié
 * ici ne réécrit aucune offre déjà transmise. C'est dit à l'écran, sans quoi on
 * pourrait croire qu'un changement rétroagit sur les dossiers en cours.
 */
export function ConditionsOffre({ conditions }: { conditions: ConditionAffichee[] }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<Resultat | null>(null);

  async function envoyer(champ: ChampCondition, valeur: string): Promise<void> {
    const fd = new FormData();
    fd.set('champ', champ);
    fd.set('valeur', valeur);

    setEnCours(champ);
    setRetour(null);
    const resultat = await enregistrerConditionOffre(null, fd);
    setEnCours(null);
    setRetour(resultat);
    if (resultat.ok) router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="size-4" />
          Conditions commerciales des offres
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Reprises au pied de chaque offre. Une offre déjà générée conserve les
          conditions en vigueur au moment de sa création.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {conditions.map((condition) => (
          <form
            key={condition.champ}
            className="space-y-2 border-b pb-4 last:border-0 last:pb-0"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void envoyer(condition.champ, String(fd.get('valeur') ?? ''));
            }}
          >
            <div>
              <label
                htmlFor={`condition-${condition.champ}`}
                className="text-sm font-medium"
              >
                {LIBELLES[condition.champ].titre}
              </label>
              <p className="text-xs text-muted-foreground">
                {LIBELLES[condition.champ].aide}
              </p>
            </div>

            <Textarea
              id={`condition-${condition.champ}`}
              name="valeur"
              rows={2}
              required
              minLength={3}
              maxLength={500}
              defaultValue={condition.valeur}
            />

            <Button type="submit" variant="outline" size="sm" disabled={enCours !== null}>
              {enCours === condition.champ ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Enregistrer
            </Button>
          </form>
        ))}
      </CardContent>
    </Card>
  );
}
