'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { definirMotDePasse, type Resultat } from './actions';

function BoutonSoumettre() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Enregistrement…' : 'Activer mon accès'}
    </Button>
  );
}

export function FormulaireMotDePasse() {
  const [etat, action] = useActionState<Resultat | null, FormData>(
    definirMotDePasse,
    null,
  );

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="motDePasse">Mot de passe</Label>
        <Input
          id="motDePasse"
          name="motDePasse"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-describedby="aide-mot-de-passe"
        />
        <p id="aide-mot-de-passe" className="text-xs text-muted-foreground">
          12 caractères minimum.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="confirmation">Confirmer le mot de passe</Label>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
        />
      </div>

      {etat && !etat.ok && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{etat.message}</AlertDescription>
        </Alert>
      )}

      <BoutonSoumettre />
    </form>
  );
}
