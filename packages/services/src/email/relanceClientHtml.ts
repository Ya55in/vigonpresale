/**
 * Relance adressée au client dont l'offre approche de son échéance.
 *
 * Construit en TypeScript déterministe, comme les RFQ et l'envoi d'offre :
 * aucun HTML ne vient du modèle. Ce message porte le lien public, donc rien
 * d'interne — ni marge, ni prix d'achat, ni nom de fournisseur — n'y figure.
 *
 * Le ton reste factuel. Une relance commerciale insistante sur une offre qui
 * expire se retourne contre l'émetteur : on rappelle l'échéance et on laisse
 * la porte ouverte à une prolongation, ce qui vaut mieux que perdre l'affaire
 * sur une date.
 */

import { echapperHtml as echapper } from '@vigon/shared';

export type ParamsRelanceClient = {
  titreOffre: string;
  reference: string;
  lienPublic: string;
  /** Jours restants avant échéance ; 0 ou moins = dernier jour. */
  joursRestants: number;
  dateExpiration: string;
  /** Vrai si le client n'a jamais ouvert le lien : le message le rappelle autrement. */
  jamaisConsultee: boolean;
};

/** Objet du courriel — porte l'échéance, c'est ce qui décide de l'ouverture. */
export function sujetRelanceClient(params: {
  reference: string;
  joursRestants: number;
}): string {
  if (params.joursRestants <= 0) {
    return `Dernier jour — offre ${params.reference}`;
  }
  if (params.joursRestants === 1) {
    return `Votre offre ${params.reference} expire demain`;
  }
  return `Votre offre ${params.reference} expire dans ${params.joursRestants} jours`;
}

export function buildRelanceClientHtml(params: ParamsRelanceClient): string {
  const echeance =
    params.joursRestants <= 0
      ? "Elle arrive à échéance aujourd'hui"
      : params.joursRestants === 1
        ? 'Elle arrive à échéance demain'
        : `Elle arrive à échéance dans ${params.joursRestants} jours`;

  // Un client qui n'a jamais ouvert le lien n'a pas « pris le temps d'étudier »
  // l'offre : le lui écrire sonnerait faux et trahirait le suivi d'ouverture.
  const accroche = params.jamaisConsultee
    ? `Nous vous avons transmis notre proposition <strong>${echapper(params.titreOffre)}</strong>, référence ${echapper(params.reference)}, et souhaitions nous assurer qu'elle vous est bien parvenue.`
    : `Nous revenons vers vous au sujet de notre proposition <strong>${echapper(params.titreOffre)}</strong>, référence ${echapper(params.reference)}.`;

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f6f8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e4e6ea;border-radius:8px">
        <tr><td style="padding:28px 32px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2328">

          <p style="margin:0 0 16px">Bonjour,</p>

          <p style="margin:0 0 16px">${accroche}</p>

          <p style="margin:0 0 24px">
            ${echeance}, le <strong>${echapper(params.dateExpiration)}</strong>.
            Passé cette date, les prix et disponibilités devront être revus
            auprès de nos partenaires.
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
            Si vous avez besoin de temps supplémentaire ou d'ajustements,
            répondez simplement à ce message : nous étudierons une prolongation.
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
