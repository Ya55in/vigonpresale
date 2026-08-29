import { LIBELLES_DOCUMENT } from '@vigon/shared';

import { createAdminClient } from '@/lib/supabase/admin';
import type { DocumentFinancier } from '@/lib/documents/requetes';

/**
 * Production du PDF d'un document financier.
 *
 * Le document existait en HTML imprimable, ce qui suffit tant qu'on l'imprime
 * soi-même. Il ne suffit plus dès qu'on l'envoie : un client ne reçoit pas une
 * page à imprimer, il reçoit un fichier qu'il classe et transmet à sa
 * comptabilité.
 *
 * MÊME BUCKET QUE LES OFFRES, `offres`, et c'est délibéré : il est déjà privé,
 * déjà créé par `init:storage`, et déjà couvert par le contrôle de
 * `essai:securite`. Un second bucket serait une surface de plus à surveiller
 * pour un gain nul — le chemin `documents/` suffit à les distinguer.
 */

/** Un an, comme les PDF d'offre : le document doit survivre à l'affaire. */
const VALIDITE_SECONDES = 60 * 60 * 24 * 365;

const BUCKET = 'offres';

export type PdfDocument = {
  buffer: Buffer;
  /** URL signée, `null` si le stockage a échoué — l'envoi reste possible. */
  url: string | null;
  nomFichier: string;
  /**
   * Chemin dans le bucket.
   *
   * Renvoyé pour que le harnais d'essai puisse effacer ce qu'il a déposé : la
   * recalculer de son côté ferait vivre la formule en deux endroits, et une
   * copie qui dérive laisse des fichiers orphelins que personne ne cherche.
   */
  chemin: string;
};

/**
 * Rend le PDF, le stocke, et renvoie de quoi le joindre à un message.
 *
 * Le tampon est rendu MÊME quand le stockage échoue : l'envoi au client est le
 * but, l'archivage est un confort. Perdre l'un parce que l'autre a échoué
 * serait le mauvais arbitrage — d'autant que `contenu_json` permet de
 * reproduire le fichier à l'identique quand on veut.
 */
export async function produirePdfDocument(
  doc: DocumentFinancier,
  tenant: string,
): Promise<PdfDocument> {
  if (!doc.contenu) {
    throw new Error(
      `Le contenu figé de ${doc.numero} est illisible : PDF non produit. ` +
        'Ne pas le réémettre sans vérifier l’original.',
    );
  }

  const [{ renderToBuffer }, { DocumentFinancierPdf }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/lib/documents/DocumentFinancierPdf'),
  ]);

  const buffer = await renderToBuffer(
    DocumentFinancierPdf({
      contenu: doc.contenu,
      libelleType: LIBELLES_DOCUMENT[doc.type],
      numero: doc.numero,
      dateEmission: doc.dateEmission,
      dateEcheance: doc.dateEcheance,
    }),
  );

  const nomFichier = `${doc.numero}.pdf`;
  const db = createAdminClient();

  // `upsert` : le contenu étant figé, un même document rend toujours le même
  // fichier. Horodater le chemin comme le fait l'offre empilerait des copies
  // identiques — l'offre, elle, se régénère après retouche, pas la facture.
  const chemin = `${tenant}/documents/${doc.id}/${nomFichier}`;

  const { error } = await db.storage
    .from(BUCKET)
    .upload(chemin, buffer, { contentType: 'application/pdf', upsert: true });

  if (error) {
    console.error(`[document] stockage du PDF impossible : ${error.message}`);
    return { buffer, url: null, nomFichier, chemin };
  }

  const { data } = await db.storage.from(BUCKET).createSignedUrl(chemin, VALIDITE_SECONDES);
  const url = data?.signedUrl ?? null;

  if (url) {
    // Le PDF est déposé ; seule son adresse resterait inconnue de la base. Le
    // taire ferait croire à un document sans PDF alors que le fichier existe,
    // et la prochaine émission le réécrirait au même chemin sans que personne
    // ne comprenne pourquoi le lien n'apparaît jamais.
    const { error: majUrl } = await db
      .from('documents_financiers')
      .update({ pdf_url: url })
      .eq('id', doc.id)
      .eq('tenant_id', tenant);

    if (majUrl) {
      console.error(
        `[document] ${doc.numero} : PDF déposé mais adresse non enregistrée — ${majUrl.message}`,
      );
    }
  }

  return { buffer, url, nomFichier, chemin };
}
