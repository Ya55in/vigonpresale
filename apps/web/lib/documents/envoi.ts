import { echapperHtml as echapper } from '@vigon/shared';

/**
 * Courriel d'accompagnement d'un document financier.
 *
 * Construit en TypeScript déterministe, comme le message d'offre et les RFQ :
 * l'IA ne produit jamais de HTML.
 *
 * VOLONTAIREMENT SOBRE. Ce message ne vend rien — la vente a eu lieu, l'offre
 * est approuvée. Il accompagne une pièce comptable, et tout ce qui l'encombre
 * éloigne du seul fait utile : le document est en pièce jointe, voici son
 * numéro et son montant.
 */

export type ParamsEmailDocument = {
  libelleType: string;
  numero: string;
  clientNom: string;
  objet: string | null;
  totalTtc: string;
  /** Formatée pour l'affichage, `null` quand le document ne s'encaisse pas. */
  dateEcheance: string | null;
  nomFichier: string;
};

export function sujetEmailDocument(params: {
  libelleType: string;
  numero: string;
  objet: string | null;
}): string {
  // La référence d'affaire dans le sujet : c'est ce que le client cherche quand
  // il retrouve le message six mois plus tard.
  return params.objet
    ? `${params.libelleType} ${params.numero} — ${params.objet}`
    : `${params.libelleType} ${params.numero}`;
}

export function buildEmailDocumentHtml(params: ParamsEmailDocument): string {
  const libelle = echapper(params.libelleType);

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
            Vous trouverez ci-joint ${libelle.toLowerCase().startsWith('facture') ? 'la' : 'le'}
            <strong>${libelle} ${echapper(params.numero)}</strong>${
              params.objet ? `, relative à ${echapper(params.objet)}` : ''
            }.
          </p>

          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border:1px solid #e4e6ea;border-radius:6px">
            <tr>
              <td style="padding:12px 16px;font-size:14px;color:#6b7280">Montant TTC</td>
              <td style="padding:12px 16px;font-size:15px;font-weight:600;text-align:right">${echapper(params.totalTtc)}</td>
            </tr>
            ${
              params.dateEcheance
                ? `<tr>
              <td style="padding:12px 16px;border-top:1px solid #e4e6ea;font-size:14px;color:#6b7280">Échéance</td>
              <td style="padding:12px 16px;border-top:1px solid #e4e6ea;font-size:15px;text-align:right">${echapper(params.dateEcheance)}</td>
            </tr>`
                : ''
            }
          </table>

          <p style="margin:0 0 24px;color:#6b7280;font-size:13px">
            Pièce jointe : ${echapper(params.nomFichier)}. Nous restons à votre
            disposition pour toute précision.
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
