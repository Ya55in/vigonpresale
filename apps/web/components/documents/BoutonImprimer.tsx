'use client';

import { Printer } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Impression du document.
 *
 * `window.print()` plutôt qu'une génération PDF côté serveur : le navigateur
 * produit déjà un PDF fidèle depuis la même feuille de style, et l'ajout d'un
 * moteur de rendu ferait vivre deux gabarits qui divergeraient au premier
 * changement de maquette.
 */
export function BoutonImprimer() {
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
      <Printer className="mr-1.5 size-3.5" />
      Imprimer
    </Button>
  );
}
