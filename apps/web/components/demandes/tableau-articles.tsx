'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';

import {
  ajouterArticle,
  modifierArticle,
  supprimerArticle,
  validerArticles,
  type Resultat,
} from '@/app/(dashboard)/demandes/[id]/articles/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type ArticleAffiche = {
  id: number;
  ligne_num: number;
  designation: string;
  reference: string | null;
  marque: string;
  quantite: number;
  unite: string;
  categorie: string | null;
  specifications: string | null;
  confiance_ia: number | null;
  valide_at: string | null;
};

type Props = {
  demandeId: number;
  articles: ArticleAffiche[];
  /** Faux pour FINANCE : lecture seule, cohérent avec la matrice de permissions. */
  modifiable: boolean;
  validable: boolean;
};

/** Seuil au-delà duquel l'extraction est jugée fiable (cohérent avec le worker). */
const CONFIANCE_SURE = 0.6;

export function TableauArticles({
  demandeId,
  articles,
  modifiable,
  validable,
}: Props) {
  const router = useRouter();
  const [edition, setEdition] = useState<number | null>(null);
  const [ajout, setAjout] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const tousValides =
    articles.length > 0 && articles.every((a) => a.valide_at !== null);

  async function envoyer(
    action: (etat: Resultat | null, donnees: FormData) => Promise<Resultat>,
    donnees: FormData,
    apres?: () => void,
  ): Promise<void> {
    setEnCours(true);
    setMessage(null);

    const resultat = await action(null, donnees);

    setEnCours(false);
    if (resultat.ok) {
      apres?.();
      router.refresh();
    } else {
      setMessage(resultat.message);
    }
  }

  return (
    <div className="space-y-4">
      {message && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {articles.length} article{articles.length > 1 ? 's' : ''}
          {tousValides && ' — validés'}
        </p>

        <div className="flex gap-2">
          {modifiable && !ajout && (
            <Button variant="outline" size="sm" onClick={() => setAjout(true)}>
              <Plus className="size-4" />
              Ajouter
            </Button>
          )}
          {validable && !tousValides && articles.length > 0 && (
            <Button
              size="sm"
              disabled={enCours}
              onClick={() => {
                const fd = new FormData();
                fd.set('demandeId', String(demandeId));
                void envoyer(validerArticles, fd);
              }}
            >
              {enCours ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Valider les articles
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">#</TableHead>
              <TableHead>Désignation</TableHead>
              <TableHead>Référence</TableHead>
              <TableHead>Marque</TableHead>
              <TableHead className="text-right">Qté</TableHead>
              <TableHead>Unité</TableHead>
              <TableHead>Confiance</TableHead>
              {modifiable && <TableHead className="w-24" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {articles.map((article) =>
              edition === article.id ? (
                <LigneEdition
                  key={article.id}
                  article={article}
                  demandeId={demandeId}
                  enCours={enCours}
                  onAnnuler={() => setEdition(null)}
                  onEnvoyer={(fd) =>
                    envoyer(modifierArticle, fd, () => setEdition(null))
                  }
                />
              ) : (
                <LigneLecture
                  key={article.id}
                  article={article}
                  modifiable={modifiable}
                  enCours={enCours}
                  onEditer={() => {
                    setMessage(null);
                    setEdition(article.id);
                  }}
                  onSupprimer={() => {
                    const fd = new FormData();
                    fd.set('id', String(article.id));
                    fd.set('demandeId', String(demandeId));
                    void envoyer(supprimerArticle, fd);
                  }}
                />
              ),
            )}

            {ajout && (
              <LigneEdition
                demandeId={demandeId}
                enCours={enCours}
                onAnnuler={() => setAjout(false)}
                onEnvoyer={(fd) => envoyer(ajouterArticle, fd, () => setAjout(false))}
              />
            )}

            {articles.length === 0 && !ajout && (
              <TableRow>
                <TableCell
                  colSpan={modifiable ? 8 : 7}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Aucun article extrait. Ajoutez-les manuellement.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function LigneLecture({
  article,
  modifiable,
  enCours,
  onEditer,
  onSupprimer,
}: {
  article: ArticleAffiche;
  modifiable: boolean;
  enCours: boolean;
  onEditer: () => void;
  onSupprimer: () => void;
}) {
  const confiance = article.confiance_ia;

  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground">
        {article.ligne_num}
      </TableCell>
      <TableCell className="max-w-sm">
        <p className="font-medium">{article.designation}</p>
        {article.specifications && (
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {article.specifications}
          </p>
        )}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {article.reference ?? '—'}
      </TableCell>
      <TableCell>{article.marque}</TableCell>
      <TableCell className="text-right tabular-nums">{article.quantite}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {article.unite}
      </TableCell>
      <TableCell>
        {confiance === null ? (
          <Badge variant="neutre">saisi</Badge>
        ) : confiance < CONFIANCE_SURE ? (
          <Badge variant="attention">{Math.round(confiance * 100)} %</Badge>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {Math.round(confiance * 100)} %
          </span>
        )}
      </TableCell>
      {modifiable && (
        <TableCell>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={`Modifier ${article.designation}`}
              disabled={enCours}
              onClick={onEditer}
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-destructive hover:text-destructive"
              aria-label={`Supprimer ${article.designation}`}
              disabled={enCours}
              onClick={onSupprimer}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

function LigneEdition({
  article,
  demandeId,
  enCours,
  onAnnuler,
  onEnvoyer,
}: {
  article?: ArticleAffiche;
  demandeId: number;
  enCours: boolean;
  onAnnuler: () => void;
  onEnvoyer: (donnees: FormData) => void;
}) {
  const premierChamp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    premierChamp.current?.focus();
  }, []);

  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={8} className="p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set('demandeId', String(demandeId));
            if (article) fd.set('id', String(article.id));
            onEnvoyer(fd);
          }}
          // Entrée valide, Échap annule : l'édition inline doit se piloter
          // au clavier sans quitter la ligne.
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onAnnuler();
            }
          }}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 lg:col-span-2">
              <span className="text-xs text-muted-foreground">Désignation *</span>
              <Input
                ref={premierChamp}
                name="designation"
                defaultValue={article?.designation ?? ''}
                required
                maxLength={500}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Référence</span>
              <Input
                name="reference"
                defaultValue={article?.reference ?? ''}
                maxLength={200}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Marque *</span>
              <Input
                name="marque"
                defaultValue={article?.marque ?? ''}
                required
                maxLength={200}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Quantité *</span>
              <Input
                name="quantite"
                type="number"
                min="0.01"
                step="any"
                defaultValue={article?.quantite ?? 1}
                required
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Unité *</span>
              <Input
                name="unite"
                defaultValue={article?.unite ?? 'unité'}
                required
                maxLength={50}
              />
            </label>
            <label className="space-y-1 lg:col-span-2">
              <span className="text-xs text-muted-foreground">Catégorie</span>
              <Input
                name="categorie"
                defaultValue={article?.categorie ?? ''}
                maxLength={200}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Spécifications</span>
            <Textarea
              name="specifications"
              defaultValue={article?.specifications ?? ''}
              rows={2}
              maxLength={2000}
            />
          </label>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={enCours}>
              {enCours ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              {article ? 'Enregistrer' : 'Ajouter'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onAnnuler}
              disabled={enCours}
            >
              <X className="size-4" />
              Annuler
            </Button>
          </div>
        </form>
      </TableCell>
    </TableRow>
  );
}
