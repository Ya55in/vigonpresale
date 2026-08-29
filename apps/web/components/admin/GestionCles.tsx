'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Database,
  FileCog,
  Loader2,
  Plug,
  Trash2,
  X,
} from 'lucide-react';

import {
  enregistrerCle,
  supprimerCle,
  testerService,
  type Resultat,
} from '@/app/(dashboard)/admin/cles';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export type CleAffichee = {
  nom: string;
  libelle: string;
  service: string;
  aide: string;
  source: 'base' | 'environnement' | 'absente';
  apercu: string | null;
  /** Faux pour une adresse ou un identifiant : le champ reste alors lisible. */
  sensible: boolean;
};

/** Services testables, et la clé qui les conditionne. */
const TESTS: { service: string; libelle: string }[] = [
  { service: 'ia', libelle: 'Fournisseur IA' },
  { service: 'firecrawl', libelle: 'Firecrawl' },
  { service: 'gamma', libelle: 'Gamma' },
  { service: 'imap', libelle: 'Boîte mail (lecture)' },
  { service: 'envoi', libelle: 'Envoi de courriels' },
  { service: 'whatsapp', libelle: 'WhatsApp (validation)' },
  { service: 'telegram', libelle: 'Telegram (validation)' },
];

const SOURCES: Record<
  CleAffichee['source'],
  { libelle: string; variante: 'succes' | 'info' | 'attention'; icone: typeof Database }
> = {
  base: { libelle: 'base de données', variante: 'succes', icone: Database },
  environnement: { libelle: 'fichier .env', variante: 'info', icone: FileCog },
  absente: { libelle: 'absente', variante: 'attention', icone: AlertTriangle },
};

export function GestionCles({ cles }: { cles: CleAffichee[] }) {
  const router = useRouter();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [retour, setRetour] = useState<(Resultat & { cle?: string }) | null>(null);
  const [edition, setEdition] = useState<string | null>(null);

  async function envoyer(
    cleAction: string,
    action: (etat: Resultat | null, donnees: FormData) => Promise<Resultat>,
    donnees: FormData,
    apres?: () => void,
  ): Promise<void> {
    setEnCours(cleAction);
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Clés de services</CardTitle>
        <p className="text-sm text-muted-foreground">
          Une clé enregistrée ici l&apos;emporte sur le fichier de configuration et
          devient active immédiatement, sans redéploiement.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
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

        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-300">
            <AlertTriangle className="size-4" />
            À savoir avant d&apos;enregistrer une clé ici
          </p>
          <p className="mt-1 text-amber-900/80 dark:text-amber-300/80">
            Une clé stockée en base est lisible par toute personne ayant accès à la
            base, alors qu&apos;un fichier de configuration reste sur le serveur.
            L&apos;écriture est réservée aux administrateurs et les valeurs ne sont
            jamais réaffichées en clair, mais le confinement reste plus faible.
          </p>
        </div>

        {/* --- Liste des clés --- */}
        <ul className="divide-y rounded-md border">
          {cles.map((cle) => {
            const source = SOURCES[cle.source];
            const Icone = source.icone;

            return (
              <li key={cle.nom} className="space-y-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {/* `div` et non `p` : Badge rend un bloc, invalide dans un paragraphe. */}
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {cle.libelle}
                      <Badge variant={source.variante}>
                        <Icone className="mr-1 inline size-3" />
                        {source.libelle}
                      </Badge>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{cle.nom}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{cle.aide}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {cle.apercu && (
                      <code className="rounded bg-muted px-2 py-1 text-xs">
                        {cle.apercu}
                      </code>
                    )}
                    {edition !== cle.nom && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={enCours !== null}
                        onClick={() => {
                          setRetour(null);
                          setEdition(cle.nom);
                        }}
                      >
                        {cle.source === 'absente' ? 'Renseigner' : 'Remplacer'}
                      </Button>
                    )}
                    {cle.source === 'base' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        aria-label={`Retirer ${cle.libelle} de la base`}
                        disabled={enCours !== null}
                        onClick={() => {
                          const fd = new FormData();
                          fd.set('nom', cle.nom);
                          void envoyer(`suppr-${cle.nom}`, supprimerCle, fd);
                        }}
                      >
                        {enCours === `suppr-${cle.nom}` ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {edition === cle.nom && (
                  <form
                    className="flex flex-wrap items-end gap-2 border-t pt-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      fd.set('nom', cle.nom);
                      void envoyer(`maj-${cle.nom}`, enregistrerCle, fd, () =>
                        setEdition(null),
                      );
                    }}
                  >
                    <label className="min-w-0 flex-1 space-y-1">
                      <span className="text-xs text-muted-foreground">
                        {cle.sensible
                          ? 'Nouvelle valeur — collez-la, elle ne sera plus réaffichée'
                          : 'Nouvelle valeur — relisez-la avant d’enregistrer'}
                      </span>
                      {/* Une adresse masquée en points se saisit à l'aveugle,
                          alors qu'elle est ensuite affichée en clair dans la
                          liste : rien ne le justifiait. */}
                      <Input
                        name="valeur"
                        type={cle.sensible ? 'password' : 'text'}
                        required
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={cle.sensible ? 'Coller la clé…' : 'Saisir la valeur…'}
                      />
                    </label>
                    <Button type="submit" size="sm" disabled={enCours !== null}>
                      {enCours === `maj-${cle.nom}` ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      Enregistrer
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEdition(null)}
                    >
                      <X className="size-4" />
                      Annuler
                    </Button>

                    {/* Dans le formulaire et non dans l'aide de la liste : le
                        rappel n'a d'objet qu'au moment où l'on change la
                        valeur, et une aide plus longue grandirait la ligne au
                        point de déplacer le bouton « Remplacer ». */}
                    {cle.service === 'imap' && (
                      <p className="w-full text-xs text-muted-foreground">
                        L’adresse et le mot de passe d’application vont par paire :
                        changer l’une sans l’autre coupe la connexion à la boîte.
                        Vérifiez avec « Tester » ci-dessous.
                      </p>
                    )}
                  </form>
                )}
              </li>
            );
          })}
        </ul>

        {/* --- Tests de connexion --- */}
        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Tester la configuration</p>
          <p className="text-xs text-muted-foreground">
            Chaque test effectue un vrai appel : une clé présente mais révoquée est
            détectée, ce qu&apos;un simple contrôle de présence laisserait passer.
          </p>
          <div className="flex flex-wrap gap-2">
            {TESTS.map((test) => (
              <Button
                key={test.service}
                variant="outline"
                size="sm"
                disabled={enCours !== null}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('service', test.service);
                  void envoyer(`test-${test.service}`, testerService, fd);
                }}
              >
                {enCours === `test-${test.service}` ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plug className="size-4" />
                )}
                {test.libelle}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
