/** Constantes métier partagées entre l'application et le worker. */

/** Valeurs de repli quand le paramètre n'est pas en base (table `parametres`). */
export const DEFAUTS_METIER = {
  margeDefautPct: 25,
  tvaPct: 20,
  delaiRelanceHeures: 48,
  maxRelances: 3,
  delaiExpirationOffreJours: 15,
  /** Jours avant expiration où le client est relancé. 0 désactive la relance. */
  delaiRelanceClientJours: 3,
  seuilValidationFinanceMontant: 100_000,
  seuilValidationFinanceMargeMin: 15,
} as const;

/** Décompression ZIP : bornes imposées par la spec (flux étape 1). */
export const LIMITES_ARCHIVE = {
  profondeurMax: 2,
  fichiersMax: 50,
} as const;

/** Extensions dont on sait extraire du texte. */
export const EXTENSIONS_SUPPORTEES = [
  '.pdf',
  '.xlsx',
  '.xls',
  '.docx',
  '.csv',
  '.txt',
  '.zip',
] as const;

/**
 * Rejette les adresses inexploitables pour une prise de contact commerciale
 * (flux étape 3b). Sert aussi de garde-fou sur ce que renvoie le sourcing web.
 */
const MOTIFS_EMAIL_REJETES = [
  'noreply',
  'no-reply',
  'donotreply',
  'example.com',
  'example.org',
  'sentry.io',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
];

const FORMAT_EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function emailCommercialValide(email: string): boolean {
  const valeur = email.trim().toLowerCase();
  if (!FORMAT_EMAIL.test(valeur)) return false;
  return !MOTIFS_EMAIL_REJETES.some((motif) => valeur.includes(motif));
}
