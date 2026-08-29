'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Save, Send, ShieldOff, ShieldCheck, UserPlus, X } from 'lucide-react';

import {
  basculerActif,
  changerRole,
  definirContactsNotification,
  definirValidationObligatoire,
  enregistrerParametre,
  inviterUtilisateur,
  renvoyerInvitation,
  type Resultat,
} from '@/app/(dashboard)/admin/actions';
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

export type UtilisateurAdmin = {
  id: string;
  email: string;
  nomComplet: string;
  role: 'admin' | 'presale' | 'finance' | 'after_sales';
  actif: boolean;
  /** Faux tant que la personne ne s'est jamais connectée. */
  rattache: boolean;
  /** Numéro WhatsApp, format international. Vide = canal sauté. */
  telephone: string | null;
  /** Identifiant du chat Telegram avec le bot. Vide = canal sauté. */
  telegramChatId: string | null;
  /** Reçoit les demandes d'accord EN SECOURS. Les admins les reçoivent de droit. */
  recoitValidations: boolean;
};

export type ParametreAdmin = {
  cle: string;
  libelle: string;
  valeur: number;
  unite: string;
  aide: string;
};

type Props = {
  utilisateurs: UtilisateurAdmin[];
  parametres: ParametreAdmin[];
  /** Faux pour FINANCE : elle règle les seuils, pas les comptes. */
  gereUtilisateurs: boolean;
  moiMeme: string;
  /** Exige l'accord d'un administrateur avant toute génération d'offre. */
  validationObligatoire: boolean;
};

const LIBELLES_ROLE: Record<UtilisateurAdmin['role'], string> = {
  admin: 'Administrateur',
  presale: 'Avant-vente',
  finance: 'Finance',
  after_sales: 'Après-vente',
};

