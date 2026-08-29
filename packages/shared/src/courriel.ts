/**
 * Découpe un courriel entrant en réponse utile et historique cité.
 *
 * Une réponse fournisseur arrive rarement seule : elle traîne une signature, un
 * en-tête « Message original » et l'intégralité de l'échange précédent recopié.
 * Sur un cas réel du projet, trois lignes utiles pour vingt-cinq affichées —
 * l'avant-vente doit chercher la réponse au milieu de ses propres mots.
 *
 * Rien n'est supprimé : la partie citée est renvoyée à part pour être repliée à
 * l'écran. Certains fournisseurs répondent EN LIGNE dans le message cité, et la
 * jeter perdrait la réponse elle-même.
 */

/**
 * Marqueurs de début d'historique, dans les six langues de correspondance.
 *
 * Volontairement ancrés en début de ligne : « le 12 août, il a écrit un devis »
 * au fil d'une phrase ne doit pas tronquer le message.
 */
const MARQUEURS_CITATION: RegExp[] = [
  // Séparateurs explicites des clients de messagerie
  /^\s*-{2,}\s*(message original|original message|forwarded message|message transféré)\s*-{2,}\s*$/i,
  /^\s*_{5,}\s*$/,
  // « Le 10 août 2026 à 18:40, Untel a écrit : » et ses équivalents
  /^\s*(le|on|el|am|il)\s+.{4,80}?\s+(a écrit|wrote|escribió|schrieb|ha scritto)\s*:?\s*$/i,
  // En-têtes recopiés en tête de bloc cité
  /^\s*(de|from|von|da|expéditeur)\s*:\s*.+$/i,
  // « كتب في … » — arabe
  /^\s*في\s+.{4,80}?\s*كتب\s*:?\s*$/,
];

/** Une ligne entièrement citée : `>`, `> >`, avec ou sans espaces. */
const LIGNE_CITEE = /^\s*>+/;

/**
 * Compacte les blancs sans toucher aux paragraphes.
 *
 * Les conversions HTML → texte produisent des cascades de `\n \n \n` : des
 * lignes qui paraissent vides mais portent une espace, donc invisibles à un
 * simple `\n{3,}`. On les normalise avant de compter.
 */
function compacter(texte: string): string {
  return texte
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((ligne) => ligne.replace(/[ \t ]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Indentation à partir de laquelle un bloc trahit une citation HTML. */
const INDENT_CITATION = 4;

/** Nombre de lignes indentées d'affilée exigé : deux peuvent être fortuites. */
const LIGNES_MINIMUM = 3;

/**
 * Repli sur l'indentation, quand aucun marqueur explicite n'a été trouvé.
 *
 * Les courriels rédigés en HTML n'ont ni `>` ni « Message original » : le client
 * de messagerie imbrique des tables, et la conversion en texte les rend par des
 * cascades d'espaces. Sur un cas réel du projet, l'historique arrivait indenté
 * de onze espaces sans le moindre autre indice.
 *
 * Ce repli est délibérément prudent — bloc en FIN de message uniquement, au
 * moins trois lignes, et du contenu non indenté au-dessus. Un tableau de prix
 * indenté au milieu d'une réponse ne doit pas passer pour de l'historique.
 * En cas de faux positif, le texte est replié, jamais perdu : il coûte un clic.
 */
function coupureParIndentation(lignes: string[]): number {
  let debut = -1;

  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    const ligne = lignes[i] ?? '';

    if (ligne.trim().length === 0) continue;

    const indent = ligne.length - ligne.trimStart().length;
    if (indent >= INDENT_CITATION) {
      debut = i;
      continue;
    }

    // Première ligne non indentée en remontant : le bloc s'arrête ici.
    break;
  }

  if (debut === -1) return -1;

  const utiles = lignes.slice(debut).filter((l) => l.trim().length > 0);
  if (utiles.length < LIGNES_MINIMUM) return -1;

  // Sans contenu non indenté au-dessus, tout le message est indenté : ce n'est
  // pas une citation, c'est une mise en forme. On ne coupe rien.
  const avant = lignes.slice(0, debut).some((l) => l.trim().length > 0);
  return avant ? debut : -1;
}

export type ReponseDecoupee = {
  /** Ce que le fournisseur a réellement écrit cette fois-ci. */
  corps: string;
  /** Historique cité, à replier. Chaîne vide s'il n'y en a pas. */
  cite: string;
  /** Vrai si un découpage a eu lieu : l'écran propose alors « voir la suite ». */
  tronque: boolean;
};

export function decouperReponse(brut: string | null | undefined): ReponseDecoupee {
  if (!brut) return { corps: '', cite: '', tronque: false };

  const lignes = brut.replace(/\r\n?/g, '\n').split('\n');

  let coupure = -1;

  for (let i = 0; i < lignes.length; i += 1) {
    const ligne = lignes[i] ?? '';

    if (MARQUEURS_CITATION.some((m) => m.test(ligne))) {
      coupure = i;
      break;
    }

    // Un bloc de lignes préfixées `>` marque aussi le début de l'historique.
    // On exige deux lignes consécutives : une seule peut être une citation
    // courte insérée volontairement par le fournisseur.
    if (LIGNE_CITEE.test(ligne) && LIGNE_CITEE.test(lignes[i + 1] ?? '')) {
      coupure = i;
      break;
    }
  }

  if (coupure === -1) coupure = coupureParIndentation(lignes);

  if (coupure === -1) {
    return { corps: compacter(brut), cite: '', tronque: false };
  }

  const corps = compacter(lignes.slice(0, coupure).join('\n'));
  const cite = compacter(lignes.slice(coupure).join('\n'));

  // Une coupure qui ne laisse rien signifie que le message n'est QUE de la
  // citation — un transfert sec, par exemple. Mieux vaut alors tout montrer
  // que d'afficher un cadre vide.
  if (corps.length === 0) {
    return { corps: cite, cite: '', tronque: false };
  }

  return { corps, cite, tronque: cite.length > 0 };
}

/**
 * Signature détachée du corps, pour l'afficher en retrait.
 *
 * Repère la formule de politesse en fin de message plutôt que le séparateur
 * `-- ` standard, que presque aucun client de messagerie n'émet réellement.
 * Ne cherche que dans les six dernières lignes : une formule de politesse au
 * milieu d'un texte n'en termine pas le propos.
 */
const FORMULES_CLOTURE =
  /^\s*(cordialement|bien à vous|salutations|best regards|regards|kind regards|saludos|atentamente|mit freundlichen grüßen|viele grüße|cordiali saluti|distinti saluti|مع تحياتي|وتفضلوا بقبول)\b/i;

export function detacherSignature(corps: string): { texte: string; signature: string } {
  const lignes = corps.split('\n');
  const debut = Math.max(0, lignes.length - 6);

  for (let i = lignes.length - 1; i >= debut; i -= 1) {
    if (FORMULES_CLOTURE.test(lignes[i] ?? '')) {
      const texte = lignes.slice(0, i).join('\n').trim();
      // Une signature sans message au-dessus n'est pas une signature.
      if (texte.length === 0) break;
      return { texte, signature: lignes.slice(i).join('\n').trim() };
    }
  }

  return { texte: corps, signature: '' };
}
