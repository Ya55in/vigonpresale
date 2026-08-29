'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AlertTriangle,
  FileText,
  Info,
  Layers,
  Loader2,
  Lock,
  Send,
  ShieldCheck,
  Undo2,
} from 'lucide-react';

import {
  appliquerMargeGlobale,
  approuverSurPlaceAction,
  construireFeuille,
  construireFeuillesParFournisseur,
  modifierLigne,
  renvoyerCosting,
  soumettreValidation,
  validerCosting,
  type Resultat,
} from '@/app/(dashboard)/demandes/[id]/costing/actions';
import { genererOffre } from '@/app/(dashboard)/demandes/[id]/offre/actions';
import type {
  CriteresFournisseur,
  FeuilleFournisseur,
} from '@/lib/costing/requetes';
import { EditeurMarge, type LigneCout } from '@/components/costing/EditeurMarge';
import { SyntheseFournisseurs } from '@/components/costing/SyntheseFournisseurs';
import {
  TableauComparatif,
  type LigneAffichee,
} from '@/components/costing/TableauComparatif';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { LIBELLE_MODE, tauxAAfficher, type ModeCalcul } from '@/lib/costing/marge';
import { formaterMontant } from '@/lib/costing/requetes';

export type Totaux = {
  totalAchatHt: number;
  totalCoutsAdd: number;
  totalVenteHt: number;
  totalTva: number;
  totalTtc: number;
  margeValeur: number;
  margeGlobalePct: number;
};

type Props = {
  demandeId: number;
  comparatif: {
    lignes: LigneAffichee[];
    /** Une colonne par devis — voir `ColonneComparatif` côté requêtes. */
    colonnes: { devisId: number; libelle: string }[];
    criteres: CriteresFournisseur[];
    articlesSansOffre: string[];
  };
  feuille: {
    id: number;
    version: number;
    statut: string;
    mode: ModeCalcul;
    devise: string;
    tvaPct: number;
    lignes: LigneCout[];
    totaux: Totaux;
  } | null;
  feuillesFournisseur: FeuilleFournisseur[];
  decision: { autorise: boolean; escalade: boolean; motif?: string; libelleBouton: string };
  motifEscalade: string | null;
  seuils: { margeMin: number; montantMax: number };
  margeDefautPct: number;
  peutModifier: boolean;
  peutValider: boolean;
  peutReviser: boolean;
  /** Circuit d'approbation avant génération — voir `lib/validation/circuit`. */
  validation: {
    statut: 'aucune' | 'en_attente' | 'approuvee' | 'refusee' | 'expiree';
    motifRefus: string | null;
    lien: string | null;
    obligatoire: boolean;
    /** Vrai quand celui qui regarde EST l'approbateur : pas d'escalade à faire. */
    surPlace: boolean;
    destinataires: { nom: string; canal: string }[];
    parSecours: boolean;
  };
};

