/**
 * Courriel d'envoi de l'offre au client.
 *
 * Construit en TypeScript déterministe, comme les RFQ : l'IA ne produit jamais
 * de HTML. Ce message porte le lien public, donc rien d'interne n'y figure.
 */

import { echapperHtml as echapper } from '@vigon/shared';

export type ParamsEmailOffre = {
  clientNom: string;
  titreOffre: string;
  reference: string;
  lienPublic: string;
  validiteJours: number;
  totalTtc: string;
};

export function buildEmailOffreHtml(params: ParamsEmailOffre): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e4e6ea;border-radius:8px">
        <tr><td style="padding:28px 32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2328">

          <p style="margin:0 0 16px">Bonjour,</p>

          <p style="margin:0 0 16px">
            Nous avons le plaisir de vous transmettre notre proposition
            <strong>${echapper(params.titreOffre)}</strong>, référence
            ${echapper(params.reference)}.
          </p>

          <p style="margin:0 0 24px">
            Montant total TTC : <strong>${echapper(params.totalTtc)}</strong>.
            Cette offre est valable ${params.validiteJours} jours.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
            <tr><td style="background:#0f4c81;border-radius:6px">
              <a href="${echapper(params.lienPublic)}"
                 style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">
                Consulter l'offre
              </a>
            </td></tr>
          </table>

          <p style="margin:0 0 24px;color:#6b7280;font-size:13px">
            Depuis cette page, vous pourrez approuver l'offre ou nous demander
            une modification.
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
