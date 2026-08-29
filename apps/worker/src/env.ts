import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));

/**
 * Charge apps/web/.env.local dans process.env.
 *
 * Le worker et l'application partagent le même fichier : une seule source de
 * vérité pour les clés, les boîtes mail et les seuils métier.
 *
 * Les valeurs entourées de guillemets (mot de passe d'application Gmail, qui
 * contient des espaces) sont déquotées ici, sinon les guillemets partiraient
 * dans la valeur et l'authentification échouerait.
 */
export function chargerEnv(): void {
  const chemin = resolve(ICI, '../../web/.env.local');
  if (!existsSync(chemin)) {
    console.warn(`[vigon-worker] ${chemin} introuvable — variables d'environnement seules.`);
    return;
  }

  for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m?.[1]) continue;
    if (process.env[m[1]] !== undefined) continue;

    let valeur = (m[2] ?? '').trim();
    const quote = valeur[0];
    if ((quote === '"' || quote === "'") && valeur.endsWith(quote) && valeur.length > 1) {
      valeur = valeur.slice(1, -1);
    }

    process.env[m[1]] = valeur;
  }
}
