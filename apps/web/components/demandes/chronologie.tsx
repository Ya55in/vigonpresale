'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import type { CategorieEvenement, EvenementAffaire } from '@/lib/documents/storyline';
import { cn } from '@/lib/utils';

/**
 * Chronologie d'une affaire.
 *
 * DEUX PARTIS PRIS, PRIS APRÈS AVOIR VU L'ÉCRAN
 *
 * La première version affichait les trente-quatre événements du même poids, à
 * la file. Elle était juste et illisible : l'œil n'avait aucune prise, et le
 * fait décisif — le devis est arrivé — se noyait au milieu des manœuvres.
 *
 * 1. Les faits majeurs sont lisibles de loin ; les manœuvres passent en gris
 *    plus petit. Le tri chronologique reste le même, seul le poids change.
 *
 * 2. Les séries se replient. Une affaire produit des rafales — quatre envois
 *    dans la même minute, trois avis de non-remise identiques — qui occupaient
 *    autant de lignes que de faits distincts. Elles tiennent maintenant sur une
 *    ligne dépliable.
 *
 * Le filtrage reste côté client et sans requête : l'historique tient en
 * quelques dizaines de lignes, et un aller-retour serveur par clic rendrait
 * l'écran poussif pour rien.
 */

const FAMILLES: { cle: CategorieEvenement; libelle: string; point: string }[] = [
  { cle: 'demande', libelle: 'Demande', point: 'bg-slate-500' },
  { cle: 'echange', libelle: 'Échanges', point: 'bg-sky-500' },
  { cle: 'consultation', libelle: 'Consultations', point: 'bg-violet-500' },
  { cle: 'devis', libelle: 'Devis et costing', point: 'bg-amber-500' },
  { cle: 'offre', libelle: 'Offre', point: 'bg-emerald-600' },
  { cle: 'document', libelle: 'Documents', point: 'bg-teal-600' },
  { cle: 'support', libelle: 'Support', point: 'bg-rose-500' },
];

const POINTS = Object.fromEntries(FAMILLES.map((f) => [f.cle, f.point])) as Record<
  CategorieEvenement,
  string
>;

const LIBELLES = Object.fromEntries(FAMILLES.map((f) => [f.cle, f.libelle])) as Record<
  CategorieEvenement,
  string
>;

const heure = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

const jour = (iso: string): string =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Série d'événements consécutifs à replier, ou fait isolé.
 *
 * Un seul critère de regroupement, appliqué aux voisins immédiats : même jour,
 * et soit le même intitulé (une rafale du même fait), soit deux manœuvres de la
 * même famille. Deux faits majeurs d'intitulés différents ne se replient jamais
 * — c'est précisément ce qu'on est venu lire.
 */
type Serie = { evenements: EvenementAffaire[]; majeur: boolean };

/**
 * Range les faits d'une même minute par intitulé.
 *
 * Une rafale d'envois produit, en alternance, l'envoi et son avis de
 * non-remise : quatre paires entrelacées, donc jamais deux voisins identiques,
 * donc aucun regroupement possible — huit lignes là où deux suffisent.
 *
 * Les réordonner ne travestit rien : ils portent la même minute, et c'est la
 * minute qui est affichée. L'ordre exact à la milliseconde n'était de toute
 * façon pas lisible à l'écran.
 */
function clusteriserParMinute(evenements: EvenementAffaire[]): EvenementAffaire[] {
  const minuteDe = (iso: string): string => iso.slice(0, 16);
  const sortie: EvenementAffaire[] = [];

  for (let i = 0; i < evenements.length; ) {
    let j = i;
    while (j < evenements.length && minuteDe(evenements[j]!.date) === minuteDe(evenements[i]!.date)) {
      j += 1;
    }

    sortie.push(
      ...evenements.slice(i, j).sort((a, b) => {
        // Les faits décisifs restent en tête de leur minute.
        if (a.importance !== b.importance) return a.importance === 'majeur' ? -1 : 1;
        return a.titre.localeCompare(b.titre, 'fr');
      }),
    );

    i = j;
  }

  return sortie;
}

function regrouper(evenements: EvenementAffaire[]): Serie[] {
  const series: Serie[] = [];

  for (const e of clusteriserParMinute(evenements)) {
    const courante = series.at(-1);
    const precedent = courante?.evenements.at(-1);

    const memeJour = precedent && jour(precedent.date) === jour(e.date);
    const memeIntitule = precedent?.titre === e.titre;
    const deuxManoeuvres =
      precedent?.importance === 'courant' &&
      e.importance === 'courant' &&
      precedent.categorie === e.categorie;

    if (courante && memeJour && (memeIntitule || deuxManoeuvres)) {
      courante.evenements.push(e);
      if (e.importance === 'majeur') courante.majeur = true;
      continue;
    }

    series.push({ evenements: [e], majeur: e.importance === 'majeur' });
  }

  return series;
}

