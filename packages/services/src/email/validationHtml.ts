/**
 * Demande d'approbation adressée à l'administrateur, avant génération d'offre.
 *
 * Le message porte les montants soumis et un lien de consultation : la spec
 * demande de « consulter l'ensemble des détails soumis à validation », pas de
 * décider sur un chiffre isolé dans une notification.
 *
 * Le canal est interchangeable — ce gabarit sert le courriel, un message
 * WhatsApp reprendra les mêmes données le jour où le compte Business existera.
 * C'est pourquoi la mise en forme reste sobre : elle doit survivre à un support
 * qui ne connaît pas le HTML.
 */

import { echapperHtml as echapper } from '@vigon/shared';

export type ParamsValidation = {
  demandeCode: string | null;
  clientNom: string | null;
  objet: string | null;
  totalHt: string;
  totalTtc: string;
  margePct: number | null;
  lienValidation: string;
  expireLe: string;
  demandePar: string | null;
};

export function sujetValidation(params: { demandeCode: string | null; totalTtc: string }): string {
  return params.demandeCode
    ? `Validation requise — ${params.demandeCode} (${params.totalTtc})`
    : `Validation requise — ${params.totalTtc}`;
}

/**
 * Version texte, pour un canal sans HTML.
 *
 * Écrite d'abord et non dérivée du HTML : c'est elle que reprendra WhatsApp, et
 * une conversion automatique produirait des sauts de ligne aléatoires sur le
 * seul message qui engage une signature.
 */
export function texteValidation(params: ParamsValidation): string {
  const lignes = [
    'Validation requise avant génération de l’offre.',
    '',
    params.demandeCode ? `Affaire : ${params.demandeCode}` : null,
    params.clientNom ? `Client : ${params.clientNom}` : null,
    params.objet ? `Objet : ${params.objet}` : null,
    '',
    `Montant HT : ${params.totalHt}`,
    `Montant TTC : ${params.totalTtc}`,
    params.margePct !== null ? `Marge : ${params.margePct.toFixed(1)} %` : null,
    '',
    'Consulter le détail et décider :',
    params.lienValidation,
    '',
    `Sans réponse, la demande devient caduque le ${params.expireLe}.`,
    'L’offre ne sera pas générée tant que la décision n’est pas prise.',
  ];

  return lignes.filter((l) => l !== null).join('\n');
}

export function buildValidationHtml(params: ParamsValidation): string {
  const ligne = (libelle: string, valeur: string): string =>
    `<tr>
       <td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px">${echapper(libelle)}</td>
       <td style="padding:4px 0;font-size:14px"><strong>${echapper(valeur)}</strong></td>
     </tr>`;

  const details = [
    params.demandeCode ? ligne('Affaire', params.demandeCode) : '',
    params.clientNom ? ligne('Client', params.clientNom) : '',
    params.objet ? ligne('Objet', params.objet) : '',
    ligne('Montant HT', params.totalHt),
    ligne('Montant TTC', params.totalTtc),
    params.margePct !== null ? ligne('Marge', `${params.margePct.toFixed(1)} %`) : '',
  ].join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e4e6ea;border-radius:8px">
        <tr><td style="padding:28px 32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2328">

          <p style="margin:0 0 4px;font-size:17px;font-weight:600">Validation requise</p>
          <p style="margin:0 0 20px;color:#6b7280;font-size:14px">
            Avant génération de l’offre client${
              params.demandePar ? ` — demandée par ${echapper(params.demandePar)}` : ''
            }.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
            ${details}
          </table>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px">
            <tr><td style="background:#0f4c81;border-radius:6px">
              <a href="${echapper(params.lienValidation)}"
                 style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">
                Consulter le détail et décider
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 24px;color:#6b7280;font-size:13px">
            L’offre ne sera pas générée tant que la décision n’est pas prise.
            Sans réponse, la demande devient caduque le ${echapper(params.expireLe)}.
          </p>

          <hr style="border:none;border-top:1px solid #e4e6ea;margin:0 0 16px">
          <p style="margin:0;color:#6b7280;font-size:13px">
            Vigon Systems — Service Avant-vente
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
