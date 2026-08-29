'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Globe, Loader2, Plus, Power, Search, Star, Trash2, Users, X } from 'lucide-react';

import {
  LANGUES,
  LIBELLES_LANGUE,
  initialesSuggerees,
  type Langue,
} from '@vigon/shared';

import {
  ajouterContact,
  ajouterFournisseur,
  basculerFournisseur,
  definirInitiales,
  definirLangue,
  supprimerContact,
  type Resultat,
} from '@/app/(dashboard)/fournisseurs/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type FournisseurAffiche = {
  id: number;
  marque: string;
  nom: string;
  email: string | null;
  telephone: string | null;
  siteWeb: string | null;
  pays: string | null;
  source: string;
  actif: boolean;
  nbConsultations: number;
  nbReponses: number;
  /** Langue des demandes de devis et des relances adressées à ce fournisseur. */
  langue: Langue;
  /** Vraie tant qu'aucune langue n'a été choisie : elle vient alors du pays. */
  langueDeduite: boolean;
  /** Étiquette courte saisie à la main, jamais générée d'office. */
  initiales: string | null;
  /**
   * Correspondants déclarés, le principal en tête.
   *
   * Vide pour les fiches d'origine : leurs consultations partent alors à
   * l'adresse de la fiche, sans copie, exactement comme avant.
   */
  contacts: {
    id: number;
    nom: string | null;
    email: string;
    fonction: string | null;
    principal: boolean;
  }[];
};

