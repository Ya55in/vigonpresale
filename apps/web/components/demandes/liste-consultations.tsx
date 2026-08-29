'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Clock,
  Loader2,
  Pencil,
  RotateCcw,
  Send,
  MessageSquare,
  Reply,
  Sparkles,
  X,
} from 'lucide-react';

import {
  annulerPlanification,
  exclureConsultation,
  modifierConsultation,
  planifierEnvoi,
  preparerConsultations,
  repondreFournisseur,
  type Resultat,
} from '@/app/(dashboard)/demandes/[id]/consultations/actions';
import { FilConsultation } from '@/components/demandes/fil-consultation';
import { PropositionFournisseurs } from '@/components/consultations/PropositionFournisseurs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  STATUTS_CONSULTATION,
  type EchangeConsultation,
  type StatutConsultation,
} from '@/lib/consultations/requetes';

/** Contenu du message, découpé comme il a été rédigé — jamais du HTML. */
export type ContenuConsultation = {
  intro: string;
  transition: string;
  articles: string[];
  questions_intro: string;
  questions: string[];
  cloture: string;
};

export type ConsultationAffichee = {
  id: number;
  marque: string | null;
  fournisseur_nom: string | null;
  fournisseur_email: string | null;
  sujet: string | null;
  corps_html: string | null;
  contenu: ContenuConsultation;
  statut: StatutConsultation;
  date_envoi_prevue: string | null;
  date_envoi_reelle: string | null;
  relances: number;
  /** Fil des messages échangés avec ce fournisseur, du plus ancien au plus récent. */
  echanges: EchangeConsultation[];
};

type Props = {
  demandeId: number;
  consultations: ConsultationAffichee[];
  marquesSansFournisseur: string[];
  modifiable: boolean;
  planifiable: boolean;
};

/** Options rapides imposées par la spec, plus une date libre. */
const RACCOURCIS: { libelle: string; minutes: number }[] = [
  { libelle: 'Dans 30 min', minutes: 30 },
  { libelle: 'Dans 1 h', minutes: 60 },
  { libelle: 'Dans 4 h', minutes: 240 },
];

