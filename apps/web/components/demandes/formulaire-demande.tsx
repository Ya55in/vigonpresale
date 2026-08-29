'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AlertCircle, Loader2, Plus, Trash2 } from 'lucide-react';

import {
  creerDemandeManuelle,
  type Resultat,
} from '@/app/(dashboard)/demandes/nouvelle/actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LIBELLES_SOURCE } from '@vigon/shared';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type LigneArticle = {
  /** Clé de rendu uniquement : jamais envoyée au serveur. */
  cle: number;
  designation: string;
  reference: string;
  marque: string;
  quantite: string;
};

const ligneVide = (cle: number): LigneArticle => ({
  cle,
  designation: '',
  reference: '',
  marque: '',
  quantite: '1',
});

function Champ({
  nom,
  libelle,
  aide,
  requis = false,
  type = 'text',
}: {
  nom: string;
  libelle: string;
  aide?: string;
  requis?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={nom}>
        {libelle}
        {requis && <span className="ml-1 text-destructive">*</span>}
      </Label>
      <Input id={nom} name={nom} type={type} required={requis} />
      {aide && <p className="text-xs text-muted-foreground">{aide}</p>}
    </div>
  );
}

export function FormulaireDemande() {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [lignes, setLignes] = useState<LigneArticle[]>([ligneVide(0)]);
  const [suivante, setSuivante] = useState(1);
  const [source, setSource] = useState<'interne' | 'cps'>('interne');

  function ajouterLigne(): void {
    setLignes((v) => [...v, ligneVide(suivante)]);
    setSuivante((n) => n + 1);
  }

  function retirerLigne(cle: number): void {
    setLignes((v) => (v.length === 1 ? v : v.filter((l) => l.cle !== cle)));
  }

  function majLigne(cle: number, champ: keyof LigneArticle, valeur: string): void {
    setLignes((v) =>
      v.map((l) => (l.cle === cle ? { ...l, [champ]: valeur } : l)),
    );
  }

  function soumettre(evenement: React.FormEvent<HTMLFormElement>): void {
    evenement.preventDefault();
    const donnees = new FormData(evenement.currentTarget);

    // Les articles voyagent en JSON : un tableau de lignes se prête mal aux
    // champs plats de FormData, et le schéma serveur le revalide de toute façon.
    donnees.set(
      'articles',
      JSON.stringify(
        lignes.map((l) => ({
          designation: l.designation,
          reference: l.reference,
          marque: l.marque,
          quantite: l.quantite,
        })),
      ),
    );

    demarrer(async () => {
      const reponse = await creerDemandeManuelle(null, donnees);
      setResultat(reponse);
      if (reponse.ok) router.push(`/demandes/${reponse.demandeId}/articles`);
    });
  }

  return (
    <form onSubmit={soumettre} className="space-y-6">
      {resultat && !resultat.ok && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{resultat.message}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Client et projet</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Champ
            nom="clientNom"
            libelle="Client"
            requis
            aide="Rattaché au client existant s'il porte déjà ce nom."
          />
          <Champ
            nom="clientEmail"
            libelle="E-mail du client"
            type="email"
            aide="Sert à l'envoi de l'offre."
          />
          <div className="sm:col-span-2">
            <Champ nom="titre" libelle="Intitulé du projet" requis />
          </div>
          <Champ
            nom="deadline"
            libelle="Date limite"
            type="date"
            aide="Facultative."
          />
          <div className="space-y-1.5">
            <Label htmlFor="source">Origine</Label>
            <select
              id="source"
              name="source"
              value={source}
              onChange={(e) => setSource(e.target.value as 'interne' | 'cps')}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="interne">{LIBELLES_SOURCE.interne}</option>
              <option value="cps">{LIBELLES_SOURCE.cps}</option>
            </select>
            <p className="text-xs text-muted-foreground">
              La troisième origine, le courriel, est renseignée par le worker.
            </p>
          </div>
          {source === 'cps' && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="cahierDesCharges">Cahier des charges</Label>
              <Input
                id="cahierDesCharges"
                name="cahierDesCharges"
                type="file"
                accept=".pdf,.docx,.xlsx,.xls,.csv,.txt"
                className="cursor-pointer file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
              />
              <p className="text-xs text-muted-foreground">
                PDF, Word, Excel ou texte — 15 Mo maximum. Son contenu rejoint la
                demande et servira à l&apos;extraction des articles.
              </p>
            </div>
          )}
          <div className="sm:col-span-2 space-y-1.5">
            <Label htmlFor="description">Contexte</Label>
            <Textarea id="description" name="description" rows={3} />
            <p className="text-xs text-muted-foreground">
              Facultatif — repris tel quel, sans passer par le modèle.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            Articles ({lignes.length})
          </CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={ajouterLigne}>
            <Plus className="size-4" />
            Ajouter
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {lignes.map((ligne, index) => (
            <div
              key={ligne.cle}
              className="grid gap-3 rounded-md border p-3 sm:grid-cols-12"
            >
              <div className="sm:col-span-5 space-y-1.5">
                <Label htmlFor={`designation-${ligne.cle}`}>
                  Désignation <span className="text-destructive">*</span>
                </Label>
                <Input
                  id={`designation-${ligne.cle}`}
                  required
                  value={ligne.designation}
                  onChange={(e) =>
                    majLigne(ligne.cle, 'designation', e.target.value)
                  }
                  placeholder="Switch administrable PoE+ 48 ports"
                />
              </div>

              <div className="sm:col-span-3 space-y-1.5">
                <Label htmlFor={`reference-${ligne.cle}`}>Référence</Label>
                <Input
                  id={`reference-${ligne.cle}`}
                  value={ligne.reference}
                  onChange={(e) =>
                    majLigne(ligne.cle, 'reference', e.target.value)
                  }
                  placeholder="C9200L-48P-4G-E"
                />
              </div>

              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor={`marque-${ligne.cle}`}>Marque</Label>
                <Input
                  id={`marque-${ligne.cle}`}
                  value={ligne.marque}
                  onChange={(e) => majLigne(ligne.cle, 'marque', e.target.value)}
                  placeholder="Cisco"
                />
              </div>

              <div className="sm:col-span-1 space-y-1.5">
                <Label htmlFor={`quantite-${ligne.cle}`}>Qté</Label>
                <Input
                  id={`quantite-${ligne.cle}`}
                  type="number"
                  min={1}
                  required
                  value={ligne.quantite}
                  onChange={(e) =>
                    majLigne(ligne.cle, 'quantite', e.target.value)
                  }
                />
              </div>

              <div className="flex items-end sm:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={lignes.length === 1}
                  aria-label={`Retirer l'article ${index + 1}`}
                  onClick={() => retirerLigne(ligne.cle)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            La marque conditionne la recherche de fournisseurs — la renseigner
            évite une reprise manuelle à l&apos;étape des consultations.
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={enCours}>
          {enCours && <Loader2 className="size-4 animate-spin" />}
          Créer la demande
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={enCours}
          onClick={() => router.push('/demandes')}
        >
          Annuler
        </Button>
      </div>
    </form>
  );
}
