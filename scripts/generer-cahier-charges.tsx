/**
 * Génère un cahier des charges client réaliste, en PDF.
 *
 * Sert à éprouver la chaîne de réception de bout en bout : le worker relève le
 * courriel, stocke la pièce jointe, en extrait le texte, le consolide, puis le
 * modèle en tire les articles.
 *
 * Le texte est composé par `@react-pdf/renderer`, donc réellement sélectionnable :
 * un PDF scanné ne donnerait rien à `pdf-parse`, et l'extraction repartirait sur
 * le seul corps du courriel.
 *
 * Usage : npm run generer:cahier-charges
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer';
import React from 'react';

const COULEURS = {
  encre: '#1F2328',
  gris: '#6B7280',
  trait: '#D1D5DB',
  entete: '#F3F4F6',
};

const s = StyleSheet.create({
  page: { padding: 44, fontSize: 9.5, color: COULEURS.encre, lineHeight: 1.5 },
  enteteSociete: { fontSize: 15, fontWeight: 'bold' },
  coordonnees: { fontSize: 8.5, color: COULEURS.gris, marginTop: 3 },
  filet: { borderBottomWidth: 1, borderBottomColor: COULEURS.trait, marginVertical: 14 },
  titre: { fontSize: 13, fontWeight: 'bold', marginBottom: 3 },
  reference: { fontSize: 8.5, color: COULEURS.gris, marginBottom: 14 },
  section: { fontSize: 10.5, fontWeight: 'bold', marginTop: 16, marginBottom: 6 },
  paragraphe: { marginBottom: 7, textAlign: 'justify' },
  ligneTableau: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: COULEURS.trait, paddingVertical: 5 },
  enteteTableau: { flexDirection: 'row', backgroundColor: COULEURS.entete, paddingVertical: 5, paddingHorizontal: 2, fontWeight: 'bold', fontSize: 8.5 },
  cLot: { width: '8%' },
  cDesignation: { width: '40%', paddingRight: 6 },
  cReference: { width: '20%', paddingRight: 6 },
  cMarque: { width: '18%', paddingRight: 6 },
  cQuantite: { width: '14%', textAlign: 'right' },
  puce: { marginBottom: 3, paddingLeft: 10 },
  pied: { position: 'absolute', bottom: 28, left: 44, right: 44, fontSize: 7.5, color: COULEURS.gris, borderTopWidth: 0.5, borderTopColor: COULEURS.trait, paddingTop: 6 },
});

/**
 * Le matériel demandé.
 *
 * Références et marques réelles du marché : c'est ce que le sourcing exploite
 * pour retrouver un distributeur. Des références inventées feraient échouer
 * l'étape suivante sans que le défaut vienne de la réception.
 */
