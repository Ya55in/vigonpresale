// Import explicite : Next utilise le runtime JSX automatique, mais ce gabarit
// est aussi rendu hors Next (script d'essai, worker), où la transformation
// classique attend React dans la portée.
import * as React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Primitives retypées pour React 19 : voir `pdf-primitives.ts` pour le motif.
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from './pdf-primitives.js';
import type { Boq } from '@vigon/services';

import {
  ATOUTS,
  CONTACTS,
  COULEURS_MAQUETTE,
  DEMARCHE,
  DOMAINES,
  STATISTIQUES,
  TEXTES_MAQUETTE,
  VALEURS,
  montantMaquette as montant,
} from './maquette';

/**
 * Gabarit PDF de l'offre — repli local quand Gamma est indisponible.
 *
 * Reprend la maquette de référence Vigon Systems : diapositives 16:9, fond
 * sombre et accent bleu, pages institutionnelles fixes, puis la solution et
 * l'offre financière alimentées par le BoQ.
 *
 * Reçoit le BoQ déjà validé par `verifierAnonymisation` : ce document ne peut
 * donc contenir ni nom de fournisseur, ni prix d'achat, ni taux de marge.
 */

/** Diapositive 16:9, comme l'export de référence. */
const FORMAT: [number, number] = [960, 540];

// Partagées avec le rendu web : les deux montrent la même offre, leurs couleurs
// ne doivent pas pouvoir diverger.
const couleurs = COULEURS_MAQUETTE;

const s = StyleSheet.create({
  pageSombre: {
    backgroundColor: couleurs.sombre,
    color: couleurs.blanc,
    paddingVertical: 44,
    paddingHorizontal: 56,
    fontSize: 11,
    lineHeight: 1.5,
  },
  pageClaire: {
    backgroundColor: couleurs.blanc,
    color: couleurs.clairTexte,
    paddingVertical: 44,
    paddingHorizontal: 56,
    fontSize: 11,
    lineHeight: 1.5,
  },

  titrePage: {
    fontSize: 30,
    lineHeight: 1.25,
    color: couleurs.accent,
    marginBottom: 20,
  },
  titrePageBlanc: {
    fontSize: 30,
    lineHeight: 1.25,
    color: couleurs.blanc,
    marginBottom: 20,
  },
  chapeau: { fontSize: 12, color: couleurs.doux, marginBottom: 26 },
  paragraphe: { fontSize: 11, color: couleurs.doux, marginBottom: 10 },

  logo: { objectFit: 'contain' },

  grille: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -7 },
  colonneDemi: { width: '50%', paddingHorizontal: 7, marginBottom: 14 },
  colonneTiers: { width: '33.333%', paddingHorizontal: 7, marginBottom: 14 },

  carteBleue: { backgroundColor: couleurs.accent, borderRadius: 4, padding: 14 },
  carteBordee: {
    borderWidth: 1,
    borderColor: '#4A4A4A',
    borderRadius: 4,
    padding: 14,
  },
  carteTitre: { fontSize: 13, color: couleurs.blanc, marginBottom: 5 },
  carteTitreAccent: { fontSize: 13, color: couleurs.accent, marginBottom: 5 },
  carteTexte: { fontSize: 10, color: couleurs.blanc, lineHeight: 1.45 },
  carteTexteDoux: { fontSize: 10, color: couleurs.doux, lineHeight: 1.45 },

  etapeNumero: { fontSize: 14, color: couleurs.doux, marginBottom: 4 },
  etapeTrait: {
    borderBottomWidth: 1.5,
    borderBottomColor: couleurs.accent,
    marginBottom: 8,
  },

  // `lineHeight` explicite : sans lui, la boîte du grand chiffre est trop
  // basse et le libellé suivant vient se poser par-dessus.
  statChiffre: { fontSize: 34, lineHeight: 1.25, color: couleurs.blanc },
  statLibelle: { fontSize: 12, lineHeight: 1.3, color: couleurs.accent, marginTop: 6 },

  puce: { flexDirection: 'row', marginBottom: 6 },
  pucePoint: { color: couleurs.accent, marginRight: 8 },
  puceTexte: { flex: 1, fontSize: 11, color: couleurs.doux },

  // Tableau de l'offre financière.
  tableauEnTete: { flexDirection: 'row', backgroundColor: couleurs.accent },
  tableauLigne: { flexDirection: 'row', backgroundColor: couleurs.blanc },
  tableauLigneAlt: { flexDirection: 'row', backgroundColor: couleurs.clairAlterne },
  tableauTotal: { flexDirection: 'row', backgroundColor: couleurs.blanc },
  tableauTotalFort: { flexDirection: 'row', backgroundColor: couleurs.accent },
  celluleEnTete: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    fontSize: 10.5,
    color: couleurs.blanc,
  },
  cellule: { paddingVertical: 9, paddingHorizontal: 10, fontSize: 10 },
  celluleForte: {
    paddingVertical: 11,
    paddingHorizontal: 10,
    fontSize: 11.5,
    color: couleurs.blanc,
  },
  colDescription: { flex: 4 },
  colQte: { flex: 1, textAlign: 'center' },
  colPrix: { flex: 1.5, textAlign: 'right' },

  // Équipements proposés.
  equipement: { flexDirection: 'row', marginBottom: 14 },
  equipementImage: { width: 74, height: 74, objectFit: 'contain', marginRight: 14 },
  equipementImageVide: {
    width: 74,
    height: 74,
    marginRight: 14,
    borderWidth: 1,
    borderColor: '#4A4A4A',
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  equipementCorps: { flex: 1 },
  equipementTitre: { fontSize: 12.5, color: couleurs.blanc, marginBottom: 3 },
  equipementMeta: { fontSize: 9.5, color: couleurs.accent, marginBottom: 4 },

  pied: {
    position: 'absolute',
    bottom: 22,
    left: 56,
    right: 56,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8.5,
    color: '#8A8F96',
  },
});