export function EcranCosting({
  demandeId,
  comparatif,
  feuille,
  feuillesFournisseur,
  decision,
  motifEscalade,
  seuils,
  margeDefautPct,
  peutModifier,
  peutValider,
  peutReviser,
  validation,
}: Props) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<Resultat | null>(null);

  const [mode, setMode] = useState<ModeCalcul>(feuille?.mode ?? 'markup');
  const [margeSaisie, setMargeSaisie] = useState(
    feuille
      ? tauxAAfficher(feuille.totaux.margeGlobalePct, feuille.mode).toFixed(1)
      : String(margeDefautPct),
  );

  // Aucune présélection : le prix le plus bas reste signalé en vert, mais ne
  // décide de rien. Retenir d'office le moins cher revenait à trancher à la
  // place du client, alors que le délai, la disponibilité ou la cohérence d'un
  // lot chez un seul fournisseur pèsent souvent davantage que quelques dirhams.
  const [selection, setSelection] = useState<Record<number, number>>({});

  const verrouille = feuille?.statut === 'verrouille';
  const soumettable = verrouille && validation.statut === 'aucune';

  // Un refus motivé n'est pas rattrapé d'un clic : la carte renvoie alors vers
  // la reprise du costing, comme pour l'escalade.
  const decidableSurPlace =
    validation.surPlace &&
    verrouille &&
    peutValider &&
    (validation.statut === 'aucune' ||
      validation.statut === 'en_attente' ||
      validation.statut === 'expiree');
  const soumis = feuille?.statut === 'soumis';
  const modifiable = peutModifier && !verrouille;

  // Une feuille verrouillée ne se modifie pas, mais elle doit pouvoir être
  // reprise : la reconstruction crée alors une version N+1 sans toucher à la
  // version validée, comme l'impose la spec.
  const [reprise, setReprise] = useState(false);
  const enReprise = verrouille && reprise && peutModifier;

  async function envoyer(
    cle: string,
    action: (etat: Resultat | null, donnees: FormData) => Promise<Resultat>,
    donnees: FormData,
  ): Promise<void> {
    setEnCours(cle);
    setRetour(null);
    const resultat = await action(null, donnees);
    setEnCours(null);
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

      {verrouille && (
        <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
          <div>
            <p className="font-medium text-emerald-900 dark:text-emerald-300">
              Costing verrouillé — version {feuille?.version}
            </p>
            <p className="text-emerald-900/80 dark:text-emerald-300/80">
              Toute reprise créera une version {(feuille?.version ?? 1) + 1}.
              {peutReviser && ' FINANCE conserve un droit de révision.'}
            </p>
            {peutModifier && !reprise && (
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => setReprise(true)}
              >
                <Undo2 className="size-4" />
                Reprendre en version {(feuille?.version ?? 1) + 1}
              </Button>
            )}
            {enReprise && (
              <p className="mt-2 text-xs font-medium text-emerald-900 dark:text-emerald-300">
                Reprise active : reconstruisez la feuille pour créer la version{' '}
                {(feuille?.version ?? 1) + 1}.
              </p>
            )}
          </div>
        </div>
      )}

      {soumis && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-300">
              En attente de validation FINANCE
            </p>
            {motifEscalade && (
              <p className="text-amber-900/80 dark:text-amber-300/80">{motifEscalade}</p>
            )}
          </div>
        </div>
      )}


      {/*
        CIRCUIT D'APPROBATION — la carte qui manquait.

        `soumettreValidation` et `definirValidationObligatoire` existaient depuis
        le 2026-08-16, complètes et éprouvées, mais AUCUN écran ne les appelait.
        Le circuit entier était donc inatteignable : jeton, page publique,
        décision, envoi Telegram — tout fonctionnait, rien ne pouvait être
        déclenché. C'est pourquoi l'affaire Agadir n'a jamais rien envoyé.
      */}
      {verrouille && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              Accord avant génération
              {!validation.obligatoire && (
                <span className="text-sm font-normal text-muted-foreground">
                  facultatif
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {validation.statut === 'aucune' && (
              <>
                <p className="text-sm text-muted-foreground">
                  {validation.obligatoire
                    ? 'L’offre ne pourra pas être générée tant que l’accord n’est pas donné.'
                    : 'La génération est possible sans accord. Soumettre laisse une trace de la décision.'}
                </p>

                {validation.surPlace ? (
                  /* L'escalade va vers quelqu'un d'autre : un administrateur
                     n'a personne au-dessus de lui à qui l'adresser. */
                  <p className="text-sm">
                    Vous êtes <strong>administrateur</strong> : l’accord se donne
                    ici, devant les montants.{' '}
                    <span className="text-muted-foreground">
                      Rien ne part par Telegram — la trace est la même.
                    </span>
                  </p>
                ) : validation.destinataires.length === 0 ? (
                  <p className="text-sm text-destructive">
                    Aucun administrateur actif pour décider. Créez-en un dans
                    /admin, ou autorisez un collaborateur à recevoir les validations.
                  </p>
                ) : (
                  <p className="text-sm">
                    Sera adressée à{' '}
                    <strong>
                      {validation.destinataires.map((d) => d.nom).join(', ')}
                    </strong>{' '}
                    <span className="text-muted-foreground">
                      (par {validation.destinataires[0]?.canal})
                    </span>
                    {validation.parSecours && (
                      <span className="text-muted-foreground">
                        {' '}— aucun administrateur joignable, suppléant retenu
                      </span>
                    )}
                  </p>
                )}
              </>
            )}

            {validation.statut === 'en_attente' && (
              <p className="text-sm text-muted-foreground">
                {validation.surPlace
                  ? 'Une demande vous attend. Tranchez ici, ou depuis le lien reçu — la première décision compte.'
                  : 'Demande envoyée, décision en attente. Le lien reste valable sept jours.'}
              </p>
            )}

            {validation.statut === 'approuvee' && (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">
                Accord donné — l’offre peut être générée.
              </p>
            )}

            {validation.statut === 'refusee' && (
              <p className="text-sm text-destructive">
                Refusé{validation.motifRefus ? ` — ${validation.motifRefus}` : ''}.
                Reprenez le costing avant de resoumettre.
              </p>
            )}

            {validation.statut === 'expiree' && (
              <p className="text-sm text-muted-foreground">
                Demande caduque, sans réponse dans les délais. Soumettez-en une
                nouvelle.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {/* L'administrateur tranche sur place — y compris une demande
                  qu'une avant-vente lui a soumise et qui l'attend ici. Un refus
                  déjà motivé n'est pas repris : il faut reprendre le costing. */}
              {decidableSurPlace && (
                <Button
                  size="sm"
                  disabled={enCours !== null}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set('demandeId', String(demandeId));
                    fd.set('costSheetId', String(feuille?.id ?? 0));
                    void envoyer('approuver', approuverSurPlaceAction, fd);
                  }}
                >
                  {enCours === 'approuver' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="size-4" />
                  )}
                  {validation.statut === 'en_attente'
                    ? 'Approuver maintenant'
                    : 'Approuver la génération'}
                </Button>
              )}

              {!validation.surPlace &&
                (soumettable || validation.statut === 'expiree') &&
                peutValider &&
                validation.destinataires.length > 0 && (
                  <Button
                    size="sm"
                    disabled={enCours !== null}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set('demandeId', String(demandeId));
                      fd.set('costSheetId', String(feuille?.id ?? 0));
                      void envoyer('soumettre', soumettreValidation, fd);
                    }}
                  >
                    {enCours === 'soumettre' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    Demander l’accord
                  </Button>
                )}

              {/* Le lien reste ouvrable depuis la plateforme : l'approbateur
                  peut aussi décider ici, sans passer par Telegram. */}
              {validation.lien && (
                <Button variant="outline" size="sm" asChild>
                  <a href={validation.lien} target="_blank" rel="noreferrer">
                    Ouvrir la page de décision
                  </a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!verrouille && !soumis && motifEscalade && feuille && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div>
            <p className="font-medium text-amber-900 dark:text-amber-300">
              Escalade FINANCE requise
            </p>
            <p className="text-amber-900/80 dark:text-amber-300/80">
              {motifEscalade}. Seuils en vigueur : marge ≥ {seuils.margeMin} %, montant ≤{' '}
              {seuils.montantMax.toLocaleString('fr-FR')}.
            </p>
          </div>
        </div>
      )}

      {comparatif.articlesSansOffre.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-300">
            {comparatif.articlesSansOffre.length} article(s) sans offre chiffrée
          </p>
          <p className="mt-0.5 text-amber-900/80 dark:text-amber-300/80">
            {comparatif.articlesSansOffre.join(', ')}
          </p>
        </div>
      )}

      {/* --- Comparatif des offres --- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Comparatif des prix d&apos;achat
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {comparatif.colonnes.length} devis —{' '}
              {comparatif.lignes.length} article(s)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {comparatif.lignes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun devis reçu : le comparatif s&apos;alimente à la réception.
            </p>
          ) : (
            <>
              {/* Les critères du devis avant l'arbitrage ligne à ligne : on
                  choisit un fournisseur sur un ensemble, pas sur un prix. */}
              <SyntheseFournisseurs
                criteres={comparatif.criteres}
                devise={feuille?.devise ?? 'MAD'}
              />

              <TableauComparatif
                lignes={comparatif.lignes}
                colonnes={comparatif.colonnes}
                selection={selection}
                onSelection={(item, offre) =>
                  setSelection((s) => ({ ...s, [item]: offre }))
                }
                modifiable={modifiable || enReprise}
                devise={feuille?.devise ?? 'MAD'}
              />

              {(modifiable || enReprise) && (
                <div className="flex flex-wrap items-end gap-3 border-t pt-3">
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Mode de calcul</span>
                    <select
                      value={mode}
                      onChange={(e) => setMode(e.target.value as ModeCalcul)}
                      className="h-9 w-64 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
                    >
                      <option value="markup">{LIBELLE_MODE.markup}</option>
                      <option value="marge">{LIBELLE_MODE.marge}</option>
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">
                      {mode === 'marge' ? 'Marge brute %' : 'Markup %'}
                    </span>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max={mode === 'marge' ? '99' : '1000'}
                      value={margeSaisie}
                      onChange={(e) => setMargeSaisie(e.target.value)}
                      className="w-28"
                    />
                  </label>

                  <Button
                    disabled={enCours !== null}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set('demandeId', String(demandeId));
                      fd.set('selection', JSON.stringify(selection));
                      fd.set('margeGlobalePct', margeSaisie);
                      fd.set('modeCalcul', mode);
                      void envoyer('construire', construireFeuille, fd);
                    }}
                  >
                    {enCours === 'construire' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    {enReprise
                      ? `Créer la version ${(feuille?.version ?? 1) + 1}`
                      : feuille
                        ? 'Reconstruire la feuille'
                        : 'Construire la feuille de coûts'}
                  </Button>

                  {/* Second parcours : une feuille — donc une offre — par
                      fournisseur, que le client compare lui-même. Aucune
                      sélection n'est requise, chaque devis étant pris en bloc. */}
                  <Button
                    variant="outline"
                    disabled={enCours !== null}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set('demandeId', String(demandeId));
                      fd.set('margeGlobalePct', margeSaisie);
                      fd.set('modeCalcul', mode);
                      void envoyer('par-fournisseur', construireFeuillesParFournisseur, fd);
                    }}
                  >
                    {enCours === 'par-fournisseur' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Layers className="size-4" />
                    )}
                    Une feuille par fournisseur
                  </Button>
                </div>
              )}

              {(modifiable || enReprise) && (
                <p className="text-xs text-muted-foreground">
                  Le prix le plus bas est signalé en vert, mais n&apos;est jamais
                  retenu d&apos;office : le délai, la disponibilité ou la cohérence
                  d&apos;un lot chez un seul fournisseur pèsent souvent davantage.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* --- Feuilles par fournisseur, et offre produite depuis chacune --- */}
      {feuillesFournisseur.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Offres par fournisseur
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {feuillesFournisseur.length} feuille(s) — le client compare et choisit
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase text-muted-foreground">
                    <th className="py-2 text-left font-medium">Fournisseur</th>
                    <th className="py-2 text-left font-medium">Couverture</th>
                    <th className="py-2 text-right font-medium">Total HT</th>
                    <th className="py-2 text-left font-medium">État</th>
                    <th className="py-2 text-left font-medium">Offre</th>
                  </tr>
                </thead>
                <tbody>
                  {feuillesFournisseur.map((f) => {
                    const complete = f.articlesCouverts === f.articlesDemandes;
                    const verrouillee = f.statut === 'verrouille';

                    return (
                      <tr key={f.id} className="border-b last:border-0">
                        <td className="py-2 font-medium">
                          {f.fournisseurNom ??
                            (f.nbFournisseurs > 1 ? (
                              <>
                                Multi-fournisseurs
                                <span className="ml-1 font-normal text-muted-foreground">
                                  ({f.nbFournisseurs})
                                </span>
                              </>
                            ) : (
                              // Aucune ligne rattachée : anomalie de données, pas
                              // un panachage. La nommer autrement induirait en erreur.
                              <span className="text-muted-foreground">
                                Fournisseur non renseigné
                              </span>
                            ))}
                        </td>
                        <td className="py-2">
                          <span className={complete ? undefined : 'text-amber-700 dark:text-amber-400'}>
                            {f.articlesCouverts}/{f.articlesDemandes} article(s)
                          </span>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {formaterMontant(f.totalVenteHt, feuille?.devise ?? 'MAD')}
                        </td>
                        <td className="py-2">
                          <Badge variant={verrouillee ? 'succes' : 'info'}>
                            {verrouillee ? 'Verrouillée' : f.statut}
                          </Badge>
                        </td>
                        <td className="py-2">
                          {f.offreNumero ? (
                            <span className="font-mono text-xs">{f.offreNumero}</span>
                          ) : verrouillee ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={enCours !== null}
                              onClick={() => {
                                const fd = new FormData();
                                fd.set('demandeId', String(demandeId));
                                fd.set('costSheetId', String(f.id));
                                // Adapté : l'action offre exige un message dans
                                // son résultat, le costing le rend optionnel.
                                void envoyer(
                                  `offre-${f.id}`,
                                  (_etat, donnees) => genererOffre(null, donnees),
                                  fd,
                                );
                              }}
                            >
                              {enCours === `offre-${f.id}` ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <FileText className="size-4" />
                              )}
                              Générer l&apos;offre
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              à verrouiller d&apos;abord
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              Une couverture incomplète ne bloque rien : les articles non chiffrés
              apparaissent dans l&apos;offre sous « Articles non couverts », et le
              client arbitre. La génération prend une minute environ par offre.
            </p>
          </CardContent>
        </Card>
      )}

      {/* --- Feuille de coûts --- */}
      {feuille && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              Feuille de coûts
              <Badge variant="neutre">v{feuille.version}</Badge>
              <Badge
                variant={
                  verrouille ? 'succes' : soumis ? 'attention' : 'info'
                }
              >
                {verrouille ? 'Verrouillée' : soumis ? 'Soumise' : 'Brouillon'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <EditeurMarge
              lignes={feuille.lignes}
              mode={feuille.mode}
              devise={feuille.devise}
              modifiable={modifiable}
              enCours={enCours}
              onModifierLigne={(ligneId, champs) => {
                const fd = new FormData();
                fd.set('demandeId', String(demandeId));
                fd.set('ligneId', String(ligneId));
                if (champs.margePct !== undefined) {
                  fd.set('margePct', String(champs.margePct));
                }
                if (champs.coutAdditionnel !== undefined) {
                  fd.set('coutAdditionnel', String(champs.coutAdditionnel));
                }
                if (champs.coutLibelle !== undefined) fd.set('coutLibelle', champs.coutLibelle);
                if (champs.commentaire !== undefined) fd.set('commentaire', champs.commentaire);
                void envoyer(`ligne-${ligneId}`, modifierLigne, fd);
              }}
            />

            {modifiable && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Appliquer à toutes les lignes
                  </span>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max={feuille.mode === 'marge' ? '99' : '1000'}
                    value={margeSaisie}
                    onChange={(e) => setMargeSaisie(e.target.value)}
                    className="w-28"
                  />
                </label>
                <Button
                  variant="outline"
                  disabled={enCours !== null}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set('demandeId', String(demandeId));
                    fd.set('margePct', margeSaisie);
                    void envoyer('marge-globale', appliquerMargeGlobale, fd);
                  }}
                >
                  {enCours === 'marge-globale' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Appliquer la marge
                </Button>
              </div>
            )}

            {/* --- Totaux --- */}
            <div className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <Total libelle="Total achat HT" valeur={feuille.totaux.totalAchatHt} devise={feuille.devise} />
              <Total libelle="Coûts additionnels" valeur={feuille.totaux.totalCoutsAdd} devise={feuille.devise} />
              <Total libelle="Total vente HT" valeur={feuille.totaux.totalVenteHt} devise={feuille.devise} accent />
              <Total
                libelle={`TVA ${feuille.tvaPct} %`}
                valeur={feuille.totaux.totalTva}
                devise={feuille.devise}
              />
              <Total libelle="Total TTC" valeur={feuille.totaux.totalTtc} devise={feuille.devise} accent />
              <Total libelle="Marge en valeur" valeur={feuille.totaux.margeValeur} devise={feuille.devise} accent />
              <div className="space-y-0.5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Marge globale
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {tauxAAfficher(feuille.totaux.margeGlobalePct, feuille.mode).toFixed(1)} %
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    {feuille.mode === 'marge' ? 'brute' : 'markup'}
                  </span>
                </p>
              </div>
            </div>

            {/* --- Validation --- */}
            {!verrouille && (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                {peutValider && (
                  <Button
                    disabled={enCours !== null || (!decision.autorise && !decision.escalade)}
                    variant={decision.autorise ? 'default' : 'secondary'}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set('demandeId', String(demandeId));
                      void envoyer('valider', validerCosting, fd);
                    }}
                  >
                    {enCours === 'valider' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : decision.autorise ? (
                      <Lock className="size-4" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    {decision.libelleBouton}
                  </Button>
                )}

                {peutReviser && soumis && (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      fd.set('demandeId', String(demandeId));
                      void envoyer('renvoyer', renvoyerCosting, fd);
                    }}
                  >
                    <label className="space-y-1">
                      <span className="text-xs text-muted-foreground">
                        Motif de renvoi
                      </span>
                      <Input name="motif" required minLength={3} className="w-72" />
                    </label>
                    <Button type="submit" variant="outline" disabled={enCours !== null}>
                      {enCours === 'renvoyer' ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Undo2 className="size-4" />
                      )}
                      Renvoyer à l&apos;avant-vente
                    </Button>
                  </form>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Total({
  libelle,
  valeur,
  devise,
  accent,
}: {
  libelle: string;
  valeur: number;
  devise: string;
  accent?: boolean;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{libelle}</p>
      <p className={accent ? 'text-lg font-semibold tabular-nums' : 'tabular-nums'}>
        {formaterMontant(valeur, devise)}
      </p>
    </div>
  );
}
