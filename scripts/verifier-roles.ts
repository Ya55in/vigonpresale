/**
 * Vérifie le périmètre de chaque rôle : entrées de navigation visibles et
 * accès autorisé/refusé sur chaque section protégée.
 *
 * Exerce les modules réels (permissions + navigation), donc reflète exactement
 * ce que les gardes serveur appliqueront.
 *
 * Usage : npm run verifier:roles
 */
import { navigationPourRole } from '../apps/web/lib/auth/navigation.js';
import { roleHasPermission, type RoleApp } from '../apps/web/lib/auth/permissions.js';

/** Permission exigée par chaque page protégée (miroir des gardes serveur). */
const GARDES: { route: string; permission: string }[] = [
  { route: '/demandes', permission: 'demande.voir' },
  { route: '/opportunites', permission: 'opportunite.voir' },
  { route: '/clients', permission: 'client.voir' },
  { route: '/fournisseurs', permission: 'fournisseur.voir' },
  { route: '/offres', permission: 'offre.voir' },
  { route: '/finance', permission: 'dashboard.finance' },
  { route: '/apres-vente', permission: 'dashboard.apres_vente' },
];

const ROLES: RoleApp[] = ['admin', 'presale', 'finance', 'after_sales'];

let echecs = 0;

for (const role of ROLES) {
  const nav = navigationPourRole(role)
    .map((e) => e.href)
    .sort();

  const autorisees = GARDES.filter((g) => roleHasPermission(role, g.permission))
    .map((g) => g.route)
    .sort();

  const refusees = GARDES.filter((g) => !roleHasPermission(role, g.permission))
    .map((g) => g.route)
    .sort();

  console.log(`\n=== ${role} ===`);
  console.log(`  navigation : ${nav.join(', ')}`);
  console.log(`  autorisé   : ${autorisees.join(', ') || '(aucun)'}`);
  console.log(`  refusé     : ${refusees.join(', ') || '(aucun)'}`);
  console.log(`  admin      : ${role === 'admin' ? 'oui' : 'non (403)'}`);

  // La sidebar et les gardes doivent coïncider dans les DEUX sens :
  // une entrée visible mais refusée casse la navigation ; une entrée masquée
  // mais autorisée laisse la section joignable par URL directe.
  for (const garde of GARDES) {
    const visible = nav.includes(garde.route);
    const autorise = roleHasPermission(role, garde.permission);

    if (visible && !autorise) {
      console.error(`  ✗ ${role} voit ${garde.route} mais la garde le refuserait`);
      echecs += 1;
    }
    if (!visible && autorise) {
      console.error(
        `  ✗ ${role} ne voit pas ${garde.route} mais y accéderait par URL directe`,
      );
      echecs += 1;
    }
  }
}

// Contrôles ciblés issus de la spec.
const ATTENDUS: { role: RoleApp; permission: string; attendu: boolean }[] = [
  { role: 'after_sales', permission: 'prix_achat.voir', attendu: false },
  { role: 'after_sales', permission: 'demande.voir', attendu: false },
  { role: 'finance', permission: 'costing.reviser', attendu: true },
  { role: 'finance', permission: 'consultation.envoyer', attendu: false },
  { role: 'presale', permission: 'prix_achat.voir', attendu: true },
  { role: 'presale', permission: 'rapport.financier', attendu: false },
  { role: 'admin', permission: 'rapport.financier', attendu: true },
];

console.log('\n=== contrôles spec ===');
for (const { role, permission, attendu } of ATTENDUS) {
  const obtenu = roleHasPermission(role, permission);
  const ok = obtenu === attendu;
  if (!ok) echecs += 1;
  console.log(
    `  ${ok ? '✓' : '✗'} ${role} · ${permission} → ${obtenu} (attendu ${attendu})`,
  );
}

console.log(
  echecs === 0
    ? '\n✓ Périmètres cohérents : navigation et gardes concordent.'
    : `\n✗ ${echecs} incohérence(s).`,
);

process.exit(echecs === 0 ? 0 : 1);
