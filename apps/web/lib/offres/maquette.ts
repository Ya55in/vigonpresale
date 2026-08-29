/**
 * Maquette Vigon Systems — contenu et couleurs partagés par le PDF et le web.
 *
 * Le gabarit PDF (`DocumentOffre.tsx`) et le rendu web (`RenduOffre.tsx`)
 * présentent la même offre. Dupliquer les couleurs et les sept pages
 * institutionnelles dans les deux les ferait diverger dès la première retouche —
 * le client verrait alors un document à l'écran et un autre en pièce jointe.
 *
 * Ce module ne contient que des données : aucun accès disque, aucune dépendance
 * à react-pdf. Il est donc importable depuis un composant client comme depuis le
 * script d'essai qui tourne hors Next.
 */

export const COULEURS_MAQUETTE = {
  /** Fond des diapositives — exactement celui des logos fournis. */
  sombre: '#2A2A2A',
  /** Couverture seule. */
  noir: '#000000',
  accent: '#5B8FD0',
  blanc: '#FFFFFF',
  doux: '#D5D8DC',
  /** Texte discret : pieds de page, mentions. */
  discret: '#8A8F96',
  /** Bordure des cartes sur fond sombre. */
  bordure: '#4A4A4A',
  /** Page financière, sur fond clair. */
  clairTexte: '#1F2328',
  clairAlterne: '#F5F5F5',
} as const;

export type BlocMaquette = { titre: string; texte: string };

export const VALEURS: BlocMaquette[] = [
  {
    titre: 'Innovation',
    texte:
      "Pioneering next-generation IT solutions that anticipate tomorrow's hospitality needs and exceed today's expectations.",
  },
  {
    titre: 'Trust',
    texte:
      'Building lasting partnerships through transparent communication, reliable delivery, and unwavering commitment to excellence.',
  },
  {
    titre: 'Flexibility',
    texte:
      'Adapting our solutions to meet unique property requirements while maintaining scalability for future growth.',
  },
  {
    titre: 'Excellence',
    texte:
      'Delivering premium quality in every aspect of our service, from initial consultation to ongoing support.',
  },
];

export const ATOUTS: BlocMaquette[] = [
  {
    titre: 'Complete Coverage',
    texte:
      'End-to-end IT infrastructure management from design through ongoing support, ensuring seamless operations.',
  },
  {
    titre: 'Deep Expertise',
    texte:
      'Specialized knowledge in hospitality technology with proven success across luxury properties throughout Africa.',
  },
  {
    titre: 'Financing Flexibility',
    texte:
      'CAPEX and OPEX models available to align with your budget requirements and cash flow preferences.',
  },
  {
    titre: 'Premium References',
    texte:
      'Trusted by leading hospitality brands who demand excellence in technology infrastructure and guest experience.',
  },
];

export const DOMAINES: BlocMaquette[] = [
  {
    titre: 'High-Speed WiFi',
    texte:
      'Seamless connectivity throughout your property with enterprise-grade wireless infrastructure ensuring guests stay connected effortlessly.',
  },
  {
    titre: 'IPTV & Entertainment',
    texte:
      'Premium in-room entertainment systems with customizable content delivery and interactive guest services integration.',
  },
  {
    titre: 'Telephony',
    texte:
      'Advanced communication systems supporting both internal operations and exceptional guest communication experiences.',
  },
  {
    titre: 'CCTV & Access Control',
    texte:
      'Comprehensive security solutions protecting guests and assets with intelligent monitoring and access management.',
  },
  {
    titre: 'Datacenter & Cloud',
    texte:
      'Robust data infrastructure with hybrid cloud solutions ensuring reliability, scalability, and data protection.',
  },
  {
    titre: 'Fire Detection & Safety',
    texte:
      'Advanced safety systems integrated with your IT infrastructure for comprehensive property protection and compliance.',
  },
];

export const DEMARCHE: BlocMaquette[] = [
  {
    titre: 'Design & Engineering',
    texte:
      "Custom system architecture tailored to your property's unique requirements and guest experience goals.",
  },
  {
    titre: 'Equipment Supply',
    texte:
      'Premium hardware sourcing with enterprise-grade components ensuring reliability and performance.',
  },
  {
    titre: 'Installation & Configuration',
    texte:
      'Professional deployment with minimal disruption to your operations and guest services.',
  },
  {
    titre: 'PMS Integration',
    texte: 'Seamless connection with your property management system for unified operations.',
  },
  {
    titre: 'Training & Support',
    texte:
      'Comprehensive staff training and ongoing technical support ensuring optimal system performance.',
  },
];

export const CONTACTS = [
  'sales@vigonsystems.com',
  'www.vigonsystems.com',
  '+212 (0) 6 62 16 46 45',
];

/** Accroches de la couverture et de la dernière diapositive. */
export const TEXTES_MAQUETTE = {
  accrocheCouverture:
    'VIGON Systems delivers world-class IT solutions that elevate guest experiences and operational excellence in premium hospitality environments.',
  titrePresentation: 'About VIGON Systems',
  accrochePresentation: 'African IT Leadership Since 2014',
  presentation1:
    "VIGON Systems has emerged as Morocco and Africa's premier IT infrastructure partner, delivering cutting-edge solutions that transform how luxury properties operate and serve their guests.",
  presentation2:
    'With offices strategically located in Casablanca and Marrakech, we extend our expertise across the African continent, providing localized service with global standards.',
  titreValeurs: 'Our Core Values',
  chapeauValeurs:
    'Four fundamental principles guide every project we undertake, ensuring consistent excellence in luxury hospitality technology.',
  titrePositionnement: 'Your Trusted IT Partner for World-Class Hospitality',
  titreDomaines: 'Comprehensive IT Solutions',
  chapeauDomaines:
    'Our integrated technology ecosystem transforms luxury hospitality operations with enterprise-grade infrastructure and guest-focused innovations.',
  titreDemarche: 'Tailored IT Solution for Your Property',
  chapeauDemarche:
    'Our comprehensive approach ensures seamless integration from concept to completion, delivering technology that enhances both guest experience and operational efficiency.',
  titreEquipements: 'Équipements Proposés',
  titreFinancier: 'Offre financière',
  titreConditions: 'Conditions',
  titreAppel: 'Ready to Transform Your Guest Experience?',
  accrocheAppel:
    "Partner with VIGON Systems to deliver the premium technology infrastructure your guests expect and your operations demand. Our team is ready to discuss your specific requirements and create a customized solution that enhances your property's competitive advantage.",
  remerciement:
    "Thank you for considering VIGON Systems as your technology partner. We look forward to contributing to your property's continued success and guest satisfaction.",
} as const;

/** Statistiques de la page de présentation. */
export const STATISTIQUES = [
  {
    chiffre: '500+',
    libelle: 'Satisfied Clients',
    detail: 'Trusted partnerships built on excellence',
  },
  {
    chiffre: '1.8K',
    libelle: 'Solutions Installed',
    detail: 'Proven track record of successful deployments',
  },
];

/**
 * Montant au format de la maquette : `151,287.50 DH`.
 *
 * Séparateur de milliers par virgule et deux décimales, comme l'export de
 * référence — et « DH » pour le dirham, que `MAD` rendrait moins lisible pour
 * un lecteur marocain.
 */
export function montantMaquette(valeur: number, devise: string): string {
  const nombre = valeur.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${nombre} ${devise === 'MAD' ? 'DH' : devise}`;
}
