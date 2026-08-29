import { z } from 'zod';

/**
 * Sortie attendue de la rédaction d'une demande de devis (flux étape 4).
 *
 * Le modèle ne fournit que des données structurées : le HTML est assemblé
 * ensuite par buildRfqHtml(), jamais par l'IA.
 */
export const rfqSchema = z.object({
  sujet: z.string().min(1),
  intro: z.string().min(1),
  transition: z.string().min(1),
  articles: z.array(z.string().min(1)).min(1),
  questions_intro: z.string().min(1),
  questions: z.array(z.string().min(1)).min(1),
  cloture: z.string().min(1),
});

export type Rfq = z.infer<typeof rfqSchema>;

/** Marqueur de début de signature produit par buildRfqTexte(). */
const SEPARATEUR_SIGNATURE = '--';

/** Préfixe des puces produites par buildRfqTexte(). */
const PUCE = '- ';

/**
 * Relit la version texte d'une demande de devis pour retrouver sa structure.
 *
 * Réciproque de buildRfqTexte() : les deux doivent rester alignées, sinon
 * l'écran d'édition rouvre une consultation avec des champs mal découpés. Le
 * découpage est tolérant — un texte qui ne suit pas le format ne fait pas
 * échouer l'écran, il remplit seulement moins de champs.
 *
 * Le `sujet` ne figure pas dans le corps : il est stocké à part et se complète
 * après coup.
 */
export function parseRfqTexte(texte: string): Omit<Rfq, 'sujet'> {
  const lignes = texte.replace(/\r\n/g, '\n').split('\n');

  // La signature est réappliquée à la reconstruction : la garder ici la
  // dupliquerait à chaque aller-retour dans l'écran d'édition.
  const finCorps = lignes.findIndex((l) => l.trim() === SEPARATEUR_SIGNATURE);
  const corps = finCorps === -1 ? lignes : lignes.slice(0, finCorps);

  const paragraphes: string[] = [];
  const listes: string[][] = [];
  let enCours: string[] = [];
  let dansUneListe = false;

  /** Ferme le paragraphe courant en cours d'accumulation. */
  const clore = (): void => {
    const texteParagraphe = enCours.join(' ').trim();
    if (texteParagraphe) paragraphes.push(texteParagraphe);
    enCours = [];
  };

  for (const ligne of corps) {
    const nettoyee = ligne.trim();

    if (nettoyee.startsWith(PUCE)) {
      clore();
      const item = nettoyee.slice(PUCE.length).trim();
      // Les puces qui se suivent forment une seule liste ; c'est le retour à
      // du texte courant qui en ouvre une nouvelle.
      if (dansUneListe) listes[listes.length - 1]?.push(item);
      else listes.push([item]);
      dansUneListe = true;
      continue;
    }

    if (!nettoyee) {
      clore();
      continue;
    }

    enCours.push(nettoyee);
    dansUneListe = false;
  }
  clore();

  return {
    intro: paragraphes[0] ?? '',
    transition: paragraphes[1] ?? '',
    articles: listes[0] ?? [],
    questions_intro: paragraphes[2] ?? '',
    questions: listes[1] ?? [],
    cloture: paragraphes[3] ?? '',
  };
}
