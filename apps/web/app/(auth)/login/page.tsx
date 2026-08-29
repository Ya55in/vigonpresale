import { redirect } from 'next/navigation';
import { AlertCircle } from 'lucide-react';

import { getUtilisateurCourant } from '@/lib/auth/session';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LoginForm } from './login-form';
import { LogoVigon } from '@/components/marque/logo-vigon';

const MESSAGES_ERREUR: Record<string, string> = {
  // Le cas le plus fréquent n'est pas un incident passager mais un fournisseur
  // jamais activé côté Supabase. « Réessayez » envoyait alors l'utilisateur
  // recommencer une action qui ne peut pas aboutir.
  oauth:
    "Connexion Google indisponible : le fournisseur n'est pas activé sur ce projet Supabase. Utilisez votre mot de passe.",
  non_autorise:
    "Ce compte n'est rattaché à aucun utilisateur Vigon. Contactez un administrateur pour être invité.",
  desactive: 'Ce compte est désactivé. Contactez un administrateur.',
  echange: 'Le lien de connexion est expiré ou invalide. Réessayez.',
  invitation:
    "Ce lien d'invitation a expiré ou a déjà été utilisé. Demandez à un administrateur de vous le renvoyer.",
};

export default async function LoginPage(
  props: {
    searchParams: Promise<{ redirectTo?: string; erreur?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  // Seul un profil applicatif valide justifie de sauter la page de connexion.
  if (await getUtilisateurCourant()) redirect('/');

  const redirectTo = searchParams.redirectTo ?? '/';
  const erreur = searchParams.erreur
    ? (MESSAGES_ERREUR[searchParams.erreur] ?? 'Connexion impossible.')
    : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3">
          <LogoVigon largeur={168} priority />
          <CardDescription>
            Connectez-vous pour accéder à la plateforme avant-vente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {erreur ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{erreur}</AlertDescription>
            </Alert>
          ) : null}
          <LoginForm redirectTo={redirectTo} />
        </CardContent>
      </Card>
    </main>
  );
}