const LOTS = [
  {
    lot: 1,
    intitule: 'Couverture WiFi des chambres et parties communes',
    articles: [
      { designation: 'Point d’accès WiFi 6 intérieur, montage plafond', reference: 'U6-PRO', marque: 'Ubiquiti', quantite: 96, unite: 'u' },
      { designation: 'Point d’accès WiFi 6 extérieur, terrasse et piscine', reference: 'U6-MESH-PRO', marque: 'Ubiquiti', quantite: 12, unite: 'u' },
      { designation: 'Contrôleur WiFi centralisé, licence 200 bornes', reference: 'UDM-SE', marque: 'Ubiquiti', quantite: 2, unite: 'u' },
    ],
  },
  {
    lot: 2,
    intitule: 'Commutation et distribution',
    articles: [
      { designation: 'Commutateur 48 ports PoE+ administrable, 740 W', reference: 'C9200L-48P-4G-E', marque: 'Cisco', quantite: 6, unite: 'u' },
      { designation: 'Commutateur 24 ports PoE+ administrable', reference: 'C9200L-24P-4G-E', marque: 'Cisco', quantite: 4, unite: 'u' },
      { designation: 'Module SFP+ 10G multimode, 300 m', reference: 'SFP-10G-SR', marque: 'Cisco', quantite: 24, unite: 'u' },
      { designation: 'Jarretière fibre OM4 LC-LC duplex, 5 m', reference: 'OM4-LC-5M', marque: 'Multimarque', quantite: 40, unite: 'u' },
    ],
  },
  {
    lot: 3,
    intitule: 'Sécurité périmétrique et accès invités',
    articles: [
      { designation: 'Pare-feu UTM, débit inspecté 5 Gbit/s, HA', reference: 'FG-100F', marque: 'Fortinet', quantite: 2, unite: 'u' },
      { designation: 'Abonnement UTM Bundle 36 mois', reference: 'FC-10-F100F-950', marque: 'Fortinet', quantite: 2, unite: 'licence' },
      { designation: 'Portail captif conforme RGPD, 500 sessions', reference: 'CAPTIVE-500', marque: 'Multimarque', quantite: 1, unite: 'licence' },
    ],
  },
  {
    lot: 4,
    intitule: 'Énergie et baie technique',
    articles: [
      { designation: 'Onduleur rack 3000 VA, autonomie 15 min à mi-charge', reference: 'SRT3000RMXLI', marque: 'APC', quantite: 3, unite: 'u' },
      { designation: 'Baie 42U 800x1000 avec passe-câbles et ventilation', reference: 'AR3350', marque: 'APC', quantite: 2, unite: 'u' },
      { designation: 'Bandeau de 8 prises rack, mesure de consommation', reference: 'AP8853', marque: 'APC', quantite: 4, unite: 'u' },
    ],
  },
];

const EXIGENCES = [
  'Interruption de service limitée à la plage 02h00 – 06h00, hôtel en exploitation continue.',
  'Recette contradictoire par étage : couverture mesurée à -65 dBm minimum dans chaque chambre.',
  'Documentation de recollement remise en français, plans de câblage inclus.',
  'Formation de deux techniciens de notre équipe technique, une demi-journée sur site.',
  'Garantie constructeur de 36 mois minimum sur les équipements actifs.',
  'Maintenance corrective avec intervention sur site sous 4 heures ouvrées.',
];

function total(): number {
  return LOTS.reduce((s, l) => s + l.articles.reduce((n, a) => n + a.quantite, 0), 0);
}

