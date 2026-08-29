'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Check, Sparkles } from 'lucide-react';

import {
  proposerFournisseurs,
  type ResultatProposition,
} from '@/app/(dashboard)/demandes/[id]/consultations/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Au-delà, le fournisseur a déjà chiffré ce produit, pas seulement son domaine. */
const SEUIL_CERTAIN = 0.85;

type Propose = Extract<ResultatProposition, { ok: true }>['fournisseurs'][number];

type Props = {
  demandeId: number;
  /** Rendu inerte quand la demande n'est plus au stade de la préparation. */
  modifiable: boolean;
  /** Prépare les consultations sur la sélection ; vide = tout ce qui est résolu. */
  onPreparer: (fournisseurIds: number[]) => void;
  enCours: boolean;
};

/**
 * Fournisseurs proposés pour un besoin, et sélection de ceux à consulter.
 *
 * La proposition vient de ce que chacun a déjà chiffré, pas de sa fiche : un
 * fournisseur ayant coté des bornes WiFi remonte sur un besoin WiFi même quand
 * sa marque déclarée est autre — ce que la résolution par marque manque.
 *
 * Rien n'est présélectionné. Le classement ordonne, il ne décide pas : un
 * fournisseur pertinent peut être écarté pour des raisons que la plateforme
 * ignore, un litige en cours ou une relation commerciale à ménager.
 */
