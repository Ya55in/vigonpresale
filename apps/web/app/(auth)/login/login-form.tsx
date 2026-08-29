'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  connexionGoogle,
  connexionMotDePasse,
  type EtatConnexion,
} from './actions';

function BoutonSoumettre() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Connexion…' : 'Se connecter'}
    </Button>
  );
}

function BoutonGoogle() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" className="w-full" disabled={pending}>
      {pending ? 'Redirection…' : 'Continuer avec Google'}
    </Button>
  );
}

export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [etat, action] = useActionState<EtatConnexion, FormData>(
    connexionMotDePasse,
    {},
  );

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        <input type="hidden" name="redirectTo" value={redirectTo} />

        <div className="space-y-2">
          <Label htmlFor="email">Adresse e-mail</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="prenom.nom@vigon.ma"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="motDePasse">Mot de passe</Label>
          <Input
            id="motDePasse"
            name="motDePasse"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        {etat.erreur ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{etat.erreur}</AlertDescription>
          </Alert>
        ) : null}

        <BoutonSoumettre />
      </form>

      {/* Conservé même si le fournisseur n'est pas encore activé côté Supabase :
          il le sera. Le message d'erreur nomme la cause exacte, ce qui suffit à
          ne pas faire croire à une panne du service. */}
      <div className="relative">
        <Separator />
        <span className="absolute inset-0 -top-2.5 mx-auto w-fit bg-card px-2 text-xs text-muted-foreground">
          ou
        </span>
      </div>

      <form action={connexionGoogle}>
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <BoutonGoogle />
      </form>
    </div>
  );
}
