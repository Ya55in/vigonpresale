'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, RotateCcw, Save, Sparkles } from 'lucide-react';

import { enregistrerPrompt, type Resultat } from '@/app/(dashboard)/admin/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

export type PromptAffiche = {
  code: string;
  libelle: string;
  role: string;
  texte: string;
  /** Faux quand le texte est celui livré avec l'application. */
  personnalise: boolean;
  variablesRequises: string[];
  variablesOptionnelles: string[];
};

/**
 * Édition des prompts du modèle.
 *
 * Un seul prompt est ouvert à la fois : les afficher tous déroulés donnerait
 * sept pavés de texte où rien ne se distingue. Le bouton « rétablir » ne
 * s'affiche que sur un prompt retouché — sur un prompt d'origine, il n'aurait
 * rien à faire.
 */
export function GestionPrompts({ prompts }: { prompts: PromptAffiche[] }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<Resultat | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);

  async function envoyer(cle: string, donnees: FormData): Promise<void> {
    setEnCours(cle);
    setRetour(null);
    const resultat = await enregistrerPrompt(null, donnees);
    setEnCours(null);
    setRetour(resultat);
    if (resultat.ok) router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4" />
          Prompts du modèle
          <Badge variant="neutre">{prompts.filter((p) => p.personnalise).length} modifié(s)</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Les instructions envoyées au modèle à chaque étape du flux. Les
          variables <code className="rounded bg-muted px-1">{'{{nom}}'}</code> sont
          remplacées à l&apos;exécution — celles marquées obligatoires ne peuvent
          pas être retirées.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
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

        {prompts.map((prompt) => {
          const deplie = ouvert === prompt.code;

          return (
            <div key={prompt.code} className="rounded-md border">
              <button
                type="button"
                onClick={() => setOuvert(deplie ? null : prompt.code)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50"
                aria-expanded={deplie}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {prompt.libelle}
                    {prompt.personnalise && (
                      <Badge variant="info" className="ml-2">
                        modifié
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{prompt.role}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {deplie ? 'Masquer' : 'Modifier'}
                </span>
              </button>

              {deplie && (
                <form
                  className="space-y-3 border-t p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    fd.set('code', prompt.code);
                    void envoyer(`prompt-${prompt.code}`, fd);
                  }}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {prompt.variablesRequises.map((v) => (
                      <Badge key={v} variant="attention" title="Obligatoire">
                        {`{{${v}}}`}
                      </Badge>
                    ))}
                    {prompt.variablesOptionnelles.map((v) => (
                      <Badge key={v} variant="neutre" title="Facultative">
                        {`{{${v}}}`}
                      </Badge>
                    ))}
                  </div>

                  <Textarea
                    name="texte"
                    // La clé force le remontage après un rétablissement : sans
                    // elle, React garde la valeur saisie et l'écran continuerait
                    // d'afficher le texte qu'on vient d'effacer.
                    key={`${prompt.code}-${prompt.personnalise}`}
                    rows={18}
                    required
                    maxLength={20_000}
                    defaultValue={prompt.texte}
                    className="font-mono text-xs leading-relaxed"
                    spellCheck={false}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit" size="sm" disabled={enCours !== null}>
                      {enCours === `prompt-${prompt.code}` ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      Enregistrer
                    </Button>

                    {prompt.personnalise && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={enCours !== null}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set('code', prompt.code);
                          fd.set('texte', prompt.texte);
                          fd.set('retablir', 'true');
                          void envoyer(`retablir-${prompt.code}`, fd);
                        }}
                      >
                        {enCours === `retablir-${prompt.code}` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RotateCcw className="size-4" />
                        )}
                        Rétablir le texte d&apos;origine
                      </Button>
                    )}

                    <span className="text-xs text-muted-foreground">
                      Prise en compte immédiate sur l&apos;application, sous une
                      minute sur le worker.
                    </span>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
