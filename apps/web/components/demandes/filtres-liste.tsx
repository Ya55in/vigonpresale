'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ORDRE_STATUTS, STATUTS } from '@/lib/demandes/statuts';

/**
 * Filtres de la liste, portés par l'URL.
 *
 * L'état vit dans les searchParams et non dans le composant : une vue filtrée
 * reste partageable par simple copie du lien, et le retour navigateur fonctionne.
 */
export function FiltresListe() {
  const router = useRouter();
  const params = useSearchParams();
  const [enCours, demarrerTransition] = useTransition();

  const recherche = params.get('q') ?? '';
  const statut = params.get('statut') ?? '';
  const tri = params.get('tri') ?? 'recent';

  function appliquer(modifs: Record<string, string>): void {
    const suivants = new URLSearchParams(params.toString());

    for (const [cle, valeur] of Object.entries(modifs)) {
      if (valeur) suivants.set(cle, valeur);
      else suivants.delete(cle);
    }
    // Tout changement de filtre invalide la pagination courante.
    suivants.delete('page');

    demarrerTransition(() => {
      router.push(`/demandes?${suivants.toString()}`);
    });
  }

  const aDesFiltres = Boolean(recherche || statut || tri !== 'recent');

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const champ = new FormData(e.currentTarget).get('q');
        appliquer({ q: typeof champ === 'string' ? champ.trim() : '' });
      }}
    >
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          name="q"
          defaultValue={recherche}
          placeholder="Code, titre ou e-mail…"
          className="pl-8"
          aria-label="Rechercher une demande"
        />
      </div>

      <select
        value={statut}
        onChange={(e) => appliquer({ statut: e.target.value })}
        aria-label="Filtrer par statut"
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">Tous les statuts</option>
        {ORDRE_STATUTS.map((s) => (
          <option key={s} value={s}>
            {STATUTS[s].libelle}
          </option>
        ))}
      </select>

      <select
        value={tri}
        onChange={(e) => appliquer({ tri: e.target.value })}
        aria-label="Trier"
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="recent">Plus récentes</option>
        <option value="ancien">Plus anciennes</option>
        <option value="deadline">Échéance proche</option>
      </select>

      {aDesFiltres && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => demarrerTransition(() => router.push('/demandes'))}
        >
          <X className="size-4" />
          Réinitialiser
        </Button>
      )}

      {enCours && (
        <span className="text-xs text-muted-foreground">Chargement…</span>
      )}
    </form>
  );
}
