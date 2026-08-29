import { notFound } from 'next/navigation';

import { DecisionValidation } from '@/components/validation/DecisionValidation';
import { lireValidationPublique } from '@/lib/validation/circuit';

export const metadata = { title: 'Validation — Vigon Systems' };

/**
 * Page de décision, ouverte sans authentification par son jeton.
 *
 * Même posture que la page offre : le lien circule hors de la plateforme, donc
 * seuls les montants soumis à décision sont montrés. Ni prix d'achat, ni nom de
 * fournisseur, ni détail de marge par ligne — l'administrateur décide sur le
 * total et la marge globale, qui suffisent à engager.
 */
export default async function Page(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const validation = await lireValidationPublique(params.token);

  if (!validation) notFound();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm text-muted-foreground">Vigon Systems</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">
        Validation avant génération de l&apos;offre
      </h1>

      <DecisionValidation token={params.token} validation={validation} />
    </main>
  );
}
