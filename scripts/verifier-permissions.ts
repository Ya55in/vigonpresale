/**
 * Vérifie la matrice des permissions par rôle.
 *
 * Sert de garde-fou : une entrée retirée par erreur de PERMISSIONS ouvrirait
 * silencieusement un écran ou une action à un rôle qui ne doit pas y accéder.
 *
 * Usage : npm run verifier:permissions
 */
import { roleHasPermission, type RoleApp } from '../apps/web/lib/auth/permissions.js';

/** Attendus issus de la spec (sections 3 et 7). */
const ATTENDUS: { role: RoleApp; permission: string; autorise: boolean }[] = [
  { role: 'presale', permission: 'article.modifier', autorise: true },
  { role: 'presale', permission: 'article.valider', autorise: true },
  { role: 'presale', permission: 'demande.voir', autorise: true },

  // FINANCE ne modifie jamais les spécifications techniques.
  { role: 'finance', permission: 'article.modifier', autorise: false },
  { role: 'finance', permission: 'article.valider', autorise: false },
  { role: 'finance', permission: 'demande.voir', autorise: true },

  // AFTER_SALES ne voit que les deals gagnés et ne touche à rien.
  { role: 'after_sales', permission: 'article.modifier', autorise: false },
  { role: 'after_sales', permission: 'demande.voir', autorise: false },
  { role: 'after_sales', permission: 'demande.voir_gagnees', autorise: true },
  { role: 'after_sales', permission: 'prix_achat.voir', autorise: false },

  { role: 'admin', permission: 'article.modifier', autorise: true },
  { role: 'admin', permission: 'costing.valider', autorise: true },

  // Documents financiers : l'avant-vente émet — le bon de commande matérialise
  // l'accord d'un client qu'elle a en face d'elle — mais constater un règlement
  // engage la comptabilité et reste à FINANCE.
  { role: 'presale', permission: 'document.emettre', autorise: true },
  { role: 'presale', permission: 'document.regler', autorise: false },
  { role: 'finance', permission: 'document.emettre', autorise: true },
  { role: 'finance', permission: 'document.regler', autorise: true },
  { role: 'after_sales', permission: 'document.voir', autorise: false },
  { role: 'admin', permission: 'document.regler', autorise: true },
];

let echecs = 0;

for (const { role, permission, autorise } of ATTENDUS) {
  const obtenu = roleHasPermission(role, permission);
  const ok = obtenu === autorise;
  if (!ok) echecs += 1;
  console.log(
    `${ok ? '✓' : '✗'} ${role.padEnd(12)} ${permission.padEnd(24)} ` +
      `attendu=${autorise ? 'oui' : 'non'} obtenu=${obtenu ? 'oui' : 'non'}`,
  );
}

console.log(
  `\n${ATTENDUS.length - echecs}/${ATTENDUS.length} conformes à la spec.`,
);
if (echecs > 0) process.exit(1);
