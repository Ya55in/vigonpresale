// Import explicite : Next utilise le runtime JSX automatique, mais ce gabarit
// est aussi rendu hors Next (script d'essai), où la transformation classique
// attend React dans la portée. Même motif que `DocumentOffre.tsx`.
import * as React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Primitives retypées pour React 19 : voir `offres/pdf-primitives.ts`.
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from '@/lib/offres/pdf-primitives.js';
import { CONTACTS, COULEURS_MAQUETTE } from '@/lib/offres/maquette';

import type { LIBELLES_DOCUMENT } from '@vigon/shared';
import type { ContenuDocument } from '@vigon/shared';

/**
 * Gabarit PDF d'un document financier — bon de commande, pro-forma, facture.
 *
 * A4 PORTRAIT, contrairement au 16:9 de l'offre. L'offre est une présentation
 * qu'on fait défiler ; une facture se classe, s'imprime et s'archive. Lui
 * imposer le format diapositive la rendrait inutilisable en comptabilité.
 *
 * TOUT VIENT DE `contenu_json`. C'est la règle du gel, et elle vaut ici plus
 * qu'ailleurs : le PDF part chez le client et devient sa référence. Relire les
 * tables vivantes produirait un fichier qui contredit celui déjà reçu, sans que
 * rien ne le signale — l'écart se découvre au litige.
 */

const couleurs = COULEURS_MAQUETTE;

const s = StyleSheet.create({
  page: {
    backgroundColor: couleurs.blanc,
    color: couleurs.clairTexte,
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontSize: 9.5,
    lineHeight: 1.45,
  },

  entete: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
  },
  logo: { objectFit: 'contain' },

  blocTitre: { alignItems: 'flex-end' },
  typeDocument: {
    fontSize: 19,
    color: couleurs.accent,
    marginBottom: 3,
  },
  numero: { fontSize: 12, marginBottom: 2 },
  dateEntete: { fontSize: 9, color: couleurs.discret },

  parties: { flexDirection: 'row', gap: 20, marginBottom: 22 },
  partie: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E4E6EA',
    borderRadius: 3,
    padding: 10,
  },
  partieTitre: {
    fontSize: 7.5,
    color: couleurs.discret,
    letterSpacing: 0.7,
    marginBottom: 5,
  },
  partieNom: { fontSize: 10.5, marginBottom: 2 },
  partieLigne: { fontSize: 9, color: '#4A4F57' },

  objet: {
    backgroundColor: couleurs.clairAlterne,
    borderRadius: 3,
    padding: 9,
    marginBottom: 18,
  },
  objetLibelle: { fontSize: 7.5, color: couleurs.discret, letterSpacing: 0.7 },
  objetTexte: { fontSize: 10, marginTop: 2 },

  tableEntete: {
    flexDirection: 'row',
    backgroundColor: couleurs.sombre,
    color: couleurs.blanc,
    paddingVertical: 6,
    paddingHorizontal: 7,
    fontSize: 8,
    letterSpacing: 0.4,
  },
  ligne: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#EDEEF0',
  },
  ligneAlterne: { backgroundColor: '#FAFAFB' },

  colDesignation: { flex: 1 },
  colQuantite: { width: 58, textAlign: 'right' },
  colPrix: { width: 82, textAlign: 'right' },
  colTotal: { width: 90, textAlign: 'right' },

  designation: { fontSize: 9.5 },
  reference: { fontSize: 8, color: couleurs.discret, marginTop: 1 },

  totaux: { marginTop: 16, flexDirection: 'row', justifyContent: 'flex-end' },
  blocTotaux: { width: 250 },
  ligneTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  ligneTotalFort: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 8,
    marginTop: 4,
    backgroundColor: couleurs.sombre,
    color: couleurs.blanc,
    borderRadius: 3,
  },
  totalLibelle: { fontSize: 9.5 },
  totalValeur: { fontSize: 9.5 },
  totalValeurFort: { fontSize: 12 },

  conditions: { marginTop: 26 },
  conditionsTitre: {
    fontSize: 7.5,
    color: couleurs.discret,
    letterSpacing: 0.7,
    marginBottom: 5,
  },
  condition: { fontSize: 9, color: '#4A4F57', marginBottom: 2 },

  pied: {
    position: 'absolute',
    bottom: 24,
    left: 44,
    right: 44,
    borderTopWidth: 1,
    borderTopColor: '#E4E6EA',
    paddingTop: 7,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: couleurs.discret,
  },
});

const RATIO_LOGO_SOMBRE = 520 / 167;

/**
 * Deux racines possibles, et il en faut deux.
 *
 * Sous Next, `process.cwd()` vaut `apps/web`. Lancé par un script du monorepo,
 * il vaut la racine du dépôt — et le gabarit rendait alors un PDF sans logo,
 * que le harnais validait sans rien voir. Un essai qui n'éprouve pas le même
 * fichier que la production n'éprouve rien.
 */
const RACINES_MARQUE = ['public/marque', 'apps/web/public/marque'];

function chargerLogo(): string | null {
  for (const racine of RACINES_MARQUE) {
    const chemin = resolve(process.cwd(), racine, 'vigon-noir.jpg');
    if (existsSync(chemin)) {
      return `data:image/jpeg;base64,${readFileSync(chemin).toString('base64')}`;
    }
  }

  console.warn(`[document] logo introuvable sous ${process.cwd()}`);
  return null;
}

// Chargé une fois au chargement du module : le fichier ne change pas entre deux
// rendus, et le relire à chaque facture coûterait une lecture disque par envoi.
const LOGO = chargerLogo();