/** Demain 9 h, heure locale. */
function demain9h(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Format attendu par <input type="datetime-local"> (heure locale). */
function pourInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formaterDateHeure(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ListeConsultations({
  demandeId,
  consultations,
  marquesSansFournisseur,
  modifiable,
  planifiable,
}: Props) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<Resultat | null>(null);
  const [edition, setEdition] = useState<number | null>(null);
  const [planification, setPlanification] = useState(false);
  const [dateLibre, setDateLibre] = useState(pourInput(demain9h()));

  const aValider = consultations.filter((c) => c.statut === 'en_validation');
  // Tant que le worker n'a rien expédié, la date reste modifiable et l'envoi
  // annulable : sans ça, une planification est définitive dès le premier clic.
  const planifiees = consultations.filter((c) => c.statut === 'planifiee');
  const modifiablesAvantEnvoi = aValider.length + planifiees.length;

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

  function planifier(date: Date | null): void {
    const fd = new FormData();
    fd.set('demandeId', String(demandeId));
    if (date) fd.set('dateEnvoi', date.toISOString());
    void envoyer('planifier', planifierEnvoi, fd, () => setPlanification(false));
  }

  function annuler(): void {
    const fd = new FormData();
    fd.set('demandeId', String(demandeId));
    void envoyer('annuler', annulerPlanification, fd, () => setPlanification(false));
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

      {marquesSansFournisseur.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-300">
            <AlertTriangle className="size-4" />
            {marquesSansFournisseur.length} marque(s) sans consultation
          </p>
          <p className="mt-1 text-amber-900/80 dark:text-amber-300/80">
            {marquesSansFournisseur.join(', ')} — ajoutez un fournisseur depuis
            l&apos;écran Fournisseurs, puis relancez la préparation.
          </p>
        </div>
      )}

      {/* Avant la liste : on choisit qui consulter avant de voir ce qui est
          déjà parti. Après la première préparation, l'écran garde son intérêt
          pour compléter avec un fournisseur qu'on avait écarté. */}
      {modifiable && (
        <PropositionFournisseurs
          demandeId={demandeId}
          modifiable={modifiable}
          enCours={enCours === 'preparer'}
          onPreparer={(ids) => {
            const fd = new FormData();
            fd.set('demandeId', String(demandeId));
            fd.set('retenus', ids.join(','));
            void envoyer('preparer', preparerConsultations, fd);
          }}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {consultations.length} consultation{consultations.length > 1 ? 's' : ''}
          {aValider.length > 0 && ` — ${aValider.length} à valider`}
        </p>

        <div className="flex flex-wrap gap-2">
          {modifiable && (
            <Button
              variant="outline"
              size="sm"
              disabled={enCours !== null}
              onClick={() => {
                const fd = new FormData();
                fd.set('demandeId', String(demandeId));
                void envoyer('preparer', preparerConsultations, fd);
              }}
            >
              {enCours === 'preparer' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {consultations.length > 0 ? 'Compléter' : 'Préparer les consultations'}
            </Button>
          )}

          {planifiable && modifiablesAvantEnvoi > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={enCours !== null}
                onClick={() => setPlanification((v) => !v)}
              >
                <Clock className="size-4" />
                {planifiees.length > 0 ? 'Changer la date' : 'Planifier'}
              </Button>

              {planifiees.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={enCours !== null}
                  onClick={annuler}
                >
                  {enCours === 'annuler' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <X className="size-4" />
                  )}
                  Annuler l&apos;envoi ({planifiees.length})
                </Button>
              )}

              <Button
                size="sm"
                disabled={enCours !== null}
                onClick={() => planifier(null)}
              >
                {enCours === 'planifier' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Envoyer maintenant ({modifiablesAvantEnvoi})
              </Button>
            </>
          )}
        </div>
      </div>

      {planification && planifiable && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Planifier l&apos;envoi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {RACCOURCIS.map((r) => (
                <Button
                  key={r.libelle}
                  variant="secondary"
                  size="sm"
                  disabled={enCours !== null}
                  onClick={() => planifier(new Date(Date.now() + r.minutes * 60_000))}
                >
                  {r.libelle}
                </Button>
              ))}
              <Button
                variant="secondary"
                size="sm"
                disabled={enCours !== null}
                onClick={() => planifier(demain9h())}
              >
                Demain 9 h
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">
                  Ou une date précise
                </span>
                <Input
                  type="datetime-local"
                  value={dateLibre}
                  min={pourInput(new Date())}
                  onChange={(e) => setDateLibre(e.target.value)}
                  className="w-56"
                />
              </label>
              <Button
                size="sm"
                disabled={enCours !== null || !dateLibre}
                onClick={() => planifier(new Date(dateLibre))}
              >
                Planifier
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {consultations.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="font-medium">Aucune consultation préparée</p>
          <p className="mt-1 text-sm text-muted-foreground">
            La préparation regroupe les articles par marque, cherche un
            fournisseur puis rédige une demande de devis anonymisée.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {consultations.map((consultation) => (
            <CarteConsultation
              key={consultation.id}
              consultation={consultation}
              demandeId={demandeId}
              modifiable={modifiable}
              planifiable={planifiable}
              enEdition={edition === consultation.id}
              enCours={enCours}
              onEditer={() => {
                setRetour(null);
                setEdition(consultation.id);
              }}
              onFermer={() => setEdition(null)}
              onEnvoyer={envoyer}
              onPlanifierUne={(date) => {
                const fd = new FormData();
                fd.set('demandeId', String(demandeId));
                fd.set('id', String(consultation.id));
                if (date) fd.set('dateEnvoi', date.toISOString());
                void envoyer(`planifier-${consultation.id}`, planifierEnvoi, fd);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Champ de saisie du message : du texte lisible, jamais de balises. */
function Champ({
  nom,
  libelle,
  aide,
  valeur,
  lignes,
}: {
  nom: string;
  libelle: string;
  aide?: string;
  valeur: string;
  lignes: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">
        {libelle}
        {aide && <span className="ml-1.5 opacity-70">· {aide}</span>}
      </span>
      <Textarea name={nom} defaultValue={valeur} rows={lignes} required />
    </label>
  );
}

function CarteConsultation({
  consultation,
  demandeId,
  modifiable,
  planifiable,
  enEdition,
  enCours,
  onEditer,
  onFermer,
  onEnvoyer,
  onPlanifierUne,
}: {
  consultation: ConsultationAffichee;
  demandeId: number;
  modifiable: boolean;
  planifiable: boolean;
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
  onPlanifierUne: (date: Date | null) => void;
}) {
  const statut = STATUTS_CONSULTATION[consultation.statut];
  const exclue = consultation.statut === 'abandonnee';
  const figee = ['envoyee', 'relancee', 'devis_recu', 'precision_demandee'].includes(
    consultation.statut,
  );

  return (
    <Card className={exclue ? 'opacity-60' : undefined}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {consultation.marque ?? '—'}
              <Badge variant={statut.apparence}>{statut.libelle}</Badge>
              {consultation.relances > 0 && (
                <Badge variant="neutre">{consultation.relances} relance(s)</Badge>
              )}
            </CardTitle>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {consultation.fournisseur_nom} &lt;{consultation.fournisseur_email}&gt;
            </p>
          </div>

          <div className="flex shrink-0 gap-1">
            {modifiable && !figee && !exclue && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={`Modifier la consultation ${consultation.marque}`}
                disabled={enCours !== null}
                onClick={onEditer}
              >
                <Pencil className="size-4" />
              </Button>
            )}
            {modifiable && !figee && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={
                  exclue
                    ? `Rétablir la consultation ${consultation.marque}`
                    : `Exclure la consultation ${consultation.marque}`
                }
                disabled={enCours !== null}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('id', String(consultation.id));
                  fd.set('demandeId', String(demandeId));
                  if (exclue) fd.set('retablir', 'true');
                  void onEnvoyer(`exclure-${consultation.id}`, exclureConsultation, fd);
                }}
              >
                {exclue ? <RotateCcw className="size-4" /> : <Ban className="size-4" />}
              </Button>
            )}
            {planifiable && consultation.statut === 'planifiee' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={enCours !== null}
                aria-label={`Annuler l'envoi de la consultation ${consultation.marque}`}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('demandeId', String(demandeId));
                  fd.set('id', String(consultation.id));
                  void onEnvoyer(
                    `annuler-${consultation.id}`,
                    annulerPlanification,
                    fd,
                  );
                }}
              >
                {enCours === `annuler-${consultation.id}` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <X className="size-4" />
                )}
                Annuler
              </Button>
            )}
            {planifiable &&
              ['en_validation', 'planifiee'].includes(consultation.statut) && (
              <Button
                variant="outline"
                size="sm"
                disabled={enCours !== null}
                onClick={() => onPlanifierUne(null)}
              >
                {enCours === `planifier-${consultation.id}` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Envoyer
              </Button>
            )}
          </div>
        </div>

        {(consultation.date_envoi_prevue ?? consultation.date_envoi_reelle) && (
          <p className="text-xs text-muted-foreground">
            {consultation.date_envoi_reelle
              ? `Envoyée le ${formaterDateHeure(consultation.date_envoi_reelle)}`
              : `Envoi prévu le ${formaterDateHeure(consultation.date_envoi_prevue)}`}
          </p>
        )}
      </CardHeader>

      <CardContent>
        {enEdition ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set('id', String(consultation.id));
              fd.set('demandeId', String(demandeId));
              void onEnvoyer(
                `modifier-${consultation.id}`,
                modifierConsultation,
                fd,
                onFermer,
              );
            }}
            className="space-y-3"
          >
            <label className="block space-y-1">
              <span className="text-xs text-muted-foreground">Objet</span>
              <Input name="sujet" defaultValue={consultation.sujet ?? ''} required />
            </label>

            <Champ
              nom="intro"
              libelle="Introduction"
              valeur={consultation.contenu.intro}
              lignes={3}
            />
            <Champ
              nom="transition"
              libelle="Phrase d'amorce de la liste"
              valeur={consultation.contenu.transition}
              lignes={2}
            />
            <Champ
              nom="articles"
              libelle="Articles"
              aide="Une ligne par article"
              valeur={consultation.contenu.articles.join('\n')}
              lignes={5}
            />
            <Champ
              nom="questionsIntro"
              libelle="Phrase d'amorce des questions"
              valeur={consultation.contenu.questions_intro}
              lignes={2}
            />
            <Champ
              nom="questions"
              libelle="Questions"
              aide="Une ligne par question"
              valeur={consultation.contenu.questions.join('\n')}
              lignes={5}
            />
            <Champ
              nom="cloture"
              libelle="Formule de clôture"
              valeur={consultation.contenu.cloture}
              lignes={2}
            />

            <p className="text-xs text-muted-foreground">
              La mise en forme de l&apos;e-mail est réassemblée à
              l&apos;enregistrement — la signature est ajoutée automatiquement.
            </p>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={enCours !== null}>
                {enCours === `modifier-${consultation.id}` && (
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
        ) : (
          <div className="space-y-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Objet : </span>
              {consultation.sujet ?? '—'}
            </p>
            {/* srcDoc isole le rendu : le HTML de l'e-mail ne peut ni hériter
                des styles de l'application ni exécuter de script dans sa page. */}
            <iframe
              title={`Aperçu de la consultation ${consultation.marque}`}
              srcDoc={consultation.corps_html ?? ''}
              sandbox=""
              className="h-72 w-full rounded-md border bg-white"
            />
          </div>
        )}

        {/* Fil des échanges : c'est là que se lit une demande de précision et
            que s'y répond, sans quitter le dossier. */}
        <FilConsultation
          demandeId={demandeId}
          consultationId={consultation.id}
          fournisseur={
            consultation.fournisseur_nom ?? consultation.fournisseur_email ?? 'ce fournisseur'
          }
          echanges={consultation.echanges}
          repondable={modifiable && consultation.date_envoi_reelle !== null}
          enCours={enCours}
          onEnvoyer={onEnvoyer}
        />
      </CardContent>
    </Card>
  );
}
