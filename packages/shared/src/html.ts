/**
 * Échappement HTML des textes insérés dans un courriel.
 *
 * Tous les gabarits d'e-mail sont assemblés en TypeScript, jamais par le
 * modèle, et y injectent des valeurs venues de la base : sujet d'une
 * consultation, titre d'une offre, nom d'un fournisseur. Aucune n'est de
 * confiance — un sujet de courriel est saisi par un tiers.
 *
 * Cette fonction vivait en cinq exemplaires identiques, un par gabarit. Une
 * fonction de sécurité dupliquée finit par diverger : il suffit qu'une copie
 * oublie un caractère au fil d'une retouche pour ouvrir une injection sur ce
 * seul canal, sans que rien ne le signale ailleurs.
 *
 * Les cinq caractères couverts sont ceux qui permettent de sortir d'un contenu
 * ou d'un attribut HTML. `/` n'y figure pas : il ne clôt rien à lui seul, et les
 * gabarits n'insèrent jamais de valeur dans un nom de balise.
 */
export function echapperHtml(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
