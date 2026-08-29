import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FormulaireDevis } from '@/components/consultations/FormulaireDevis';
import { Card, CardContent } from '@/components/ui/card';
import { lireConsultationPublique } from '@/lib/consultations/public';

/**
 * Formulaire de réponse du fournisseur, sans authentification.
 *
 * Hors du groupe `(dashboard)` : ni barre latérale, ni session. Le jeton porte
 * l'autorisation, comme sur la page offre du client.
 */

// Le contenu dépend du jeton et de l'état de la consultation : le mettre en
// cache montrerait un formulaire déjà soumis comme s'il était encore ouvert.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Demande de devis — Vigon Systems',
  // Un lien de formulaire ne doit jamais remonter dans un moteur de recherche.
  robots: { index: false, follow: false },
};

export default async function Page(
  props: {
    params: Promise<{ token: string }>;
  }
) {
  const params = await props.params;
  const consultation = await lireConsultationPublique(params.token);

  // Jeton inconnu et consultation non encore envoyée donnent le même 404 : rien
  // ne doit permettre de distinguer les deux cas depuis l'extérieur.
  if (!consultation || consultation.pasEncoreEnvoyee) notFound();

  return (
    <main className="mx-auto max-w-3xl px-3 py-6 sm:px-4 sm:py-10">
      <header className="mb-6">
        <p className="text-sm text-muted-foreground">Vigon Systems</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Demande de devis
        </h1>
        {consultation.fournisseurNom && (
          <p className="mt-1 text-sm text-muted-foreground">
            À l&apos;attention de {consultation.fournisseurNom}
          </p>
        )}
      </header>

      {consultation.dejaRepondu ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Votre réponse nous est bien parvenue.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Pour la modifier, répondez directement à notre courriel.
            </p>
          </CardContent>
        </Card>
      ) : consultation.articles.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Aucun article à chiffrer sur cette demande. Répondez à notre
              courriel, nous reprendrons contact.
            </p>
          </CardContent>
        </Card>
      ) : (
        <FormulaireDevis
          token={params.token}
          articles={consultation.articles}
          marque={consultation.marque}
        />
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Vigon Systems — Service Avant-vente
      </p>
    </main>
  );
}
