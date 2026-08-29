/**
 * Courriel d'invitation à rejoindre la plateforme.
 *
 * Construit en TypeScript déterministe, comme les RFQ et l'envoi d'offre :
 * l'IA ne produit jamais de HTML.
 *
 * Le lien porte un jeton à usage unique émis par Supabase. Il ouvre une session
 * puis conduit à l'écran de choix du mot de passe — aucun mot de passe ne
 * transite donc par ce message, ni n'est connu de l'administrateur.
 */

import { echapperHtml as echapper } from '@vigon/shared';

export const LIBELLE_ROLE_INVITATION: Record<string, string> = {
  admin: 'Administrateur',
  presale: 'Avant-vente',
  finance: 'Finance',
  after_sales: 'Après-vente',
};

export type ParamsInvitation = {
  prenom: string | null;
  role: string;
  lien: string;
  invitePar: string;
};

export function buildInvitationHtml(params: ParamsInvitation): string {
  const salutation = params.prenom ? `Bonjour ${echapper(params.prenom)},` : 'Bonjour,';
  const role = LIBELLE_ROLE_INVITATION[params.role] ?? params.role;

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e4e6ea;border-radius:8px">
        <tr><td style="padding:28px 32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2328">

          <p style="margin:0 0 16px">${salutation}</p>

          <p style="margin:0 0 16px">
            ${echapper(params.invitePar)} vous a ouvert un accès à la plateforme
            avant-vente <strong>Vigon Systems</strong>, avec le profil
            <strong>${echapper(role)}</strong>.
          </p>

          <p style="margin:0 0 24px">
            Choisissez votre mot de passe pour activer votre accès :
          </p>

          <p style="margin:0 0 24px">
            <a href="${params.lien}"
               style="display:inline-block;background:#1f2328;color:#ffffff;text-decoration:none;
                      padding:12px 22px;border-radius:6px;font-weight:600">
              Définir mon mot de passe
            </a>
          </p>

          <p style="margin:0 0 16px;color:#5a626d;font-size:13px">
            Ce lien est à usage unique et expire sous 24 heures. Passé ce délai,
            demandez une nouvelle invitation.
          </p>

          <p style="margin:0;color:#5a626d;font-size:13px">
            Si vous n'attendiez pas ce message, ignorez-le : aucun accès n'est
            activé tant que le mot de passe n'est pas défini.
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildInvitationTexte(params: ParamsInvitation): string {
  const role = LIBELLE_ROLE_INVITATION[params.role] ?? params.role;

  return [
    params.prenom ? `Bonjour ${params.prenom},` : 'Bonjour,',
    '',
    `${params.invitePar} vous a ouvert un accès à la plateforme avant-vente`,
    `Vigon Systems, avec le profil ${role}.`,
    '',
    'Choisissez votre mot de passe pour activer votre accès :',
    params.lien,
    '',
    'Ce lien est à usage unique et expire sous 24 heures.',
    "Si vous n'attendiez pas ce message, ignorez-le.",
  ].join('\n');
}
