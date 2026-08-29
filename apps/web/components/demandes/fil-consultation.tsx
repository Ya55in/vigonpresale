'use client';

import { useState } from 'react';
import { ChevronDown, Loader2, MessageSquare, Reply } from 'lucide-react';

import { decouperReponse, detacherSignature } from '@vigon/shared';

import {
  repondreFournisseur,
  type Resultat,
} from '@/app/(dashboard)/demandes/[id]/consultations/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { EchangeConsultation } from '@/lib/consultations/requetes';

/** Libellés des types de message, du point de vue de l'avant-vente. */
const LIBELLE_TYPE: Record<string, string> = {
  consultation: 'Demande de devis envoyée',
  relance: 'Relance envoyée',
  demande_precision: 'Précision demandée',
  devis_recu: 'Devis reçu',
  automatique: 'Réponse automatique',
  reponse_precision: 'Notre réponse',
  refus: 'Refus',
};

/**
 * Corps d'un message, débarrassé de l'historique recopié.
 *
 * Une réponse fournisseur arrive avec sa signature et tout l'échange précédent :
 * sur un cas réel, trois lignes utiles noyées dans vingt-cinq. L'avant-vente
 * cherchait la réponse au milieu de ses propres mots.
 *
 * L'historique est REPLIÉ, jamais supprimé : certains fournisseurs répondent en
 * ligne dans le texte cité, et le jeter perdrait la réponse elle-même.
 */
function CorpsMessage({ brut }: { brut: string | null }) {
  const [citeVisible, setCiteVisible] = useState(false);

  if (!brut || brut.trim().length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Message sans contenu texte.
      </p>
    );
  }

  const { corps, cite } = decouperReponse(brut);
  const { texte, signature } = detacherSignature(corps);

  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{texte}</p>

      {signature && (
        <p className="whitespace-pre-wrap border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
          {signature}
        </p>
      )}

      {cite && (
        <div>
          <button
            type="button"
            onClick={() => setCiteVisible((v) => !v)}
            aria-expanded={citeVisible}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={`size-3 transition-transform ${citeVisible ? 'rotate-180' : ''}`}
            />
            {citeVisible ? 'Masquer' : 'Afficher'} le message cité
          </button>

          {citeVisible && (
            <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
              {cite}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function formaterDate(valeur: string | null): string {
  if (!valeur) return '';
  const d = new Date(valeur);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

type Props = {
  demandeId: number;
  consultationId: number;
  fournisseur: string;
  echanges: EchangeConsultation[];
  /** Le champ de réponse n'a de sens qu'une fois la consultation partie. */
  repondable: boolean;
  enCours: string | null;
  /** Machinerie du parent : état d'envoi, message de retour, rafraîchissement. */
  onEnvoyer: (
    cle: string,
    action: (etat: Resultat | null, donnees: FormData) => Promise<Resultat>,
    donnees: FormData,
    apres?: () => void,
  ) => Promise<void>;
};

/**
 * Fil des messages d'une consultation, avec la réponse au fournisseur.
 *
 * Rendu repliable et fermé par défaut : sur un dossier à plusieurs
 * fournisseurs, dérouler tous les fils d'emblée noierait l'essentiel. Il
 * s'ouvre de lui-même quand une précision est en attente — c'est le seul cas
 * qui appelle une action immédiate.
 */
export function FilConsultation({
  demandeId,
  consultationId,
  fournisseur,
  echanges,
  repondable,
  enCours,
  onEnvoyer,
}: Props) {
  const attenteReponse = echanges.some((e) => e.type === 'demande_precision');
  const [ouvert, setOuvert] = useState(attenteReponse);
  const [message, setMessage] = useState('');

  const entrants = echanges.filter((e) => e.direction === 'entrant');
  const cle = `reponse-${consultationId}`;
  const envoiEnCours = enCours === cle;

  if (echanges.length === 0) return null;

  function envoyer(): void {
    const fd = new FormData();
    fd.set('demandeId', String(demandeId));
    fd.set('consultationId', String(consultationId));
    fd.set('message', message);

    // Le champ n'est vidé qu'après un envoi réussi : sur échec, le texte
    // rédigé doit rester à l'écran.
    void onEnvoyer(cle, repondreFournisseur, fd, () => setMessage(''));
  }

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
        aria-expanded={ouvert}
      >
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">
          {echanges.length} message{echanges.length > 1 ? 's' : ''}
        </span>
        {attenteReponse && (
          <Badge variant="attention">Précision demandée</Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {ouvert ? 'Masquer' : 'Afficher'}
        </span>
      </button>

      {ouvert && (
        <div className="space-y-3 border-t p-3">
          {echanges.map((e) => (
            <div
              key={e.id}
              className={
                e.direction === 'entrant'
                  ? 'rounded-md border-l-2 border-l-amber-500 bg-muted/40 p-3'
                  : 'rounded-md border-l-2 border-l-muted-foreground/30 p-3'
              }
            >
              <div className="mb-1 flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {e.direction === 'entrant' ? (e.expediteur ?? fournisseur) : 'Nous'}
                </span>
                <span>{LIBELLE_TYPE[e.type] ?? e.type}</span>
                <span className="ml-auto">{formaterDate(e.date)}</span>
              </div>

              <CorpsMessage brut={e.corpsTexte} />
            </div>
          ))}

          {repondable && entrants.length > 0 && (
            <div className="space-y-2 border-t pt-3">
              <label htmlFor={`reponse-${consultationId}`} className="text-sm font-medium">
                Répondre à {fournisseur}
              </label>
              <Textarea
                id={`reponse-${consultationId}`}
                rows={4}
                value={message}
                onChange={(ev) => setMessage(ev.target.value)}
                placeholder="Votre réponse part dans le même fil de discussion — la signature est ajoutée automatiquement."
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={enCours !== null || message.trim().length < 10}
                  onClick={envoyer}
                >
                  {envoiEnCours ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Reply className="size-4" />
                  )}
                  Envoyer la réponse
                </Button>
                {attenteReponse && (
                  <span className="text-xs text-muted-foreground">
                    Les relances reprendront après l&apos;envoi.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
