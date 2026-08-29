import { APP_NAME, echapperHtml as echapper } from '@vigon/shared';

/**
 * Courriel de réponse à un fournisseur, dans le fil de la consultation.
 *
 * Assemblé en TypeScript comme les RFQ et l'offre : le modèle ne produit jamais
 * de HTML. Le texte vient de l'avant-vente et est échappé — une réponse
 * contenant un chevron ne doit pas casser le rendu chez le destinataire.
 */

export function buildReponseHtml(params: { message: string; signature?: string }): string {
  const paragraphes = params.message
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px">${echapper(p).replace(/\n/g, '<br />')}</p>`)
    .join('\n          ');

  const signature = echapper(params.signature ?? `L'équipe avant-vente — ${APP_NAME}`);

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e4e6ea;border-radius:8px">
        <tr><td style="padding:28px 32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2328">

          ${paragraphes}

          <p style="margin:24px 0 0;color:#5a626d;font-size:13px">${signature}</p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
