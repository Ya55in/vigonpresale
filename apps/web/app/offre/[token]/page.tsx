import { notFound } from 'next/navigation';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { DecisionClient } from '@/components/offres/DecisionClient';
import { RenduOffre } from '@/components/offres/RenduOffre';
import { lireOffrePublique, tracerConsultation } from '@/lib/offres/public';

/** Page consultée par le client : jamais indexée, jamais mise en cache. */
export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

export default async function Page(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const offre = await lireOffrePublique(params.token);

  // Jeton inconnu, offre pas encore envoyée : même 404 dans les deux cas, pour
  // ne rien révéler sur l'existence du document.
  if (!offre) notFound();

  // Le traçage suit la lecture : il ne doit jamais retarder ni bloquer l'affichage.
  await tracerConsultation(offre.id);

  return (
    <main className="min-h-screen bg-muted/30 px-3 py-6 sm:px-4 sm:py-10">
      {/* Plus large que les autres écrans : les diapositives sont en 16:9, les
          contraindre à la largeur d'un document les rendrait minuscules. */}
      <div className="mx-auto max-w-5xl space-y-6">
        <RenduOffre boq={offre.boq} />

        <div className="rounded-lg border bg-background p-6 shadow-sm">
          {offre.statut === 'approuvee' ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto size-7 text-emerald-600 dark:text-emerald-400" />
              <p className="mt-2 font-medium">Offre approuvée</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Merci de votre confiance. Nos équipes reviennent vers vous pour la
                suite.
              </p>
            </div>
          ) : offre.statut === 'refusee' ? (
            <div className="text-center">
              <p className="font-medium">Offre déclinée</p>
              {offre.motifRefus && (
                <p className="mt-1 text-sm text-muted-foreground">{offre.motifRefus}</p>
              )}
            </div>
          ) : offre.expiree ? (
            <div className="text-center">
              <AlertTriangle className="mx-auto size-7 text-amber-600 dark:text-amber-400" />
              <p className="mt-2 font-medium">Offre expirée</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sa durée de validité est dépassée. Contactez-nous pour une
                proposition actualisée.
              </p>
            </div>
          ) : (
            <DecisionClient token={params.token} />
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Vigon Systems — offre {offre.reference}
        </p>
      </div>
    </main>
  );
}