function CahierDesCharges(): React.ReactElement {
  return (
    <Document
      title="Cahier des charges — Refonte infrastructure réseau"
      author="Hôtel Riad Al Andalous"
      subject="Consultation CDC-2026-014"
    >
      <Page size="A4" style={s.page}>
        <Text style={s.enteteSociete}>HÔTEL RIAD AL ANDALOUS *****</Text>
        <Text style={s.coordonnees}>
          Avenue Mohammed VI, Hivernage — 40000 Marrakech, Maroc{'\n'}
          Direction des Systèmes d&apos;Information — dsi@riad-alandalous.ma — +212 5 24 33 12 40
        </Text>

        <View style={s.filet} />

        <Text style={s.titre}>
          Cahier des charges — Refonte de l&apos;infrastructure réseau
        </Text>
        <Text style={s.reference}>
          Référence CDC-2026-014 · Émis le 12 août 2026 · Remise des offres avant le 5 septembre 2026
        </Text>

        <Text style={s.section}>1. Contexte</Text>
        <Text style={s.paragraphe}>
          L&apos;établissement compte 96 chambres et suites réparties sur quatre niveaux, deux
          salles de séminaire, un spa et une terrasse-piscine. L&apos;infrastructure réseau
          actuelle, déployée en 2017, ne supporte plus la charge : la couverture WiFi est
          discontinue dans l&apos;aile Est et le débit s&apos;effondre en période de forte
          occupation. Les réclamations clients portant sur la connexion représentent le
          premier motif d&apos;insatisfaction relevé sur les douze derniers mois.
        </Text>
        <Text style={s.paragraphe}>
          La présente consultation porte sur la fourniture, l&apos;installation et la mise en
          service d&apos;une infrastructure complète, en quatre lots indissociables. Les
          candidats sont invités à remettre une offre couvrant l&apos;intégralité du périmètre.
        </Text>

        <Text style={s.section}>2. Matériel demandé</Text>

        <View style={s.enteteTableau}>
          <Text style={s.cLot}>Lot</Text>
          <Text style={s.cDesignation}>Désignation</Text>
          <Text style={s.cReference}>Référence</Text>
          <Text style={s.cMarque}>Marque</Text>
          <Text style={s.cQuantite}>Quantité</Text>
        </View>

        {LOTS.map((l) =>
          l.articles.map((a, i) => (
            <View key={`${l.lot}-${a.reference}`} style={s.ligneTableau}>
              <Text style={s.cLot}>{i === 0 ? `L${l.lot}` : ''}</Text>
              <Text style={s.cDesignation}>{a.designation}</Text>
              <Text style={s.cReference}>{a.reference}</Text>
              <Text style={s.cMarque}>{a.marque}</Text>
              <Text style={s.cQuantite}>
                {a.quantite} {a.unite}
              </Text>
            </View>
          )),
        )}

        <Text style={{ ...s.coordonnees, marginTop: 8 }}>
          Total : {total()} unités réparties sur {LOTS.length} lots.
        </Text>

        <Text style={s.pied} fixed>
          CDC-2026-014 — Hôtel Riad Al Andalous — Document confidentiel
        </Text>
      </Page>

      <Page size="A4" style={s.page}>
        <Text style={s.section}>3. Détail des lots</Text>
        {LOTS.map((l) => (
          <View key={l.lot} wrap={false}>
            <Text style={{ fontWeight: 'bold', marginTop: 8, marginBottom: 3 }}>
              Lot {l.lot} — {l.intitule}
            </Text>
            {l.articles.map((a) => (
              <Text key={a.reference} style={s.puce}>
                • {a.quantite} × {a.designation} ({a.marque} {a.reference})
              </Text>
            ))}
          </View>
        ))}

        <Text style={s.section}>4. Exigences techniques et contractuelles</Text>
        {EXIGENCES.map((e) => (
          <Text key={e} style={s.puce}>
            • {e}
          </Text>
        ))}

        <Text style={s.section}>5. Conditions de remise</Text>
        <Text style={s.paragraphe}>
          Les offres devront détailler le prix unitaire hors taxes de chaque référence, le
          délai de livraison, la durée de garantie et les conditions de paiement proposées.
          Toute proposition d&apos;équipement équivalent devra être signalée comme telle et
          accompagnée de sa fiche technique.
        </Text>
        <Text style={s.paragraphe}>
          Le planning de déploiement souhaité prévoit un démarrage des travaux au
          15 octobre 2026 et une mise en service complète avant le 20 décembre 2026, hors
          période de forte affluence.
        </Text>

        <View style={s.filet} />
        <Text style={s.coordonnees}>
          Contact technique : M. Youssef Benali, Responsable SI{'\n'}
          dsi@riad-alandalous.ma — +212 5 24 33 12 40 (poste 218)
        </Text>

        <Text style={s.pied} fixed>
          CDC-2026-014 — Hôtel Riad Al Andalous — Document confidentiel
        </Text>
      </Page>
    </Document>
  );
}

async function main(): Promise<void> {
  const buffer = await renderToBuffer(<CahierDesCharges />);
  const chemin = resolve(process.cwd(), 'CDC-2026-014-Riad-Al-Andalous.pdf');
  writeFileSync(chemin, buffer);

  const articles = LOTS.reduce((n, l) => n + l.articles.length, 0);
  console.log(`\n✓ ${chemin}`);
  console.log(`  ${(buffer.length / 1024).toFixed(0)} Ko · ${LOTS.length} lots · ${articles} références · ${total()} unités\n`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
