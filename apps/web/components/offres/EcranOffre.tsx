'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ExternalLink,
  FileText,
  ImageOff,
  Loader2,
  Lock,
  Settings2,
  Sparkles,
} from 'lucide-react';

import {
  genererOffre,
  type Resultat,
} from '@/app/(dashboard)/demandes/[id]/offre/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formaterMontant } from '@/lib/costing/requetes';
import { formaterDateHeure } from '@/lib/demandes/statuts';

export type ProduitAffiche = {
  id: number;
  ordre: number;
  designation: string;
  reference: string | null;
  marque: string | null;
  descriptionTechnique: string | null;
  pointsCles: string[];
  imageUrl: string | null;
  imageSource: string | null;
  quantite: number;
  prixUnitaireHt: number;
  totalHt: number;
};

export type OffreAffichee = {
  id: number;
  numero: string;
  version: number;
  statut: string;
  gammaUrl: string | null;
  pdfUrl: string | null;
  dateGeneration: string | null;
  produits: ProduitAffiche[];
};

type Props = {
  demandeId: number;
  offre: OffreAffichee | null;
  /** Faux tant que le costing n'est pas verrouillé. */
  costingVerrouille: boolean;
  devise: string;
  peutGenerer: boolean;
};

export function EcranOffre({
  demandeId,
  offre,
  costingVerrouille,
  devise,
  peutGenerer,
}: Props) {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [retour, setRetour] = useState<Resultat | null>(null);
  const [reglages, setReglages] = useState(false);
  const [avecImages, setAvecImages] = useState(true);
  const [conditions, setConditions] = useState({ livraison: '', paiement: '', garantie: '' });

  const sansVisuel = offre?.produits.filter((p) => !p.imageUrl) ?? [];

  async function lancer(): Promise<void> {
    setEnCours(true);
    setRetour(null);

    const fd = new FormData();
    fd.set('demandeId', String(demandeId));
    fd.set('avecImages', String(avecImages));

    // Les trois vont ensemble : n'en envoyer qu'un laisserait deux valeurs du
    // modèle standard à côté d'une exception, sans qu'on sache laquelle est
    // laquelle. L'action applique la même règle.
    if (conditions.livraison && conditions.paiement && conditions.garantie) {
      fd.set('livraison', conditions.livraison);
      fd.set('paiement', conditions.paiement);
      fd.set('garantie', conditions.garantie);
    }

    const resultat = await genererOffre(null, fd);

    setEnCours(false);
    setRetour(resultat);
    if (resultat.ok) router.refresh();
  }

  return (
    <div className="space-y-5">
      {retour && (
        <p
          role="status"
          className={
            retour.ok
              ? 'rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300'
              : 'rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive'
          }
        >
          {retour.message}
        </p>
      )}

      {reglages && peutGenerer && (
        <div className="space-y-3 rounded-lg border p-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={avecImages}
              onChange={(e) => setAvecImages(e.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>
              Illustrer les produits
              <span className="block text-xs text-muted-foreground">
                Décocher accélère nettement la génération, et évite des visuels
                génériques sur un lot de licences ou de prestations.
              </span>
            </span>
          </label>

          <div className="space-y-2 border-t pt-3">
            <p className="text-sm font-medium">Conditions de cette offre</p>
            <p className="text-xs text-muted-foreground">
              Laissez vide pour reprendre le modèle standard défini dans
              l&apos;administration. Renseignez les <strong>trois</strong> champs
              pour les remplacer sur cette offre uniquement — le paramétrage
              général reste inchangé.
            </p>

            {(
              [
                ['livraison', 'Livraison', 'Sous 4 semaines à compter de la commande'],
                ['paiement', 'Paiement', '30 % à la commande, solde à 30 jours'],
                ['garantie', 'Garantie', '36 mois constructeur, retour atelier'],
              ] as const
            ).map(([cle, libelle, exemple]) => (
              <label key={cle} className="block space-y-1">
                <span className="text-xs text-muted-foreground">{libelle}</span>
                <input
                  value={conditions[cle]}
                  onChange={(e) =>
                    setConditions((c) => ({ ...c, [cle]: e.target.value }))
                  }
                  placeholder={exemple}
                  maxLength={500}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {!costingVerrouille && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-300">
              Costing non verrouillé
            </p>
            <p className="text-amber-900/80 dark:text-amber-300/80">
              L&apos;offre reprend les prix de vente de la feuille validée : il faut
              d&apos;abord valider le costing.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {/*
            Conteneur en `div` et non `p` : Badge rend un `div`, et un bloc dans
            un paragraphe est du HTML invalide — React abandonnait le rendu
            serveur et réhydratait tout le document côté client.

            `numero` porte déjà le suffixe de version (PR-…-V02) : le recomposer
            ici affichait « PR-2026-000003-V02-V02 ».
          */}
          {offre ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono font-medium">{offre.numero}</span>
              <Badge variant={offre.statut === 'generee' ? 'info' : 'neutre'}>
                {offre.statut}
              </Badge>
              <span className="text-muted-foreground">
                {offre.produits.length} produit(s) — générée le{' '}
                {formaterDateHeure(offre.dateGeneration)}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucune offre générée.</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {offre?.pdfUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={offre.pdfUrl} target="_blank" rel="noreferrer">
                <FileText className="size-4" />
                Ouvrir le PDF
              </a>
            </Button>
          )}
          {offre?.gammaUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={offre.gammaUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
                Document Gamma
              </a>
            </Button>
          )}
          {peutGenerer && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReglages((v) => !v)}
              disabled={enCours}
            >
              <Settings2 className="size-4" />
              Réglages
            </Button>
          )}
          {peutGenerer && (
            <Button disabled={enCours || !costingVerrouille} onClick={() => void lancer()}>
              {enCours ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {offre ? `Régénérer en V${offre.version + 1}` : "Générer l'offre"}
            </Button>
          )}
        </div>
      </div>

      {enCours && (
        <p className="text-sm text-muted-foreground">
          Enrichissement des descriptions, recherche des visuels puis mise en page —
          compter une à deux minutes.
        </p>
      )}

      {sansVisuel.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-300">
            <ImageOff className="size-4" />
            {sansVisuel.length} produit(s) sans visuel
          </p>
          <p className="mt-0.5 text-amber-900/80 dark:text-amber-300/80">
            {sansVisuel.map((p) => p.designation).join(', ')} — un visuel de
            remplacement est affiché ; à fournir avant envoi au client.
          </p>
        </div>
      )}

      {offre && offre.produits.length > 0 && (
        <div className="space-y-3">
          {offre.produits.map((produit) => (
            <Card key={produit.id}>
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {produit.ordre}. {produit.designation}
                  {produit.marque && <Badge variant="neutre">{produit.marque}</Badge>}
                </CardTitle>
                {produit.reference && (
                  <p className="font-mono text-xs text-muted-foreground">
                    {produit.reference}
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-4 sm:flex-row">
                  {produit.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={produit.imageUrl}
                      alt={produit.designation}
                      className="size-28 shrink-0 rounded-md border object-contain p-1"
                    />
                  ) : (
                    <div className="flex size-28 shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground">
                      <ImageOff className="size-5" />
                      <span className="text-[10px]">sans visuel</span>
                    </div>
                  )}

                  <div className="min-w-0 flex-1 space-y-2">
                    {produit.descriptionTechnique && (
                      <p className="text-sm">{produit.descriptionTechnique}</p>
                    )}
                    {produit.pointsCles.length > 0 && (
                      <ul className="space-y-0.5 text-sm text-muted-foreground">
                        {produit.pointsCles.map((point, i) => (
                          <li key={i}>• {point}</li>
                        ))}
                      </ul>
                    )}
                    {produit.imageSource && (
                      <p className="truncate text-xs text-muted-foreground">
                        Visuel : {produit.imageSource}
                      </p>
                    )}
                  </div>

                  <div className="shrink-0 space-y-1 text-right text-sm">
                    <p className="text-muted-foreground">
                      {produit.quantite} × {formaterMontant(produit.prixUnitaireHt, devise)}
                    </p>
                    <p className="font-medium">
                      {formaterMontant(produit.totalHt, devise)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
