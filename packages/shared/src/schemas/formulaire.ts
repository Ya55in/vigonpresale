import { z } from 'zod';

/**
 * Booléen provenant d'un `FormData`.
 *
 * `z.coerce.boolean()` applique `Boolean(valeur)` : toute chaîne non vide est
 * vraie, donc `"false"` vaut `true`. Un formulaire qui envoie `actif=false`
 * était ainsi interprété comme `actif=true` — la désactivation d'un compte ou
 * d'un fournisseur ne produisait aucun effet, sans la moindre erreur.
 *
 * On lit donc explicitement les représentations qu'un formulaire HTML peut
 * produire. Une valeur absente vaut `false` si aucun défaut n'est fourni : une
 * case décochée n'est tout simplement pas transmise.
 *
 * @example
 * const schema = z.object({ actif: booleenFormulaire() });
 * const avecDefaut = z.object({ envoyer: booleenFormulaire(true) });
 */
export function booleenFormulaire(defaut = false) {
  return z
    .union([z.string(), z.boolean(), z.undefined(), z.null()])
    .transform((valeur) => {
      if (valeur === undefined || valeur === null || valeur === '') return defaut;
      if (typeof valeur === 'boolean') return valeur;

      const normalisee = valeur.trim().toLowerCase();

      // `on` est ce qu'une case à cocher HTML envoie sans attribut `value`.
      if (['true', '1', 'on', 'oui', 'yes'].includes(normalisee)) return true;
      if (['false', '0', 'off', 'non', 'no'].includes(normalisee)) return false;

      return defaut;
    });
}