/**
 * Logos de marque, lus depuis `public/marque/` et embarqués en data URI.
 *
 * En data URI plutôt qu'en chemin : le rendu tourne aussi hors serveur Next
 * (script d'essai), où le répertoire courant n'est pas garanti. La lecture est
 * faite une fois au chargement du module, pas à chaque offre.
 */
const RATIO_LOGO = {
  clair: 760 / 242,
  sombre: 520 / 167,
  couverture: 700 / 231,
};

function chargerLogo(fichier: string): string | null {
  const chemin = resolve(process.cwd(), 'public/marque', fichier);
  if (!existsSync(chemin)) {
    console.warn(`[offre] logo introuvable : ${chemin}`);
    return null;
  }
  return `data:image/jpeg;base64,${readFileSync(chemin).toString('base64')}`;
}

const LOGOS = {
  clair: chargerLogo('vigon-blanc.jpg'),
  sombre: chargerLogo('vigon-noir.jpg'),
  couverture: chargerLogo('vigon-blanc-sur-noir.jpg'),
};

/**
 * Le fond du visuel est opaque : il doit correspondre exactement à celui de la
 * diapositive, sinon un rectangle se dessine autour du sigle. D'où trois
 * variantes — `clair` sur le gris des pages, `couverture` sur le noir,
 * `sombre` sur le blanc de la page financière.
 */
function LogoVigon({
  largeur = 150,
  variante = 'clair',
}: {
  largeur?: number;
  variante?: 'clair' | 'sombre' | 'couverture';
}) {
  const source = LOGOS[variante];
  if (!source) return <View />;

  return (
    // eslint-disable-next-line jsx-a11y/alt-text
    <Image
      src={source}
      style={[s.logo, { width: largeur, height: largeur / RATIO_LOGO[variante] }]}
    />
  );
}

function Puce({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.puce}>
      <Text style={s.pucePoint}>•</Text>
      <Text style={s.puceTexte}>{children}</Text>
    </View>
  );
}

