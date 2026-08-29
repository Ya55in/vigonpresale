'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2 } from 'lucide-react';

import type { ArticleConsulte } from '@/lib/consultations/public';
import {
  enregistrerReponseFournisseur,
  type ResultatDevis,
} from '@/app/devis/[token]/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  token: string;
  articles: ArticleConsulte[];
  marque: string | null;
};

/** Saisie d'une ligne, gardée en chaîne : un `number` refuserait « 1 250,50 ». */
type SaisieLigne = {
  chiffree: boolean;
  prix: string;
  remise: string;
  disponibilite: string;
};

const LIGNE_VIDE: SaisieLigne = {
  chiffree: true,
  prix: '',
  remise: '',
  disponibilite: '',
};

/**
 * Formulaire de réponse du fournisseur.
 *
 * Les articles sont pré-remplis et **non modifiables** : le fournisseur chiffre
 * ce qui lui est demandé, il ne réécrit pas le besoin. Laisser la désignation
 * éditable romprait le rattachement à l'article de la demande, et le comparatif
 * n'aurait plus rien à aligner.
 *
 * Chaque ligne est cochée par défaut. Décocher, c'est dire « je ne fournis pas
 * cet article » — ce qui n'est pas la même chose qu'un prix à zéro, et vaut
 * mieux qu'un fournisseur qui renonce à répondre parce qu'il lui manque une
 * référence sur dix.
 */
export function FormulaireDevis({ token, articles, marque }: Props) {
  const [saisies, setSaisies] = useState<Record<number, SaisieLigne>>(() =>
    Object.fromEntries(articles.map((a) => [a.demandeItemId, { ...LIGNE_VIDE }])),
  );

  const [etat, setEtat] = useState<ResultatDevis | null>(null);
  const [enCours, demarrer] = useTransition();

  const soumettre = (evenement: React.FormEvent<HTMLFormElement>) => {
    evenement.preventDefault();
    const donnees = new FormData(evenement.currentTarget);
    demarrer(async () => {
      setEtat(await enregistrerReponseFournisseur(token, null, donnees));
    });
  };

  const modifier = (id: number, champ: keyof SaisieLigne, valeur: string | boolean) =>
    setSaisies((s) => ({ ...s, [id]: { ...s[id]!, [champ]: valeur } }));

  if (etat?.ok) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 className="size-10 text-emerald-600" />
          <p className="text-lg font-medium">{etat.message}</p>
          <p className="text-sm text-muted-foreground">
            Vous pouvez fermer cette page.
          </p>
        </CardContent>
      </Card>
    );
  }

  const lignesPourEnvoi = articles.map((a) => {
    const s = saisies[a.demandeItemId]!;
    return {
      demandeItemId: a.demandeItemId,
      chiffree: s.chiffree,
      prixUnitaireHt: s.prix,
      remisePct: s.remise === '' ? 0 : s.remise,
      disponibilite: s.disponibilite,
    };
  });

  const nbChiffrees = lignesPourEnvoi.filter((l) => l.chiffree).length;

  return (
    <form onSubmit={soumettre} className="space-y-5">
      <input type="hidden" name="lignes" value={JSON.stringify(lignesPourEnvoi)} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Votre chiffrage
            {marque && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {marque}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {articles.map((a) => {
            const s = saisies[a.demandeItemId]!;

            return (
              <div
                key={a.demandeItemId}
                className={`rounded-lg border p-3 transition-opacity ${
                  s.chiffree ? '' : 'opacity-55'
                }`}
              >
                <div className="mb-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    id={`chiffree-${a.demandeItemId}`}
                    checked={s.chiffree}
                    onChange={(e) =>
                      modifier(a.demandeItemId, 'chiffree', e.target.checked)
                    }
                    className="mt-1 size-4 shrink-0"
                  />
                  <label
                    htmlFor={`chiffree-${a.demandeItemId}`}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <p className="font-medium">{a.designation}</p>
                    <p className="text-xs text-muted-foreground">
                      {[a.reference, a.marque].filter(Boolean).join(' · ') || '—'}
                      {' — '}
                      {a.quantite} {a.unite}
                    </p>
                  </label>
                </div>

                {s.chiffree ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`prix-${a.demandeItemId}`}>
                        Prix unitaire HT
                      </Label>
                      <Input
                        id={`prix-${a.demandeItemId}`}
                        inputMode="decimal"
                        placeholder="0,00"
                        value={s.prix}
                        onChange={(e) =>
                          modifier(a.demandeItemId, 'prix', e.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`remise-${a.demandeItemId}`}>Remise %</Label>
                      <Input
                        id={`remise-${a.demandeItemId}`}
                        inputMode="decimal"
                        placeholder="0"
                        value={s.remise}
                        onChange={(e) =>
                          modifier(a.demandeItemId, 'remise', e.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`dispo-${a.demandeItemId}`}>Disponibilité</Label>
                      <Input
                        id={`dispo-${a.demandeItemId}`}
                        placeholder="En stock, 3 semaines…"
                        value={s.disponibilite}
                        onChange={(e) =>
                          modifier(a.demandeItemId, 'disponibilite', e.target.value)
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Article non fourni — il ne figurera pas dans votre offre.
                  </p>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conditions générales de l&apos;offre</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="delaiLivraison">Délai de livraison</Label>
            <Input
              id="delaiLivraison"
              name="delaiLivraison"
              placeholder="10 jours ouvrés"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conditionsPaiement">Conditions de paiement</Label>
            <Input
              id="conditionsPaiement"
              name="conditionsPaiement"
              placeholder="30 jours fin de mois"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="garantie">Garantie</Label>
            <Input id="garantie" name="garantie" placeholder="24 mois sur site" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="validiteOffre">Validité de l&apos;offre</Label>
            <Input id="validiteOffre" name="validiteOffre" placeholder="30 jours" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="numeroDevis">Votre référence de devis</Label>
            <Input id="numeroDevis" name="numeroDevis" placeholder="Facultatif" />
          </div>

          {/* Le document complète la saisie, il ne la remplace pas : ce sont
              les prix saisis qui alimentent le comparatif, pas le PDF. Le
              joindre garde une trace de l'offre officielle, avec ses mentions
              et sa mise en forme. */}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="document">Votre devis en pièce jointe</Label>
            <Input
              id="document"
              name="document"
              type="file"
              accept=".pdf,.docx,.xlsx,.xls,.csv,.txt"
              className="cursor-pointer file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Facultatif — PDF, Word, Excel ou texte, 15 Mo au plus. Les prix
              ci-dessus restent ceux qui font foi.
            </p>
          </div>
        </CardContent>
      </Card>

      {etat && !etat.ok && (
        <p role="alert" className="text-sm text-destructive">
          {etat.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={enCours || nbChiffrees === 0}>
          {enCours ? 'Envoi…' : 'Envoyer mon offre'}
        </Button>
        <span className="text-sm text-muted-foreground">
          {nbChiffrees} article(s) sur {articles.length} chiffré(s)
        </span>
      </div>
    </form>
  );
}
