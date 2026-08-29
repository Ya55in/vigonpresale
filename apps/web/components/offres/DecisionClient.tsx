'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  MessageSquare,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';

import {
  approuverOffre,
  declinerOffre,
  demanderModification,
  type ResultatPublic,
} from '@/app/offre/[token]/actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

/**
 * Boutons de décision du client, en pied de page publique.
 *
 * L'approbation demande une confirmation : c'est un engagement commercial, un
 * clic accidentel ne doit pas gagner le deal.
 */
export function DecisionClient({ token }: { token: string }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<ResultatPublic | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const [formulaire, setFormulaire] = useState<'modification' | 'refus' | null>(null);

  async function envoyer(
    cle: string,
    action: (etat: ResultatPublic | null, donnees: FormData) => Promise<ResultatPublic>,
    donnees: FormData,
  ): Promise<void> {
    setEnCours(cle);
    setRetour(null);
    const resultat = await action(null, donnees);
    setEnCours(null);
    setRetour(resultat);
    if (resultat.ok) {
      setConfirmation(false);
      setFormulaire(null);
      router.refresh();
    }
  }

  if (retour?.ok) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-center">
        <CheckCircle2 className="mx-auto size-6 text-emerald-700 dark:text-emerald-400" />
        <p className="mt-2 font-medium text-emerald-900 dark:text-emerald-300">
          {retour.message}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {retour && !retour.ok && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {retour.message}
        </p>
      )}

      {confirmation ? (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">Confirmer l&apos;approbation de cette offre ?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cela vaut acceptation commerciale de la proposition et de son montant.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={enCours !== null}
              onClick={() => {
                const fd = new FormData();
                fd.set('token', token);
                void envoyer('approuver', approuverOffre, fd);
              }}
            >
              {enCours === 'approuver' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Oui, j&apos;approuve
            </Button>
            <Button variant="ghost" onClick={() => setConfirmation(false)}>
              <X className="size-4" />
              Annuler
            </Button>
          </div>
        </div>
      ) : formulaire ? (
        <form
          className="rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            fd.set('token', token);
            void envoyer('probleme', demanderModification, fd);
          }}
        >
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              {formulaire === 'refus'
                ? 'Qu’est-ce qui ne convient pas ?'
                : 'Que souhaitez-vous modifier ?'}
            </span>
            <span className="block text-sm text-muted-foreground">
              Votre message est transmis à notre équipe, qui revient vers vous.
            </span>
            <Textarea
              name="commentaire"
              rows={4}
              required
              minLength={5}
              maxLength={4000}
              placeholder={
                formulaire === 'refus'
                  ? 'Prix, délai, matériel proposé, périmètre…'
                  : 'Quantités, délais, périmètre…'
              }
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={enCours !== null}>
              {enCours === 'probleme' && <Loader2 className="size-4 animate-spin" />}
              Envoyer à l&apos;équipe
            </Button>
            <Button type="button" variant="ghost" onClick={() => setFormulaire(null)}>
              <X className="size-4" />
              Annuler
            </Button>
          </div>

          {/* Le renoncement est distinct de la réserve : il ferme le dossier, on
              ne l'obtient donc jamais par le seul pouce baissé. Discret mais
              accessible, pour le client qui veut vraiment sortir. */}
          {formulaire === 'refus' && (
            <div className="mt-4 border-t pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={enCours !== null}
                onClick={(e) => {
                  const champ = e.currentTarget
                    .closest('form')
                    ?.querySelector<HTMLTextAreaElement>('[name="commentaire"]');

                  const motif = champ?.value.trim() ?? '';
                  if (motif.length < 5) {
                    champ?.focus();
                    setRetour({
                      ok: false,
                      message: 'Merci d’indiquer le motif avant de renoncer.',
                    });
                    return;
                  }

                  const fd = new FormData();
                  fd.set('token', token);
                  fd.set('motif', motif);
                  void envoyer('refus', declinerOffre, fd);
                }}
              >
                {enCours === 'refus' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ThumbsDown className="size-4" />
                )}
                Renoncer définitivement à ce projet
              </Button>
            </div>
          )}
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-center text-sm text-muted-foreground">
            Cette proposition vous convient-elle&nbsp;?
          </p>

          <div className="flex flex-wrap justify-center gap-3">
            <Button size="lg" onClick={() => setConfirmation(true)}>
              <ThumbsUp className="size-4" />
              Oui, cette offre me convient
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setFormulaire('refus')}
            >
              <ThumbsDown className="size-4" />
              Non, j&apos;ai une réserve
            </Button>
          </div>

          {/* Troisième voie, volontairement discrète : elle laisse le dossier
              ouvert là où le pouce baissé le referme. */}
          <div className="flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setFormulaire('modification')}
            >
              <MessageSquare className="size-4" />
              Demander une modification
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
