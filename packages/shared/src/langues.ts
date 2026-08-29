/**
 * Langues de correspondance avec les fournisseurs.
 *
 * Un fournisseur allemand qui reçoit une demande de devis en français y répond
 * plus lentement, ou pas du tout. La langue n'est donc pas un confort : elle
 * conditionne le taux de réponse, qui conditionne le costing.
 */

export const LANGUES = ['fr', 'en', 'es', 'de', 'it', 'ar'] as const;

export type Langue = (typeof LANGUES)[number];

export const LANGUE_DEFAUT: Langue = 'fr';

/** Libellé affiché dans l'interface, dans la langue elle-même. */
export const LIBELLES_LANGUE: Record<Langue, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
  de: 'Deutsch',
  it: 'Italiano',
  ar: 'العربية',
};

/**
 * Nom de la langue en français, pour l'instruction donnée au modèle.
 *
 * Le prompt reste rédigé en français quelle que soit la langue de sortie : le
 * modèle suit mieux une consigne dans une langue qu'il maîtrise que la même
 * consigne traduite.
 */
export const NOM_LANGUE_POUR_PROMPT: Record<Langue, string> = {
  fr: 'français',
  en: 'anglais',
  es: 'espagnol',
  de: 'allemand',
  it: 'italien',
  ar: 'arabe',
};

export function estLangue(valeur: unknown): valeur is Langue {
  return typeof valeur === 'string' && (LANGUES as readonly string[]).includes(valeur);
}

/**
 * Pays -> langue probable, utilisée tant qu'aucune langue n'est choisie à la main.
 *
 * Une approximation assumée : le champ `pays` est saisi librement ou déduit du
 * sourcing web, il ne porte pas de code ISO fiable. On reconnaît donc des
 * libellés courants, et tout ce qui n'est pas reconnu retombe sur le français —
 * le marché principal.
 */
const LANGUE_PAR_PAYS: { motifs: string[]; langue: Langue }[] = [
  { motifs: ['maroc', 'morocco', 'france', 'french', 'belgi', 'tunis', 'algér', 'alger', 'senegal', 'sénégal', 'suisse'], langue: 'fr' },
  { motifs: ['deutsch', 'german', 'allemagne', 'autriche', 'austria'], langue: 'de' },
  { motifs: ['espan', 'españ', 'spain', 'espagne', 'mexic', 'argentin', 'colomb', 'chili'], langue: 'es' },
  { motifs: ['ital'], langue: 'it' },
  { motifs: ['arabie', 'saudi', 'emirat', 'émirat', 'uae', 'qatar', 'koweit', 'koweït', 'egypt', 'égypt'], langue: 'ar' },
  { motifs: ['united states', 'usa', 'états-unis', 'etats-unis', 'royaume-uni', 'united kingdom', 'england', 'irlande', 'ireland', 'canada', 'inde', 'india', 'china', 'chine', 'singap', 'nederland', 'pays-bas', 'netherlands', 'suède', 'sweden', 'pologne', 'poland'], langue: 'en' },
];

/**
 * Langue probable d'un fournisseur d'après son pays.
 *
 * Sert de proposition à la saisie et de repli à l'envoi. Un choix explicite
 * l'emporte toujours.
 */
/** Minuscules sans accents : « Émirats » et « emirats » doivent se rencontrer. */
function sansAccents(valeur: string): string {
  return valeur
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function langueDepuisPays(pays: string | null | undefined): Langue {
  if (!pays) return LANGUE_DEFAUT;

  const normalise = sansAccents(pays);

  for (const { motifs, langue } of LANGUE_PAR_PAYS) {
    if (motifs.some((motif) => normalise.includes(sansAccents(motif)))) return langue;
  }

  return LANGUE_DEFAUT;
}