export function EcranAdmin({
  utilisateurs,
  parametres,
  gereUtilisateurs,
  moiMeme,
  validationObligatoire,
}: Props) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<Resultat | null>(null);
  const [invitation, setInvitation] = useState(false);

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paramètres métier</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {parametres.map((parametre) => (
            <form
              key={parametre.cle}
              className="flex flex-wrap items-end gap-3 border-b pb-3 last:border-0 last:pb-0"
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                fd.set('cle', parametre.cle);
                void envoyer(`param-${parametre.cle}`, enregistrerParametre, fd);
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{parametre.libelle}</p>
                <p className="text-xs text-muted-foreground">{parametre.aide}</p>
              </div>

              <label className="flex items-center gap-1.5">
                <Input
                  name="valeur"
                  type="number"
                  step="any"
                  defaultValue={parametre.valeur}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">{parametre.unite}</span>
              </label>

              <Button type="submit" variant="outline" size="sm" disabled={enCours !== null}>
                {enCours === `param-${parametre.cle}` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Enregistrer
              </Button>
            </form>
          ))}
        </CardContent>
      </Card>


      {/*
        L'INTERRUPTEUR QUI MANQUAIT.

        `definirValidationObligatoire` existait depuis le 2026-08-16 et n'était
        appelée par aucun écran : le drapeau ne pouvait donc être posé que par
        un INSERT à la main. Il valait `false`, et aucune offre ne demandait
        jamais d'accord — c'est ce qui a fait croire à une panne Telegram sur
        l'affaire Agadir, alors que rien n'était déclenché.
      */}
      {gereUtilisateurs && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accord avant génération d’offre</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-center justify-between gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void envoyer(
                  'validation-obligatoire',
                  definirValidationObligatoire,
                  new FormData(e.currentTarget),
                );
              }}
            >
              <div className="min-w-0 flex-1">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    name="actif"
                    defaultChecked={validationObligatoire}
                    className="size-4"
                  />
                  Exiger l’accord d’un administrateur
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Activé, aucune offre ne se génère sans décision explicite. La
                  demande part par Telegram, sinon WhatsApp, sinon courriel — vers
                  les administrateurs, et vers les suppléants si aucun n’est joignable.
                </p>
              </div>

              <Button type="submit" variant="outline" size="sm" disabled={enCours !== null}>
                {enCours === 'validation-obligatoire' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Enregistrer
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {gereUtilisateurs && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                Utilisateurs
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {utilisateurs.filter((u) => u.actif).length} actif(s) sur{' '}
                  {utilisateurs.length}
                </span>
              </CardTitle>

              {!invitation && (
                <Button size="sm" onClick={() => setInvitation(true)}>
                  <UserPlus className="size-4" />
                  Inviter un utilisateur
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {invitation && (
              <form
                className="mb-4 space-y-3 rounded-md border p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void envoyer('invitation', inviterUtilisateur, new FormData(e.currentTarget), () =>
                    setInvitation(false),
                  );
                }}
              >
                <p className="text-sm font-medium">Nouvel utilisateur</p>
                <p className="text-xs text-muted-foreground">
                  Aucun mot de passe n&apos;est défini ici : la personne se connecte
                  avec cette adresse, par Google ou par courriel, et son compte se
                  rattache à la première connexion.
                </p>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="space-y-1 lg:col-span-2">
                    <span className="text-xs text-muted-foreground">Adresse e-mail *</span>
                    <Input name="email" type="email" required maxLength={300} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Prénom</span>
                    <Input name="prenom" maxLength={100} />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted-foreground">Nom</span>
                    <Input name="nom" maxLength={100} />
                  </label>
                  <label className="space-y-1 lg:col-span-2">
                    <span className="text-xs text-muted-foreground">Rôle *</span>
                    <select
                      name="role"
                      required
                      defaultValue="presale"
                      className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm"
                    >
                      {(Object.keys(LIBELLES_ROLE) as UtilisateurAdmin['role'][]).map((r) => (
                        <option key={r} value={r}>
                          {LIBELLES_ROLE[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={enCours !== null}>
                    {enCours === 'invitation' && <Loader2 className="size-4 animate-spin" />}
                    Inviter
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setInvitation(false)}
                  >
                    <X className="size-4" />
                    Annuler
                  </Button>
                </div>
              </form>
            )}

            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Utilisateur</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Canaux de validation</TableHead>
                  <TableHead>État</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {utilisateurs.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <p className="font-medium">{u.nomComplet}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </TableCell>
                    <TableCell>
                      <select
                        defaultValue={u.role}
                        disabled={enCours !== null}
                        aria-label={`Rôle de ${u.email}`}
                        onChange={(e) => {
                          const fd = new FormData();
                          fd.set('userId', u.id);
                          fd.set('role', e.target.value);
                          void envoyer(`role-${u.id}`, changerRole, fd);
                        }}
                        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm"
                      >
                        {(
                          Object.keys(LIBELLES_ROLE) as UtilisateurAdmin['role'][]
                        ).map((r) => (
                          <option key={r} value={r}>
                            {LIBELLES_ROLE[r]}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                    {/* Les deux coordonnées ensemble, dans un seul formulaire :
                        elles servent le même circuit, et les séparer ferait
                        deux enregistrements pour une seule intention. */}
                    <TableCell>
                      <form
                        className="flex flex-wrap items-center gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          fd.set('userId', u.id);
                          void envoyer(`contacts-${u.id}`, definirContactsNotification, fd);
                        }}
                      >
                        <Input
                          name="telegramChatId"
                          defaultValue={u.telegramChatId ?? ''}
                          placeholder="Telegram"
                          aria-label={`Identifiant Telegram de ${u.email}`}
                          title="Identifiant du chat Telegram avec le bot de validation"
                          className="h-8 w-28 text-xs"
                        />
                        <Input
                          name="telephone"
                          defaultValue={u.telephone ?? ''}
                          placeholder="WhatsApp"
                          aria-label={`Numéro WhatsApp de ${u.email}`}
                          title="Numéro au format international, par exemple 212612345678"
                          className="h-8 w-32 text-xs"
                        />
                        {/* Un administrateur reçoit de droit : lui proposer la
                            case laisserait croire qu'elle conditionne son accès. */}
                        {u.role !== 'admin' && (
                          <label
                            className="flex items-center gap-1 text-xs text-muted-foreground"
                            title="Reçoit les demandes d’accord seulement si aucun administrateur n’a de canal instantané lié"
                          >
                            <input
                              type="checkbox"
                              name="recoitValidations"
                              defaultChecked={u.recoitValidations}
                              className="size-3.5"
                            />
                            suppléant
                          </label>
                        )}
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          disabled={enCours !== null}
                          aria-label={`Enregistrer les canaux de ${u.email}`}
                        >
                          {enCours === `contacts-${u.id}` ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Save className="size-4" />
                          )}
                        </Button>
                      </form>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={!u.actif ? 'secondary' : u.rattache ? 'succes' : 'attention'}
                      >
                        {!u.actif ? 'désactivé' : u.rattache ? 'actif' : 'invité'}
                      </Badge>
                      {u.id === moiMeme && (
                        <Badge variant="neutre" className="ml-1">
                          vous
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {/* Tant que le compte n'est pas rattaché, la personne
                            n'a pas encore choisi son mot de passe : c'est là
                            que le renvoi du lien sert. */}
                        {u.actif && !u.rattache && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={enCours !== null}
                            onClick={() => {
                              const fd = new FormData();
                              fd.set('id', u.id);
                              void envoyer(`invit-${u.id}`, renvoyerInvitation, fd);
                            }}
                          >
                            {enCours === `invit-${u.id}` ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Send className="size-4" />
                            )}
                            Renvoyer l&apos;invitation
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={enCours !== null || u.id === moiMeme}
                          onClick={() => {
                            const fd = new FormData();
                            fd.set('userId', u.id);
                            fd.set('actif', u.actif ? 'false' : 'true');
                            void envoyer(`actif-${u.id}`, basculerActif, fd);
                          }}
                        >
                          {enCours === `actif-${u.id}` ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : u.actif ? (
                            <ShieldOff className="size-4" />
                          ) : (
                            <ShieldCheck className="size-4" />
                          )}
                          {u.actif ? 'Désactiver' : 'Activer'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <p className="mt-3 text-xs text-muted-foreground">
              Les comptes ne sont jamais supprimés : l&apos;historique d&apos;audit les
              référence. La désactivation bloque l&apos;accès immédiatement.
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              Une demande de validation part par <strong>Telegram</strong>, sinon{' '}
              <strong>WhatsApp</strong>, sinon <strong>courriel</strong> — le premier
              canal dont la clé est saisie et dont la coordonnée est renseignée ici.
              Un champ vide saute le canal, sans rien casser.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