function montant(valeur: number, devise: string): string {
  return `${valeur.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`;
}

function jour(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export type ParamsDocumentPdf = {
  contenu: ContenuDocument;
  libelleType: (typeof LIBELLES_DOCUMENT)[keyof typeof LIBELLES_DOCUMENT];
  numero: string;
  dateEmission: string;
  dateEcheance: string | null;
};

export function DocumentFinancierPdf({
  contenu,
  libelleType,
  numero,
  dateEmission,
  dateEcheance,
}: ParamsDocumentPdf) {
  const devise = contenu.totaux.devise;

  return (
    <Document
      title={`${libelleType} ${numero}`}
      author="Vigon Systems"
      // Le sujet part dans les métadonnées du fichier : un PDF détaché de son
      // courriel doit encore dire de quelle affaire il relève.
      subject={contenu.reference ? `Affaire ${contenu.reference}` : libelleType}
    >
      <Page size="A4" style={s.page}>
        <View style={s.entete}>
          {LOGO ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={LOGO} style={[s.logo, { width: 132, height: 132 / RATIO_LOGO_SOMBRE }]} />
          ) : (
            <View />
          )}

          <View style={s.blocTitre}>
            <Text style={s.typeDocument}>{libelleType}</Text>
            <Text style={s.numero}>{numero}</Text>
            <Text style={s.dateEntete}>Émis le {jour(dateEmission)}</Text>
            {dateEcheance && (
              <Text style={s.dateEntete}>Échéance : {jour(dateEcheance)}</Text>
            )}
          </View>
        </View>

        <View style={s.parties}>
          <View style={s.partie}>
            <Text style={s.partieTitre}>ÉMETTEUR</Text>
            <Text style={s.partieNom}>Vigon Systems</Text>
            {CONTACTS.map((c) => (
              <Text key={c} style={s.partieLigne}>
                {c}
              </Text>
            ))}
          </View>

          <View style={s.partie}>
            <Text style={s.partieTitre}>DESTINATAIRE</Text>
            <Text style={s.partieNom}>{contenu.client.nom}</Text>
            {contenu.client.adresse && (
              <Text style={s.partieLigne}>{contenu.client.adresse}</Text>
            )}
            {contenu.client.email && (
              <Text style={s.partieLigne}>{contenu.client.email}</Text>
            )}
          </View>
        </View>

        {(contenu.objet || contenu.reference) && (
          <View style={s.objet}>
            <Text style={s.objetLibelle}>OBJET</Text>
            <Text style={s.objetTexte}>
              {contenu.objet ?? '—'}
              {contenu.reference ? `  ·  Affaire ${contenu.reference}` : ''}
            </Text>
          </View>
        )}

        <View style={s.tableEntete}>
          <Text style={s.colDesignation}>DÉSIGNATION</Text>
          <Text style={s.colQuantite}>QTÉ</Text>
          <Text style={s.colPrix}>P.U. HT</Text>
          <Text style={s.colTotal}>TOTAL HT</Text>
        </View>

        {contenu.lignes.map((ligne, index) => (
          <View
            // Pas d'identifiant dans le contenu figé : l'index est stable ici,
            // les lignes d'un document émis ne bougeant plus jamais.
            key={`${ligne.designation}-${index}`}
            style={index % 2 === 1 ? [s.ligne, s.ligneAlterne] : s.ligne}
            wrap={false}
          >
            <View style={s.colDesignation}>
              <Text style={s.designation}>{ligne.designation}</Text>
              {ligne.reference && <Text style={s.reference}>Réf. {ligne.reference}</Text>}
            </View>
            <Text style={s.colQuantite}>
              {ligne.quantite} {ligne.unite}
            </Text>
            <Text style={s.colPrix}>{montant(ligne.prixUnitaireHt, devise)}</Text>
            <Text style={s.colTotal}>{montant(ligne.totalHt, devise)}</Text>
          </View>
        ))}

        <View style={s.totaux}>
          <View style={s.blocTotaux}>
            <View style={s.ligneTotal}>
              <Text style={s.totalLibelle}>Total HT</Text>
              <Text style={s.totalValeur}>{montant(contenu.totaux.totalHt, devise)}</Text>
            </View>
            <View style={s.ligneTotal}>
              <Text style={s.totalLibelle}>TVA {contenu.totaux.tvaPct} %</Text>
              <Text style={s.totalValeur}>{montant(contenu.totaux.totalTva, devise)}</Text>
            </View>
            <View style={s.ligneTotalFort}>
              <Text style={s.totalValeurFort}>Total TTC</Text>
              <Text style={s.totalValeurFort}>
                {montant(contenu.totaux.totalTtc, devise)}
              </Text>
            </View>
          </View>
        </View>

        {contenu.conditions && (
          <View style={s.conditions}>
            <Text style={s.conditionsTitre}>CONDITIONS</Text>
            {contenu.conditions.livraison && (
              <Text style={s.condition}>Livraison : {contenu.conditions.livraison}</Text>
            )}
            {contenu.conditions.paiement && (
              <Text style={s.condition}>Paiement : {contenu.conditions.paiement}</Text>
            )}
            {contenu.conditions.garantie && (
              <Text style={s.condition}>Garantie : {contenu.conditions.garantie}</Text>
            )}
          </View>
        )}

        <View style={s.pied} fixed>
          <Text>Vigon Systems — {numero}</Text>
          <Text
            render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
              `${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