function Pied({ reference }: { reference: string }) {
  return (
    <View style={s.pied} fixed>
      <Text>Vigon Systems — offre {reference}</Text>
      {/* Le type du rappel venait de `@react-pdf/types`, écarté avec le reste
          des primitives : on le redonne ici plutôt que d'élargir le shim. */}
      <Text
        render={({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
          `${pageNumber} / ${totalPages}`
        }
      />
    </View>
  );
}

export function DocumentOffre({ boq }: { boq: Boq }) {
  const { devise } = boq.totaux;

  return (
    <Document
      title={`${boq.referenceOffre} — ${boq.solution.titre}`}
      author="Vigon Systems"
    >
      {/* 1. Couverture */}
      <Page size={FORMAT} style={[s.pageSombre, { backgroundColor: couleurs.noir }]}>
        <View style={{ marginTop: 46 }}>
          <LogoVigon largeur={270} variante="couverture" />
        </View>

        <Text style={[s.titrePageBlanc, { marginTop: 46, fontSize: 28 }]}>
          Offre Financière — {boq.solution.titre}
        </Text>

        <Text
          style={[
            s.paragraphe,
            { color: couleurs.accent, maxWidth: 620, marginTop: 6 },
          ]}
        >
          {TEXTES_MAQUETTE.accrocheCouverture}
        </Text>

        <Text style={{ fontSize: 15, color: couleurs.blanc, marginTop: 26 }}>
          Our Valued Client — {boq.client.nom.toUpperCase()}
        </Text>

        <Text style={{ fontSize: 10, color: '#8A8F96', marginTop: 22 }}>
          Offre {boq.referenceOffre} · {boq.date} · Validité : {boq.validite}
          {boq.client.contact ? ` · Interlocuteur : ${boq.client.contact}` : ''}
        </Text>
      </Page>

      {/* 2. Présentation */}
      <Page size={FORMAT} style={s.pageSombre}>
        <Text style={s.titrePage}>{TEXTES_MAQUETTE.titrePresentation}</Text>

        <View style={{ flexDirection: 'row', marginTop: 10 }}>
          <View style={{ flex: 1.2, paddingRight: 26 }}>
            <LogoVigon largeur={200} />
            <Text style={{ fontSize: 14, color: couleurs.blanc, marginTop: 26 }}>
              {TEXTES_MAQUETTE.accrochePresentation}
            </Text>
            <Text style={[s.paragraphe, { marginTop: 10 }]}>
              {TEXTES_MAQUETTE.presentation1}
            </Text>
            <Text style={s.paragraphe}>
              {TEXTES_MAQUETTE.presentation2}
            </Text>
          </View>

          <View style={{ flex: 1, flexDirection: 'row', paddingTop: 30 }}>
            {STATISTIQUES.map((stat) => (
              <View key={stat.libelle} style={{ flex: 1, alignItems: 'center' }}>
                <Text style={s.statChiffre}>{stat.chiffre}</Text>
                <Text style={s.statLibelle}>{stat.libelle}</Text>
                <Text
                  style={[s.carteTexteDoux, { textAlign: 'center', marginTop: 6 }]}
                >
                  {stat.detail}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Pied reference={boq.referenceOffre} />
      </Page>

      {/* 3. Valeurs */}
      <Page size={FORMAT} style={s.pageSombre}>
        <Text style={s.titrePageBlanc}>{TEXTES_MAQUETTE.titreValeurs}</Text>
        <Text style={s.chapeau}>
          {TEXTES_MAQUETTE.chapeauValeurs}
        </Text>

        <View style={s.grille}>
          {VALEURS.map((valeur) => (
            <View key={valeur.titre} style={s.colonneDemi}>
              <View style={s.carteBleue}>
                <Text style={s.carteTitre}>{valeur.titre}</Text>
                <Text style={s.carteTexte}>{valeur.texte}</Text>
              </View>
            </View>
          ))}
        </View>

        <Pied reference={boq.referenceOffre} />
      </Page>

      {/* 4. Positionnement */}
      <Page size={FORMAT} style={s.pageSombre}>
        <Text style={[s.titrePage, { maxWidth: 560 }]}>
          {TEXTES_MAQUETTE.titrePositionnement}
        </Text>

        <View style={s.grille}>
          {ATOUTS.map((atout) => (
            <View key={atout.titre} style={s.colonneDemi}>
              <View style={s.carteBordee}>
                <Text style={s.carteTitreAccent}>{atout.titre}</Text>
                <Text style={s.carteTexteDoux}>{atout.texte}</Text>
              </View>
            </View>
          ))}
        </View>

        <Pied reference={boq.referenceOffre} />
      </Page>

      {/* 5. Domaines d'intervention */}
      <Page size={FORMAT} style={s.pageSombre}>
        <Text style={s.titrePageBlanc}>{TEXTES_MAQUETTE.titreDomaines}</Text>
        <Text style={s.chapeau}>
          {TEXTES_MAQUETTE.chapeauDomaines}
        </Text>

        <View style={s.grille}>
          {DOMAINES.map((domaine) => (
            <View key={domaine.titre} style={s.colonneTiers}>
              <Text style={s.carteTitreAccent}>{domaine.titre}</Text>
              <Text style={s.carteTexteDoux}>{domaine.texte}</Text>
            </View>
          ))}
        </View>

        <Pied reference={boq.referenceOffre} />
      </Page>

      {/* 6. Démarche */}
      <Page size={FORMAT} style={s.pageSombre}>
        <Text style={s.titrePage}>{TEXTES_MAQUETTE.titreDemarche}</Text>
        <Text style={s.chapeau}>
          {TEXTES_MAQUETTE.chapeauDemarche}
        </Text>

        <View style={s.grille}>
          {DEMARCHE.map((etape, index) => (
            <View key={etape.titre} style={s.colonneTiers}>
              <Text style={s.etapeNumero}>
                {String(index + 1).padStart(2, '0')}
              </Text>
              <View style={s.etapeTrait} />
              <Text style={s.carteTitre}>{etape.titre}</Text>
              <Text style={s.carteTexteDoux}>{etape.texte}</Text>
            </View>
          ))}
        </View>

        <Pied reference={boq.referenceOffre} />
      </Page>

      {/* 7. La solution proposée — alimentée par le BoQ */}
      <Page size={FORMAT} style={s.pageSombre} wrap>
        <Text style={s.titrePageBlanc}>{boq.solution.titre}</Text>
        <Text style={s.paragraphe}>{boq.solution.resume}</Text>

        {boq.solution.tableauExplicatif.length > 0 && (
          <View style={{ marginTop: 12 }}>
            {boq.solution.tableauExplicatif.map((ligne, index) => (
              <View key={index} style={{ flexDirection: 'row', marginBottom: 8 }}>
                <Text style={[s.carteTexteDoux, { flex: 1, paddingRight: 10 }]}>
                  {ligne.besoin}
                </Text>
                <Text style={[s.carteTexte, { flex: 1.2, paddingRight: 10 }]}>
                  {ligne.solutionProposee}
                </Text>
                <Text style={[s.carteTexteDoux, { flex: 1, color: couleurs.accent }]}>
                  {ligne.benefice}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Pied reference={boq.referenceOffre} />
      </Page>

      {/* 8. Équipements proposés */}
      <Page size={FORMAT} style={s.pageSombre} wrap>
        <Text style={s.titrePageBlanc}>{TEXTES_MAQUETTE.titreEquipements}</Text>

        {boq.produits.map((produit, index) => (
          <View key={index} style={s.equipement} wrap={false}>
            {produit.imageUrl ? (
              // `Image` vient de react-pdf, pas du DOM : il n'accepte pas
              // d'attribut alt, la règle jsx-a11y ne s'applique pas ici.
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={produit.imageUrl} style={s.equipementImage} />
            ) : (
              <View style={s.equipementImageVide}>
                <Text style={{ fontSize: 7, color: '#8A8F96' }}>Visuel à venir</Text>
              </View>
            )}

            <View style={s.equipementCorps}>
              <Text style={s.equipementTitre}>{produit.designation}</Text>
              <Text style={s.equipementMeta}>
                {produit.marque}
                {produit.reference ? ` — réf. ${produit.reference}` : ''}
                {` — quantité : ${produit.quantite}`}
              </Text>

              {produit.descriptionTechnique && (
                <Text style={s.carteTexteDoux}>{produit.descriptionTechnique}</Text>
              )}

              {produit.pointsCles.map((point, i) => (
                <Text key={i} style={[s.carteTexteDoux, { marginTop: 2 }]}>
                  • {point}
                </Text>
              ))}
            </View>
          </View>
        ))}

        <Pied reference={boq.referenceOffre} />
      </Page>

      {/* 9. Offre financière — fond clair, comme la maquette */}
      <Page size={FORMAT} style={s.pageClaire} wrap>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 22,
          }}
        >
          <Text style={{ fontSize: 30, color: couleurs.accent }}>
            {TEXTES_MAQUETTE.titreFinancier}
          </Text>
          <LogoVigon largeur={150} variante="sombre" />
        </View>

        <View style={s.tableauEnTete}>
          <Text style={[s.celluleEnTete, s.colDescription]}>Description</Text>
          <Text style={[s.celluleEnTete, s.colQte]}>Qté</Text>
          <Text style={[s.celluleEnTete, s.colPrix]}>Prix U HT</Text>
          <Text style={[s.celluleEnTete, s.colPrix]}>Prix T HT</Text>
        </View>

        {boq.produits.map((produit, index) => (
          <View
            key={index}
            style={index % 2 === 0 ? s.tableauLigneAlt : s.tableauLigne}
            wrap={false}
          >
            <Text style={[s.cellule, s.colDescription]}>
              {produit.designation}
              {produit.reference ? ` ${produit.reference}` : ''}
            </Text>
            <Text style={[s.cellule, s.colQte]}>{produit.quantite}</Text>
            <Text style={[s.cellule, s.colPrix]}>
              {montant(produit.prixUnitaireHt, devise)}
            </Text>
            <Text style={[s.cellule, s.colPrix]}>
              {montant(produit.totalHt, devise)}
            </Text>
          </View>
        ))}

        <View style={s.tableauTotal} wrap={false}>
          <Text style={[s.cellule, s.colDescription]} />
          <Text style={[s.cellule, s.colQte]} />
          <Text style={[s.cellule, s.colPrix, { fontSize: 11 }]}>Total HT</Text>
          <Text style={[s.cellule, s.colPrix, { fontSize: 11 }]}>
            {montant(boq.totaux.totalHt, devise)}
          </Text>
        </View>

        <View style={s.tableauLigneAlt} wrap={false}>
          <Text style={[s.cellule, s.colDescription]} />
          <Text style={[s.cellule, s.colQte]} />
          <Text style={[s.cellule, s.colPrix, { fontSize: 11 }]}>
            TVA {boq.totaux.tvaPct}%
          </Text>
          <Text style={[s.cellule, s.colPrix, { fontSize: 11 }]}>
            {montant(boq.totaux.totalTva, devise)}
          </Text>
        </View>

        <View style={s.tableauTotalFort} wrap={false}>
          <Text style={[s.celluleForte, s.colDescription]} />
          <Text style={[s.celluleForte, s.colQte]} />
          <Text style={[s.celluleForte, s.colPrix]}>Total TTC</Text>
          <Text style={[s.celluleForte, s.colPrix]}>
            {montant(boq.totaux.totalTtc, devise)}
          </Text>
        </View>
      </Page>

      {/* 10. Conditions */}
      <Page size={FORMAT} style={s.pageSombre}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <Text style={[s.titrePageBlanc, { marginTop: 34 }]}>
            {TEXTES_MAQUETTE.titreConditions}
          </Text>
          <LogoVigon largeur={150} />
        </View>

        <View style={{ marginTop: 24 }}>
          <Puce>
            <Text style={{ color: couleurs.accent }}>Paiement — </Text>
            {boq.conditions.paiement}
          </Puce>
          <Puce>
            <Text style={{ color: couleurs.accent }}>Livraison — </Text>
            {boq.conditions.livraison}
          </Puce>
          <Puce>
            <Text style={{ color: couleurs.accent }}>Garantie — </Text>
            {boq.conditions.garantie}
          </Puce>
          <Puce>
            <Text style={{ color: couleurs.accent }}>Validité de l&apos;offre — </Text>
            {boq.validite}
          </Puce>
        </View>

        <Pied reference={boq.referenceOffre} />
      </Page>

      {/* 11. Appel à l'action */}
      <Page size={FORMAT} style={s.pageSombre}>
        <Text style={[s.titrePageBlanc, { marginTop: 50, fontSize: 34, maxWidth: 700 }]}>
          {TEXTES_MAQUETTE.titreAppel}
        </Text>

        <Text style={[s.paragraphe, { color: couleurs.accent, maxWidth: 760 }]}>
          {TEXTES_MAQUETTE.accrocheAppel}
        </Text>

        <View style={{ flexDirection: 'row', marginTop: 30 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, color: couleurs.blanc, marginBottom: 12 }}>
              Get in Touch
            </Text>
            {CONTACTS.map((contact) => (
              <Puce key={contact}>{contact}</Puce>
            ))}
          </View>

          <View style={{ flex: 1, paddingLeft: 30 }}>
            <Text style={s.paragraphe}>
              {TEXTES_MAQUETTE.remerciement}
            </Text>
          </View>
        </View>

        <Pied reference={boq.referenceOffre} />
      </Page>
    </Document>
  );
}
