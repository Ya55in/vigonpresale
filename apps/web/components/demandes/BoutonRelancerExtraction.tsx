'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { relancerExtraction, type Resultat } from '@/app/(dashboard)/demandes/[id]/actions';

function Bouton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      <RotateCcw className={pending ? 'size-4 animate-spin' : 'size-4'} />
      {pending ? 'Relance…' : "Relancer l'extraction"}
    </Button>
  );
}

/**
 * Sort une demande de l'état `bloquee`.
 *
 * Placé dans l'alerte de blocage, au plus près du motif : le motif explique
 * pourquoi la demande s'est arrêtée, ce bouton dit qu'on peut y revenir. Séparés,
 * l'un se lit comme un constat définitif.
 *
 * Le retour est affiché tel quel — y compris le refus sur une demande sans
 * contenu, qui n'est pas une erreur mais une information : celle-là se complète
 * à la main, la relancer ne changerait rien.
 */
export function BoutonRelancerExtraction({ demandeId }: { demandeId: number }) {
  const [etat, action] = useActionState<Resultat | null, FormData>(
    relancerExtraction,
    null,
  );

  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="demandeId" value={demandeId} />
      <Bouton />
      {etat && (
        <p
          role="status"
          className={etat.ok ? 'text-sm font-medium' : 'text-sm font-medium opacity-90'}
        >
          {etat.message}
        </p>
      )}
    </form>
  );
}
