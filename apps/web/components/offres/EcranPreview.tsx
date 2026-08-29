'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  Check,
  Copy,
  EyeOff,
  FileText,
  ImageOff,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Upload,
  X,
} from 'lucide-react';

import {
  basculerVisuel,
  modifierProduit,
  modifierSynthese,
  regenererDocument,
  remplacerVisuel,
  type Resultat,
} from '@/app/(dashboard)/offres/[id]/preview/actions';
import { validerEtEnvoyer } from '@/app/(dashboard)/offres/[id]/preview/valider';
import { RenduOffre, type BoqAffiche } from '@/components/offres/RenduOffre';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export type ProduitEditable = {
  id: number;
  ordre: number;
  designation: string;
  descriptionTechnique: string | null;
  pointsCles: string[];
  imageUrl: string | null;
  imageSource: string | null;
  /**
   * Vrai quand l'absence de visuel est un CHOIX et non un échec de recherche.
   * Les deux se ressemblent à l'écran ; seule cette distinction permet de
   * proposer « Rétablir » plutôt que « Chercher ».
   */
  visuelRetire: boolean;
};

type Props = {
  offreId: number;
  numero: string;
  statut: string;
  boq: BoqAffiche;
  produits: ProduitEditable[];
  pdfUrl: string | null;
  gammaUrl: string | null;
  /** `null` avant validation : le jeton n'ouvre encore rien. */
  lienPublic: string | null;
  peutModifier: boolean;
  peutEnvoyer: boolean;
};