export function PropositionFournisseurs({
  demandeId,
  modifiable,
  onPreparer,
  enCours,
}: Props) {
  const [resultat, setResultat] = useState<ResultatProposition | null>(null);
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [recherche, lancerRecherche] = useTransition();

  const chercher = () => {
    lancerRecherche(async () => {
      setResultat(await proposerFournisseurs(demandeId));
      setChoisis(new Set());
    });
  };

  const basculer = (nom: string) => {
    setChoisis((s) => {
      const suivant = new Set(s);
      if (suivant.has(nom)) suivant.delete(nom);
      else suivant.add(nom);
      return suivant;
    });
  };

  const proposes = resultat?.ok ? resultat.fournisseurs : [];

  const idsChoisis = proposes
    .filter((f) => choisis.has(f.nom))
    .flatMap((f) => f.fournisseurIds);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-muted-foreground" />
            Fournisseurs suggérés
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            D&apos;après ce que chacun a déjà chiffré, et non sa marque déclarée.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={chercher}
          disabled={recherche || !modifiable}
        >
          {recherche ? 'Recherche…' : resultat ? 'Relancer' : 'Chercher'}
        </Button>
      </CardHeader>

      {resultat && (
        <CardContent className="space-y-3">
          {!resultat.ok && (
            <p className="text-sm text-destructive">{resultat.message}</p>
          )}

          {resultat.ok && resultat.indisponible && (
            <p className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
              Aucun historique exploitable pour l&apos;instant. La suggestion
              s&apos;alimente des devis déjà reçus — utilisez la préparation
              classique, qui résout les fournisseurs par marque.
            </p>
          )}

          {resultat.ok && !resultat.indisponible && proposes.length === 0 && (
            <p className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
              Aucun fournisseur connu ne couvre ce besoin. La préparation
              classique lancera le sourcing web sur les marques demandées.
            </p>
          )}

          {proposes.map((f) => (
            <LigneFournisseur
              key={f.nom}
              fournisseur={f}
              choisi={choisis.has(f.nom)}
              modifiable={modifiable}
              onBasculer={() => basculer(f.nom)}
            />
          ))}

          {resultat.ok && resultat.articlesNonCouverts.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900 dark:text-amber-200">
                <AlertTriangle className="size-3.5" />
                {resultat.articlesNonCouverts.length} article(s) qu&apos;aucun
                fournisseur connu ne couvre
              </p>
              <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                {resultat.articlesNonCouverts.join(' · ')}
              </p>
              {resultat.marquesASourcer.length > 0 && (
                <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300">
                  Aucun devis passé sur {resultat.marquesASourcer.join(', ')} —
                  c&apos;est le cas normal d&apos;une première consultation sur
                  ces marques.{' '}
                  <button
                    type="button"
                    className="font-medium underline underline-offset-2 disabled:no-underline disabled:opacity-60"
                    disabled={enCours || !modifiable}
                    onClick={() => onPreparer([])}
                  >
                    Lancer le sourcing web
                  </button>{' '}
                  ira chercher un distributeur pour chacune.
                </p>
              )}
            </div>
          )}

          {proposes.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
              <Button
                type="button"
                size="sm"
                disabled={idsChoisis.length === 0 || enCours || !modifiable}
                onClick={() => onPreparer(idsChoisis)}
              >
                {enCours
                  ? 'Préparation…'
                  : `Consulter ${choisis.size} fournisseur(s) retenu(s)`}
              </Button>
              <p className="text-xs text-muted-foreground">
                Seules les marques de ces fournisseurs seront consultées.
              </p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function LigneFournisseur({
  fournisseur: f,
  choisi,
  modifiable,
  onBasculer,
}: {
  fournisseur: Propose;
  choisi: boolean;
  modifiable: boolean;
  onBasculer: () => void;
}) {
  const certains = f.articlesCouverts.filter((a) => a.similarite >= SEUIL_CERTAIN);

  return (
    <button
      type="button"
      onClick={onBasculer}
      disabled={!modifiable}
      aria-pressed={choisi}
      className={cn(
        'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
        choisi ? 'border-primary bg-primary/5' : 'hover:border-input',
        !modifiable && 'cursor-default opacity-70',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded border',
              choisi ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
            )}
          >
            {choisi && <Check className="size-3" />}
          </span>
          <span className="font-medium">{f.nom}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Fiabilite fiabilite={f.fiabilite} />
          {certains.length > 0 && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {certains.length} déjà chiffré(s)
            </Badge>
          )}
          <span className="text-sm tabular-nums text-muted-foreground">
            {f.articlesCouverts.length} / {f.articlesDemandes}
          </span>
        </div>
      </div>

      {/* La justification plutôt qu'un score seul : sans elle, on ne sait pas
          si le classement mérite confiance. */}
      <ul className="mt-2 space-y-0.5 pl-6">
        {f.articlesCouverts.slice(0, 3).map((a) => (
          <li key={a.designation} className="text-xs text-muted-foreground">
            <span
              className={cn(
                'tabular-nums',
                a.similarite >= SEUIL_CERTAIN && 'text-emerald-700 dark:text-emerald-400',
              )}
            >
              {(a.similarite * 100).toFixed(0)} %
            </span>{' '}
            {a.designation}
            <span className="opacity-70"> ← a chiffré « {a.preuve} »</span>
          </li>
        ))}
        {f.articlesCouverts.length > 3 && (
          <li className="text-xs text-muted-foreground/70">
            et {f.articlesCouverts.length - 3} autre(s)
          </li>
        )}
      </ul>
    </button>
  );
}

/**
 * Comportement passé, affiché à côté de la pertinence sans s'y mêler.
 *
 * La pertinence dit qui SAIT fournir, ceci dit qui RÉPOND. Les fondre en un
 * score unique rendrait le classement inexplicable — on ne saurait plus si un
 * fournisseur est mal placé parce qu'il ne sait pas fournir ou parce qu'il ne
 * répond pas. Ce badge laisse l'arbitrage à l'humain.
 */
function Fiabilite({ fiabilite }: { fiabilite: Propose['fiabilite'] }) {
  // Jamais consulté n'est pas un mauvais taux : c'est une absence de donnée, et
  // afficher « 0 % » condamnerait tout nouveau fournisseur.
  if (!fiabilite || fiabilite.consultations === 0 || fiabilite.tauxReponse === null) {
    return (
      <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
        jamais consulté
      </Badge>
    );
  }

  const pourcent = Math.round(fiabilite.tauxReponse * 100);
  const faible = fiabilite.tauxReponse < 0.5;

  return (
    <Badge
      variant={faible ? 'attention' : 'secondary'}
      className="px-1.5 py-0 text-[10px] font-normal"
      title={
        `${fiabilite.reponses} réponse(s) sur ${fiabilite.consultations} consultation(s)` +
        (fiabilite.delaiMoyenHeures !== null
          ? ` — délai moyen ${Math.round(fiabilite.delaiMoyenHeures)} h`
          : '')
      }
    >
      répond {pourcent} %
    </Badge>
  );
}
