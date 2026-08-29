import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Charge apps/web/.env.local dans process.env pour les scripts et le worker.
 *
 * Les valeurs contenant des espaces (mot de passe d'application Gmail) doivent
 * être entourées de guillemets pour rester lisibles par un `source` shell : on
 * les retire ici, sinon ils partiraient dans la valeur.
 *
 * Une variable déjà définie dans l'environnement n'est jamais écrasée.
 */
export function chargerEnv(chemin = resolve(ROOT, 'apps/web/.env.local')): void {
  if (!existsSync(chemin)) return;

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