export function EcranPreview({
  offreId,
  numero,
  statut,
  boq,
  produits,
  pdfUrl,
  gammaUrl,
  lienPublic,
  peutModifier,
  peutEnvoyer,
}: Props) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<Resultat | null>(null);
  const [editionSynthese, setEditionSynthese] = useState(false);
  const [editionProduit, setEditionProduit] = useState<number | null>(null);
  const [copie, setCopie] = useState(false);

  const partie = ['envoyee', 'consultee', 'approuvee', 'refusee', 'expiree'].includes(
    statut,
  );
  const modifiable = peutModifier && !partie;

  async function envoyer(
    cle: string,
    action: (etat: Resultat | null, donnees: FormData) => Promise<Resultat>,
    donnees: FormData,
    apres?: () => void,
  ): Promise<void> {
    setEnCours(cle);
    setRetour(null);
    const resultat = await action(null, donnees);
    setEnCours(null);
    setRetour(resultat);
    if (resultat.ok) {
      apres?.();
      router.refresh();
    }
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Relecture de l&apos;offre</h1>
          {/* `div` et non `p` : Badge rend un bloc, invalide dans un paragraphe. */}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span className="font-mono">{numero}</span>
            <Badge variant={statut === 'approuvee' ? 'succes' : partie ? 'info' : 'attention'}>
              {statut}
            </Badge>
            <span>Ce que vous voyez ici est exactement ce que le client verra.</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {pdfUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={pdfUrl} target="_blank" rel="noreferrer">
                <FileText className="size-4" />
                PDF
              </a>
            </Button>
          )}
          {gammaUrl && (
            <Button variant="outline" size="sm" asChild>
              <a href={gammaUrl} target="_blank" rel="noreferrer">
                Gamma
              </a>
            </Button>
          )}
          {/* Désactivé plutôt que masqué : l'absence du bouton se lirait comme
              un droit manquant. Le titre dit la seule chose utile — ce qu'il
              faut faire pour que le lien s'ouvre. */}
          <Button
            variant="outline"
            size="sm"
            disabled={lienPublic === null}
            title={
              lienPublic === null
                ? "Le lien ne s'ouvre qu'à partir de la validation : avant, le jeton renvoie une page introuvable."
                : lienPublic
            }
            onClick={() => {
              if (!lienPublic) return;
              void navigator.clipboard.writeText(lienPublic);
              setCopie(true);
              setTimeout(() => setCopie(false), 2000);
            }}
          >
            {copie ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copie ? 'Copié' : 'Lien client'}
          </Button>

          {/*
            La raison est ÉCRITE, pas seulement en infobulle.
            Un bouton grisé avec un `title` n'explique rien à qui ne survole pas
            — et sur un écran tactile, personne ne survole. « Le lien de l'offre
            n'apparaît pas » a été signalé alors que le comportement était
            correct : c'est l'explication qui manquait.
          */}
          {lienPublic === null && (
            <p className="basis-full text-xs text-muted-foreground">
              Le lien client ne s’ouvre qu’à partir de la validation — avant, il
              renvoie une page introuvable. Utilisez « Valider sans envoyer »
              pour l’obtenir sans écrire au client.
            </p>
          )}

          {modifiable && (
            <Button
              variant="outline"
              size="sm"
              disabled={enCours !== null}
              onClick={() => {
                const fd = new FormData();
                fd.set('offreId', String(offreId));
                void envoyer('regenerer', regenererDocument, fd);
              }}
            >
              {enCours === 'regenerer' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Régénérer le document
            </Button>
          )}

          {peutEnvoyer && !partie && (
            <>
              {/*
                VALIDER SANS ENVOYER — le chemin qui manquait.
                `validerEtEnvoyer` acceptait déjà `envoyer: false`, mais aucun
                bouton ne l'appelait : la seule façon d'obtenir un lien public
                était donc d'expédier le courriel au client. Or le lien ne
                s'ouvre qu'à partir de la validation, ce qui rendait impossible
                de le relire, de le tester ou de le transmettre autrement.
              */}
              <Button
                variant="outline"
                size="sm"
                disabled={enCours !== null}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('offreId', String(offreId));
                  fd.set('envoyer', 'false');
                  void envoyer('valider', validerEtEnvoyer, fd);
                }}
              >
                {enCours === 'valider' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Valider sans envoyer
              </Button>

              <Button
                disabled={enCours !== null}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('offreId', String(offreId));
                  fd.set('envoyer', 'true');
                  void envoyer('envoyer', validerEtEnvoyer, fd);
                }}
              >
                {enCours === 'envoyer' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Valider et envoyer au client
              </Button>
            </>
          )}
        </div>
      </div>

      {/* --- Retouches --- */}
      {modifiable && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Retouches avant envoi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Synthèse */}
            {editionSynthese ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  fd.set('offreId', String(offreId));
                  void envoyer('synthese', modifierSynthese, fd, () =>
                    setEditionSynthese(false),
                  );
                }}
                className="space-y-3 rounded-md border p-3"
              >
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Titre</span>
                  <Input name="titre" defaultValue={boq.solution.titre} required maxLength={300} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Texte de synthèse</span>
                  <Textarea
                    name="resume"
                    defaultValue={boq.solution.resume}
                    rows={5}
                    required
                    maxLength={5000}
                  />
                </label>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={enCours !== null}>
                    {enCours === 'synthese' && <Loader2 className="size-4 animate-spin" />}
                    Enregistrer
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditionSynthese(false)}
                  >
                    <X className="size-4" />
                    Annuler
                  </Button>
                </div>
              </form>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setEditionSynthese(true)}>
                <Pencil className="size-4" />
                Modifier titre et synthèse
              </Button>
            )}

            {/* Produits */}
            <div className="space-y-2">
              {produits.map((produit) => (
                <LigneProduit
                  key={produit.id}
                  produit={produit}
                  offreId={offreId}
                  enEdition={editionProduit === produit.id}
                  enCours={enCours}
                  onEditer={() => setEditionProduit(produit.id)}
                  onFermer={() => setEditionProduit(null)}
                  onEnvoyer={envoyer}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* --- Rendu tel que vu par le client --- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rendu client</CardTitle>
          <p className="text-sm text-muted-foreground">
            Les onze diapositives de la maquette Vigon, dans l&apos;ordre du PDF.
            C&apos;est exactement ce que le client voit en ouvrant son lien.
          </p>
        </CardHeader>
        <CardContent className="bg-muted/20 py-6">
          <RenduOffre boq={boq} />
        </CardContent>
      </Card>
    </div>
  );
}

function LigneProduit({
  produit,
  offreId,
  enEdition,
  enCours,
  onEditer,
  onFermer,
  onEnvoyer,
}: {
  produit: ProduitEditable;
  offreId: number;
  enEdition: boolean;
  enCours: string | null;
  onEditer: () => void;
  onFermer: () => void;
  onEnvoyer: (
    cle: string,
    action: (etat: Resultat | null, donnees: FormData) => Promise<Resultat>,
    donnees: FormData,
    apres?: () => void,
  ) => Promise<void>;
}) {
  const champFichier = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {produit.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={produit.imageUrl}
              alt={produit.designation}
              className="size-10 shrink-0 rounded border object-contain"
            />
          ) : (
            <ImageOff className="size-10 shrink-0 text-muted-foreground" />
          )}
          <p className="truncate text-sm font-medium">
            {produit.ordre}. {produit.designation}
          </p>
        </div>

        <div className="flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={enCours !== null}
            onClick={() => {
              const fd = new FormData();
              fd.set('offreId', String(offreId));
              fd.set('produitId', String(produit.id));
              fd.set('mode', 'recherche');
              void onEnvoyer(`visuel-${produit.id}`, remplacerVisuel, fd);
            }}
          >
            {enCours === `visuel-${produit.id}` ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Chercher un visuel
          </Button>

          <Button
            variant="ghost"
            size="sm"
            disabled={enCours !== null}
            onClick={() => champFichier.current?.click()}
          >
            <Upload className="size-4" />
            Téléverser
          </Button>

          {/* Un visuel trouvé automatiquement est parfois pire que pas de
              visuel : générique, hors gamme, de mauvaise qualité. Le retrait
              est par produit — couper les visuels de toute l'offre sacrifierait
              les bons avec le mauvais. */}
          <Button
            variant="ghost"
            size="sm"
            disabled={enCours !== null}
            onClick={() => {
              const fd = new FormData();
              fd.set('offreId', String(offreId));
              fd.set('produitId', String(produit.id));
              void onEnvoyer(`bascule-${produit.id}`, basculerVisuel, fd);
            }}
          >
            {enCours === `bascule-${produit.id}` ? (
              <Loader2 className="size-4 animate-spin" />
            ) : produit.visuelRetire ? (
              <RotateCcw className="size-4" />
            ) : (
              <EyeOff className="size-4" />
            )}
            {produit.visuelRetire ? 'Rétablir' : 'Sans visuel'}
          </Button>
          <input
            ref={champFichier}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const fichier = e.target.files?.[0];
              if (!fichier) return;
              const fd = new FormData();
              fd.set('offreId', String(offreId));
              fd.set('produitId', String(produit.id));
              fd.set('mode', 'upload');
              fd.set('fichier', fichier);
              void onEnvoyer(`upload-${produit.id}`, remplacerVisuel, fd);
              e.target.value = '';
            }}
          />

          {!enEdition && (
            <Button variant="ghost" size="sm" disabled={enCours !== null} onClick={onEditer}>
              <Pencil className="size-4" />
              Texte
            </Button>
          )}
        </div>
      </div>

      {enEdition && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set('offreId', String(offreId));
            fd.set('produitId', String(produit.id));
            void onEnvoyer(`produit-${produit.id}`, modifierProduit, fd, onFermer);
          }}
          className="mt-3 space-y-3 border-t pt-3"
        >
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Description</span>
            <Textarea
              name="descriptionTechnique"
              defaultValue={produit.descriptionTechnique ?? ''}
              rows={3}
              maxLength={3000}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">
              Points clés — un par ligne
            </span>
            <Textarea
              name="pointsCles"
              defaultValue={produit.pointsCles.join('\n')}
              rows={4}
              maxLength={3000}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={enCours !== null}>
              {enCours === `produit-${produit.id}` && (
                <Loader2 className="size-4 animate-spin" />
              )}
              Enregistrer
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onFermer}>
              <X className="size-4" />
              Annuler
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