/** Vrai quand toute la série répète le même fait. */
const memeFait = (serie: Serie): boolean =>
  serie.evenements.every((e) => e.titre === serie.evenements[0]!.titre);

/** Intitulé d'une série repliée : le fait répété, ou le nombre de manœuvres. */
function resumer(serie: Serie): string {
  const premier = serie.evenements[0];
  if (!premier) return '';

  return memeFait(serie)
    ? premier.titre
    : `${serie.evenements.length} étapes — ${LIBELLES[premier.categorie]?.toLowerCase() ?? ''}`.trim();
}

/**
 * Un fait répété tient sur une ligne, ses variantes en enfilade.
 *
 * Quatre demandes de devis partent ensemble, une par marque. Les replier
 * cacherait justement ce qui les distingue ; les laisser sur quatre lignes
 * répète trois fois le même intitulé. Une ligne et la liste des marques dit
 * tout, et plus court.
 */
function fusionner(serie: Serie): EvenementAffaire {
  const premier = serie.evenements[0]!;

  const details = [...new Set(serie.evenements.map((e) => e.detail).filter(Boolean))] as string[];
  const acteurs = new Set(serie.evenements.map((e) => e.acteur));

  const joint = details.join(' · ');

  return {
    ...premier,
    // Au-delà d'une ligne, la liste dessert : on annonce le reste au compteur.
    detail:
      details.length === 0
        ? null
        : joint.length <= 100
          ? joint
          : `${details.slice(0, 3).join(' · ')} +${details.length - 3}`,
    // Un acteur commun se dit une fois ; des acteurs différents ne se résument
    // pas, et l'afficher au hasard serait faux.
    acteur: acteurs.size === 1 ? premier.acteur : null,
  };
}

function Compteur({ n }: { n: number }) {
  return (
    <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
      ×{n}
    </span>
  );
}

