import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { LIBELLES_DOCUMENT, LIBELLES_STATUT_DOCUMENT } from '@vigon/shared';

import { BoutonImprimer } from '@/components/documents/BoutonImprimer';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { lireDocument } from '@/lib/documents/requetes';
import { CONTACTS, COULEURS_MAQUETTE } from '@/lib/offres/maquette';

/**
 * Le document financier lui-même, tel qu'il part chez le client.
 *
 * HORS DU GROUPE `(dashboard)` À DESSEIN : la barre latérale et le fil
 * d'ariane n'ont rien à faire sur une facture imprimée, et les masquer à
 * l'impression aurait laissé la mise en page dépendre d'une feuille de style
 * qu'on oublie de tenir à jour. La route reste protégée — le middleware garde
 * tout ce qui n'est pas dans `PUBLIC_PATHS`, et cette page n'y est pas.
 *
 * TOUT VIENT DE `contenu_json`, RIEN DES TABLES VIVANTES. C'est la règle du
 * gel : une facture émise ne change pas parce qu'un prix a bougé après coup.
 * Relire l'offre pour l'afficher rendrait le document faux sans que rien ne le
 * signale — et c'est ce genre d'écart qu'on découvre au litige.
 */
export default async function Page(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const utilisateur = await requireUser();

  if (!roleHasPermission(utilisateur.role, 'document.voir')) redirect('/403');

  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) notFound();

  const doc = await lireDocument(utilisateur.tenant_id, id);
  if (!doc) notFound();

  const { contenu } = doc;

  if (!contenu) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Le contenu figé de {doc.numero} n’est pas lisible. Le document existe
          en base, mais sa photographie est illisible — ne pas le réémettre sans
          vérifier l’original.
        </p>
      </main>
    );
  }

  const montant = (n: number): string =>
    `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${contenu.totaux.devise}`;

  const jour = (iso: string | null): string =>
    iso
      ? new Date(iso).toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        })
      : '—';

  return (
    <div className="min-h-screen bg-muted/40 py-6 print:bg-white print:py-0">
      {/* Barre de service : elle disparaît à l'impression. */}
      <div className="mx-auto mb-4 flex max-w-[21cm] items-center justify-between px-4 print:hidden">
        <Link
          href={doc.demandeId ? `/demandes/${doc.demandeId}/documents` : '/demandes'}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {doc.demandeId ? 'Documents de l’affaire' : 'Demandes'}
        </Link>

        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{LIBELLES_STATUT_DOCUMENT[doc.statut]}</span>
          <BoutonImprimer />
        </div>
      </div>

      <article className="mx-auto max-w-[21cm] bg-white p-[1.6cm] text-[13px] leading-relaxed text-neutral-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-8 border-b pb-5">
          <div>
            <p
              className="text-2xl font-bold tracking-tight"
              style={{ color: COULEURS_MAQUETTE.sombre }}
            >
              VIGON
            </p>
            <p className="text-[10px] uppercase tracking-[0.25em] text-neutral-500">
              Systems
            </p>
            <div className="mt-3 space-y-0.5 text-[11px] text-neutral-500">
              {CONTACTS.map((c) => (
                <p key={c}>{c}</p>
              ))}
            </div>
          </div>

          <div className="text-right">
            <h1
              className="text-xl font-semibold"
              style={{ color: COULEURS_MAQUETTE.accent }}
            >
              {LIBELLES_DOCUMENT[doc.type]}
            </h1>
            <p className="mt-1 font-mono text-sm">{doc.numero}</p>
            <p className="mt-2 text-[11px] text-neutral-500">
              Émis le {jour(doc.dateEmission)}
            </p>
            {doc.dateEcheance && (
              <p className="text-[11px] text-neutral-500">
                Échéance {jour(doc.dateEcheance)}
              </p>
            )}
            {doc.statut === 'annule' && (
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-red-600">
                Annulé
              </p>
            )}
          </div>
        </header>

        <section className="mt-6 flex flex-wrap justify-between gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-neutral-500">
              Destinataire
            </p>
            <p className="mt-1 font-medium">{contenu.client.nom}</p>
            {contenu.client.adresse && (
              <p className="whitespace-pre-line text-[12px] text-neutral-600">
                {contenu.client.adresse}
              </p>
            )}
            {contenu.client.email && (
              <p className="text-[12px] text-neutral-600">{contenu.client.email}</p>
            )}
          </div>

          <div className="text-right">
            {contenu.reference && (
              <>
                <p className="text-[10px] uppercase tracking-wide text-neutral-500">
                  Référence
                </p>
                <p className="font-mono text-[12px]">{contenu.reference}</p>
              </>
            )}
            {contenu.objet && (
              <p className="mt-2 max-w-xs text-[12px] text-neutral-600">{contenu.objet}</p>
            )}
          </div>
        </section>

        {/* La table déborde plutôt que de comprimer : une désignation tronquée
            sur une facture est une source de contestation. */}
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr
                className="text-left text-[10px] uppercase tracking-wide text-white"
                style={{ backgroundColor: COULEURS_MAQUETTE.sombre }}
              >
                <th className="px-2 py-2 font-medium">Désignation</th>
                <th className="px-2 py-2 text-right font-medium">Qté</th>
                <th className="px-2 py-2 font-medium">Unité</th>
                <th className="px-2 py-2 text-right font-medium">P.U. HT</th>
                <th className="px-2 py-2 text-right font-medium">Total HT</th>
              </tr>
            </thead>
            <tbody>
              {contenu.lignes.map((l, i) => (
                <tr key={`${l.designation}-${i}`} className="border-b align-top">
                  <td className="px-2 py-2">
                    {l.designation}
                    {l.reference && (
                      <span className="block font-mono text-[10px] text-neutral-500">
                        {l.reference}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.quantite}</td>
                  <td className="px-2 py-2 text-neutral-500">{l.unite}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {montant(l.prixUnitaireHt)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{montant(l.totalHt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-5 flex justify-end">
          <dl className="w-64 space-y-1 text-[12px]">
            <div className="flex justify-between">
              <dt className="text-neutral-600">Total HT</dt>
              <dd className="tabular-nums">{montant(contenu.totaux.totalHt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-neutral-600">TVA {contenu.totaux.tvaPct} %</dt>
              <dd className="tabular-nums">{montant(contenu.totaux.totalTva)}</dd>
            </div>
            <div
              className="flex justify-between border-t pt-1 font-semibold"
              style={{ color: COULEURS_MAQUETTE.sombre }}
            >
              <dt>Total TTC</dt>
              <dd className="tabular-nums">{montant(contenu.totaux.totalTtc)}</dd>
            </div>
          </dl>
        </section>

        {contenu.conditions && (
          <section className="mt-6 border-t pt-4 text-[11px] text-neutral-600">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
              Conditions
            </p>
            <dl className="grid gap-x-8 gap-y-1 sm:grid-cols-3">
              {contenu.conditions.livraison && (
                <div>
                  <dt className="text-neutral-500">Livraison</dt>
                  <dd>{contenu.conditions.livraison}</dd>
                </div>
              )}
              {contenu.conditions.paiement && (
                <div>
                  <dt className="text-neutral-500">Paiement</dt>
                  <dd>{contenu.conditions.paiement}</dd>
                </div>
              )}
              {contenu.conditions.garantie && (
                <div>
                  <dt className="text-neutral-500">Garantie</dt>
                  <dd>{contenu.conditions.garantie}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {doc.notes && (
          <p className="mt-4 text-[11px] text-neutral-600">{doc.notes}</p>
        )}

        <footer className="mt-8 border-t pt-3 text-center text-[10px] text-neutral-400">
          {doc.numero} · {LIBELLES_DOCUMENT[doc.type]} · {contenu.client.nom}
          {doc.dateReglement && ` · réglé le ${jour(doc.dateReglement)}`}
        </footer>
      </article>
    </div>
  );
}