export function EcranFournisseurs({
  fournisseurs,
  modifiable,
}: {
  fournisseurs: FournisseurAffiche[];
  modifiable: boolean;
}) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  /** Fiche dont le panneau contacts est déplié ; une seule à la fois. */
  const [detail, setDetail] = useState<number | null>(null);
  const [retour, setRetour] = useState<Resultat | null>(null);
  const [ajout, setAjout] = useState(false);
  const [filtre, setFiltre] = useState('');

  const visibles = fournisseurs.filter((f) => {
    if (!filtre.trim()) return true;
    const q = filtre.toLowerCase();
    return (
      f.marque.toLowerCase().includes(q) ||
      f.nom.toLowerCase().includes(q) ||
      (f.email ?? '').toLowerCase().includes(q)
    );
  });

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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
            placeholder="Marque, entreprise ou e-mail…"
            className="pl-8"
            aria-label="Filtrer les fournisseurs"
          />
        </div>

        {modifiable && !ajout && (
          <Button onClick={() => setAjout(true)}>
            <Plus className="size-4" />
            Ajouter un fournisseur
          </Button>
        )}
      </div>

      {ajout && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nouveau fournisseur</CardTitle>
            <p className="text-sm text-muted-foreground">
              À saisir quand la recherche automatique n&apos;a trouvé aucun contact
              exploitable pour une marque.
            </p>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void envoyer('ajout', ajouterFournisseur, new FormData(e.currentTarget), () =>
                  setAjout(false),
                );
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Marque *</span>
                  <Input name="marque" required maxLength={200} placeholder="Cisco" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Entreprise *</span>
                  <Input name="nom" required maxLength={300} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">E-mail commercial *</span>
                  <Input name="email" type="email" required maxLength={300} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Téléphone</span>
                  <Input name="telephone" maxLength={50} />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Site web</span>
                  <Input name="siteWeb" maxLength={500} placeholder="https://" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Pays</span>
                  <Input name="pays" maxLength={100} defaultValue="Maroc" />
                </label>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={enCours !== null}>
                  {enCours === 'ajout' && <Loader2 className="size-4 animate-spin" />}
                  Ajouter
                </Button>
                <Button type="button" variant="ghost" onClick={() => setAjout(false)}>
                  <X className="size-4" />
                  Annuler
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {visibles.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="font-medium">
            {fournisseurs.length === 0
              ? 'Aucun fournisseur enregistré'
              : 'Aucun fournisseur ne correspond'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Les fournisseurs sont créés automatiquement lors de la préparation des
            consultations, ou ajoutés à la main ici.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Marque</TableHead>
                <TableHead>Entreprise</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Origine</TableHead>
                <TableHead>Langue</TableHead>
                <TableHead className="text-right">Consultations</TableHead>
                <TableHead>État</TableHead>
                {modifiable && <TableHead className="w-36" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.flatMap((f) => [
                <TableRow key={f.id} className={f.actif ? undefined : 'opacity-60'}>
                  <TableCell className="font-medium">{f.marque}</TableCell>
                  <TableCell>
                    <p>{f.nom}</p>
                    {f.pays && (
                      <p className="text-xs text-muted-foreground">{f.pays}</p>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[16rem]">
                    <p className="truncate text-sm">{f.email ?? '—'}</p>
                    {f.telephone && (
                      <p className="text-xs text-muted-foreground">{f.telephone}</p>
                    )}
                    {f.siteWeb && (
                      <a
                        href={f.siteWeb}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Globe className="size-3" />
                        site
                      </a>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={f.source === 'manuel' ? 'info' : 'neutre'}>
                      {f.source === 'manuel' ? 'saisi' : f.source === 'web' ? 'sourcing web' : f.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {modifiable ? (
                      <>
                        <select
                          value={f.langue}
                          disabled={enCours !== null}
                          aria-label={`Langue de correspondance de ${f.nom}`}
                          onChange={(e) => {
                            const fd = new FormData();
                            fd.set('id', String(f.id));
                            fd.set('langue', e.target.value);
                            void envoyer(`langue-${f.id}`, definirLangue, fd);
                          }}
                          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm"
                        >
                          {LANGUES.map((l) => (
                            <option key={l} value={l}>
                              {LIBELLES_LANGUE[l]}
                            </option>
                          ))}
                        </select>
                        {f.langueDeduite && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            déduite du pays
                          </p>
                        )}
                      </>
                    ) : (
                      <span className="text-sm">{LIBELLES_LANGUE[f.langue]}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {f.nbConsultations > 0 ? (
                      <span title={`${f.nbReponses} réponse(s)`}>
                        {f.nbReponses}/{f.nbConsultations}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={f.actif ? 'succes' : 'secondary'}>
                      {f.actif ? 'actif' : 'inactif'}
                    </Badge>
                  </TableCell>
                  {modifiable && (
                    <TableCell className="space-y-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={detail === f.id}
                        onClick={() => setDetail((v) => (v === f.id ? null : f.id))}
                      >
                        <Users className="size-4" />
                        {f.contacts.length > 0 ? `${f.contacts.length} contact(s)` : 'Contacts'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={enCours !== null}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set('id', String(f.id));
                          fd.set('actif', f.actif ? 'false' : 'true');
                          void envoyer(`bascule-${f.id}`, basculerFournisseur, fd);
                        }}
                      >
                        {enCours === `bascule-${f.id}` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Power className="size-4" />
                        )}
                        {f.actif ? 'Désactiver' : 'Activer'}
                      </Button>
                    </TableCell>
                  )}
                </TableRow>,
                modifiable && detail === f.id ? (
                  <TableRow key={`${f.id}-detail`} className="hover:bg-transparent">
                    <TableCell colSpan={9} className="bg-muted/30 p-0">
                      <PanneauContacts
                        fournisseur={f}
                        enCours={enCours}
                        onAction={envoyer}
                      />
                    </TableCell>
                  </TableRow>
                ) : null,
              ]).flat()}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Un fournisseur désactivé reste dans l&apos;historique mais n&apos;est plus
        retenu lors de la préparation des consultations.
      </p>
    </div>
  );
}

/**
 * Contacts et initiales d'un fournisseur, dépliés sous sa ligne.
 *
 * Un panneau plutôt que des colonnes supplémentaires : la ligne en compte déjà
 * huit, et l'édition des contacts est ponctuelle — on la consulte pour un
 * fournisseur à la fois, pas en balayant la liste.
 *
 * L'écran dit ce qui partira réellement. Un fournisseur sans contact déclaré
 * reçoit ses consultations à l'adresse de sa fiche, sans copie : c'est le cas
 * de toutes les fiches existantes, et le panneau l'énonce plutôt que de laisser
 * croire à une configuration manquante.
 */
function PanneauContacts({
  fournisseur: f,
  enCours,
  onAction,
}: {
  fournisseur: FournisseurAffiche;
  enCours: string | null;
  onAction: (
    cle: string,
    action: (etat: Resultat | null, donnees: FormData) => Promise<Resultat>,
    donnees: FormData,
    apres?: () => void,
  ) => Promise<void>;
}) {
  const [nouveau, setNouveau] = useState(false);

  const principal = f.contacts.find((c) => c.principal);
  // Ce que le worker enverra réellement, calculé comme `resoudreDestinataires`.
  const destinataire = principal?.email ?? f.email ?? '—';
  const enCopie = f.contacts
    .map((c) => c.email)
    .concat(f.email && principal ? [f.email] : [])
    .filter((e) => e.toLowerCase() !== destinataire.toLowerCase());

  return (
    <div className="space-y-4 p-4">
      {/* --- Initiales --- */}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onAction(`initiales-${f.id}`, definirInitiales, new FormData(e.currentTarget));
        }}
      >
        <input type="hidden" name="id" value={f.id} />
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Initiales</span>
          <Input
            name="initiales"
            defaultValue={f.initiales ?? ''}
            maxLength={6}
            placeholder={initialesSuggerees(f.nom)}
            className="h-8 w-28"
          />
        </label>
        <Button type="submit" variant="outline" size="sm" disabled={enCours !== null}>
          {enCours === `initiales-${f.id}` && <Loader2 className="size-4 animate-spin" />}
          Enregistrer
        </Button>
        <p className="text-xs text-muted-foreground">
          Six caractères au plus. Suggestion : {initialesSuggerees(f.nom) || '—'}
        </p>
      </form>

      {/* --- Ce qui partira réellement --- */}
      <div className="rounded-md border bg-background px-3 py-2 text-sm">
        <p>
          <span className="text-muted-foreground">Destinataire :</span>{' '}
          <span className="font-medium">{destinataire}</span>
          {!principal && f.email && (
            <span className="text-xs text-muted-foreground"> (adresse de la fiche)</span>
          )}
        </p>
        {enCopie.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            En copie : {enCopie.join(', ')}
          </p>
        )}
      </div>

      {/* --- Contacts déclarés --- */}
      {f.contacts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun contact déclaré — les consultations partent à l&apos;adresse de la
          fiche, sans copie.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {f.contacts.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm">
                  {c.principal && (
                    <Star className="size-3.5 shrink-0 fill-current text-amber-500" />
                  )}
                  <span className="truncate font-medium">{c.email}</span>
                </p>
                {(c.nom ?? c.fonction) && (
                  <p className="text-xs text-muted-foreground">
                    {[c.nom, c.fonction].filter(Boolean).join(' — ')}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={enCours !== null}
                aria-label={`Retirer ${c.email}`}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('id', String(c.id));
                  fd.set('fournisseurId', String(f.id));
                  void onAction(`suppr-${c.id}`, supprimerContact, fd);
                }}
              >
                {enCours === `suppr-${c.id}` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* --- Ajout --- */}
      {nouveau ? (
        <form
          className="space-y-2 rounded-md border bg-background p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onAction(
              `contact-${f.id}`,
              ajouterContact,
              new FormData(e.currentTarget),
              () => setNouveau(false),
            );
          }}
        >
          <input type="hidden" name="fournisseurId" value={f.id} />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">E-mail *</span>
              <Input name="email" type="email" required maxLength={300} className="h-8" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Nom</span>
              <Input name="nom" maxLength={200} className="h-8" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Fonction</span>
              <Input
                name="fonction"
                maxLength={120}
                placeholder="Service devis"
                className="h-8"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Téléphone</span>
              <Input name="telephone" maxLength={50} className="h-8" />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="principal" value="true" className="size-4" />
            Destinataire principal — remplace l&apos;adresse de la fiche, qui
            passe en copie
          </label>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={enCours !== null}>
              {enCours === `contact-${f.id}` && <Loader2 className="size-4 animate-spin" />}
              Ajouter
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNouveau(false)}>
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setNouveau(true)}>
          <Plus className="size-4" />
          Ajouter un contact
        </Button>
      )}
    </div>
  );
}

