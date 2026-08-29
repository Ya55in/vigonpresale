import { redirect } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';
import { LogoVigon } from '@/components/marque/logo-vigon';
import { createClient } from '@/lib/supabase/server';

import { FormulaireMotDePasse } from './formulaire';

/**
 * Choix du mot de passe après une invitation.
 *
 * La session provient du lien à usage unique : sans elle, il n'y a rien à
 * activer et l'écran renvoie vers la connexion plutôt que d'afficher un
 * formulaire qui échouerait à l'envoi.
 */
export default async function DefinirMotDePassePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?erreur=echange');

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3">
          <LogoVigon largeur={168} priority />
          <CardDescription>
            Choisissez votre mot de passe pour activer votre accès
            {user.email ? ` — ${user.email}` : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormulaireMotDePasse />
        </CardContent>
      </Card>
    </main>
  );
}