function Ligne({
  e,
  majeur,
  compte,
}: {
  e: EvenementAffaire;
  majeur: boolean;
  compte?: number;
}) {
  return (
    <div className="flex gap-3">
      <span
        className={cn(
          'shrink-0 tabular-nums text-muted-foreground',
          majeur ? 'w-11 pt-0.5 text-xs' : 'w-11 text-[11px]',
        )}
      >
        {heure(e.date)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {e.lien ? (
            <Link
              href={e.lien}
              className={cn(
                'hover:underline',
                majeur ? 'text-sm font-medium' : 'text-[13px] text-muted-foreground',
              )}
            >
              {e.titre}
            </Link>
          ) : (
            <span
              className={cn(majeur ? 'text-sm font-medium' : 'text-[13px] text-muted-foreground')}
            >
              {e.titre}
            </span>
          )}

          {compte && compte > 1 ? <Compteur n={compte} /> : null}

          {e.acteur && (
            <span className={cn('text-muted-foreground', majeur ? 'text-xs' : 'text-[11px]')}>
              {e.acteur}
            </span>
          )}
        </div>

        {e.detail && (
          <p
            className={cn(
              'break-words text-muted-foreground',
              majeur ? 'text-xs' : 'text-[11px] opacity-80',
            )}
          >
            {e.detail}
          </p>
        )}
      </div>
    </div>
  );
}

function SerieRepliee({ serie }: { serie: Serie }) {
  const [ouverte, setOuverte] = useState(false);
  const n = serie.evenements.length;
  const dernier = serie.evenements.at(-1)!;
  const premier = serie.evenements[0]!;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOuverte((v) => !v)}
        aria-expanded={ouverte}
        className="flex w-full items-baseline gap-3 text-left"
      >
        <span className="w-11 shrink-0 tabular-nums text-[11px] text-muted-foreground">
          {/* Une rafale s'étale : montrer les deux bornes évite de croire que
              tout est arrivé à la seconde affichée. */}
          {heure(dernier.date) === heure(premier.date)
            ? heure(premier.date)
            : `${heure(dernier.date)}`}
        </span>

        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ChevronRight
            className={cn('size-3 shrink-0 transition-transform', ouverte && 'rotate-90')}
          />
          <span className="truncate">{resumer(serie)}</span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
            {n}
          </span>
        </span>
      </button>

      {ouverte && (
        <div className="mt-2 space-y-2 border-l pl-3">
          {serie.evenements.map((e, i) => (
            <Ligne key={`${e.date}-${i}`} e={e} majeur={false} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ChronologieAffaire({ evenements }: { evenements: EvenementAffaire[] }) {
  // Aucune famille cochée = tout est montré. C'est le cas d'entrée le plus
  // fréquent, et il évite d'avoir à décocher six cases pour isoler la septième.
  const [actives, setActives] = useState<Set<CategorieEvenement>>(new Set());

  const basculer = (cle: CategorieEvenement): void => {
    setActives((precedent) => {
      const suivant = new Set(precedent);
      if (suivant.has(cle)) suivant.delete(cle);
      else suivant.add(cle);
      return suivant;
    });
  };

  const comptes = useMemo(() => {
    const c = new Map<CategorieEvenement, number>();
    for (const e of evenements) c.set(e.categorie, (c.get(e.categorie) ?? 0) + 1);
    return c;
  }, [evenements]);

  const visibles = useMemo(
    () => (actives.size === 0 ? evenements : evenements.filter((e) => actives.has(e.categorie))),
    [evenements, actives],
  );

  const parJour = useMemo(() => {
    const groupes: { jour: string; series: Serie[] }[] = [];
    for (const serie of regrouper(visibles)) {
      const cle = jour(serie.evenements[0]!.date);
      const dernier = groupes.at(-1);
      if (dernier?.jour === cle) dernier.series.push(serie);
      else groupes.push({ jour: cle, series: [serie] });
    }
    return groupes;
  }, [visibles]);

  if (evenements.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        Rien ne s’est encore passé sur cette affaire.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setActives(new Set())}
          aria-pressed={actives.size === 0}
          className={cn(
            'rounded-full px-2.5 py-1 text-xs transition-colors',
            actives.size === 0
              ? 'bg-foreground text-background'
              : 'bg-muted/60 text-muted-foreground hover:text-foreground',
          )}
        >
          Tout {evenements.length}
        </button>

        {FAMILLES.filter((f) => comptes.has(f.cle)).map((f) => {
          const actif = actives.has(f.cle);
          return (
            <button
              key={f.cle}
              type="button"
              onClick={() => basculer(f.cle)}
              aria-pressed={actif}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
                actif
                  ? 'bg-foreground text-background'
                  : 'bg-muted/60 text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('size-1.5 rounded-full', f.point)} />
              {f.libelle}
              <span className="tabular-nums opacity-60">{comptes.get(f.cle)}</span>
            </button>
          );
        })}
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          Aucun événement dans les familles retenues.
        </p>
      ) : (
        <div className="space-y-5">
          {parJour.map((groupe) => (
            <section key={groupe.jour} className="grid gap-2 sm:grid-cols-[7.5rem_1fr]">
              {/* La date en marge plutôt qu'en travers : elle situe sans couper
                  le fil, et l'œil descend la colonne des faits d'un trait. */}
              <h2 className="pt-0.5 text-xs text-muted-foreground sm:text-right">
                {groupe.jour}
              </h2>

              <div className="space-y-2.5 border-l pl-4">
                {groupe.series.map((serie, i) => {
                  const premier = serie.evenements[0]!;
                  const n = serie.evenements.length;
                  const cle = `${premier.date}-${i}`;

                  // Le même fait répété tient sur une ligne, quel que soit son
                  // poids : ce qui le distingue est dans le détail fusionné,
                  // rien n'est caché, donc rien à déplier.
                  if (n > 1 && memeFait(serie)) {
                    return (
                      <div key={cle} className="relative">
                        {serie.majeur && (
                          <span
                            className={cn(
                              'absolute -left-[1.32rem] top-1.5 size-2 rounded-full ring-4 ring-background',
                              POINTS[premier.categorie] ?? 'bg-slate-400',
                            )}
                            aria-hidden
                          />
                        )}
                        <Ligne e={fusionner(serie)} majeur={serie.majeur} compte={n} />
                      </div>
                    );
                  }

                  // Des manœuvres différentes : là, replier cache vraiment
                  // quelque chose, donc la ligne se déplie.
                  if (n > 1 && !serie.majeur) return <SerieRepliee key={cle} serie={serie} />;

                  return (
                    <div key={cle} className="relative">
                      {serie.majeur && (
                        <span
                          className={cn(
                            'absolute -left-[1.32rem] top-1.5 size-2 rounded-full ring-4 ring-background',
                            POINTS[premier.categorie] ?? 'bg-slate-400',
                          )}
                          aria-hidden
                        />
                      )}

                      {n > 1 ? (
                        <div className="space-y-1.5">
                          {serie.evenements.map((e, j) => (
                            <Ligne key={`${e.date}-${j}`} e={e} majeur={e.importance === 'majeur'} />
                          ))}
                        </div>
                      ) : (
                        <Ligne e={premier} majeur={premier.importance === 'majeur'} />
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
