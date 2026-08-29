import { boqVersMarkdown, type Boq } from '@vigon/services';

import { createAdminClient } from '@/lib/supabase/admin';

export type ResultatDocument = {
  gammaDocId: string | null;
  gammaUrl: string | null;
  pdfUrl: string | null;
  repliLocal: boolean;
  motifRepli: string | null;
};

/**
 * Produit le document de l'offre : Gamma si la clé est présente, PDF local sinon.
 *
 * Partagé entre la génération initiale (étape 9c) et la régénération après
 * relecture (étape 10) : une seule implémentation, donc un seul comportement de
 * repli à raisonner.
 */
export async function produireDocument(
  boq: Boq,
  tenant: string,
  offreId: number,
): Promise<ResultatDocument> {
  const { gammaConfigure, genererOffre } = await import('@vigon/services');

  let gammaDocId: string | null = null;
  let gammaUrl: string | null = null;
  let pdfUrl: string | null = null;
  let repliLocal = false;
  let motifRepli: string | null = null;

  if (gammaConfigure()) {
    try {
      const resultat = await genererOffre(boqVersMarkdown(boq));
      gammaDocId = resultat.generationId;
      gammaUrl = resultat.gammaUrl;
      pdfUrl = resultat.pdfUrl;
    } catch (e) {
      repliLocal = true;
      motifRepli = `Gamma indisponible : ${e instanceof Error ? e.message : String(e)}`;
      console.error(`[offre] ${motifRepli}`);
    }
  } else {
    repliLocal = true;
    motifRepli = 'GAMMA_API_KEY absente — document produit localement.';
  }

  if (repliLocal) {
    pdfUrl = await produirePdfLocal(boq, tenant, offreId);
  }

  return { gammaDocId, gammaUrl, pdfUrl, repliLocal, motifRepli };
}

/**
 * Reconstruit le document depuis le BoQ déjà stocké, sans repasser par l'IA.
 *
 * Utilisé après une retouche humaine : redemander les textes au modèle
 * écraserait précisément ce qui vient d'être relu.
 */
export async function reconstruireDocument(params: {
  offreId: number;
  tenant: string;
}): Promise<ResultatDocument> {
  const db = createAdminClient();

  const { data: offre } = await db
    .from('offres')
    .select('source_json')
    .eq('id', params.offreId)
    .eq('tenant_id', params.tenant)
    .single();

  if (!offre?.source_json) {
    throw new Error("Cette offre n'a pas de contenu à reconstruire.");
  }

  const boq = offre.source_json as unknown as Boq;
  const resultat = await produireDocument(boq, params.tenant, params.offreId);

  await db
    .from('offres')
    .update({
      gamma_doc_id: resultat.gammaDocId,
      gamma_url: resultat.gammaUrl,
      pdf_url: resultat.pdfUrl,
      date_generation: new Date().toISOString(),
    })
    .eq('id', params.offreId);

  return resultat;
}

/**
 * Rend le BoQ en PDF et le stocke.
 *
 * Import différé : @react-pdf/renderer est lourd et n'a aucune raison d'être
 * chargé quand Gamma répond.
 */
export async function produirePdfLocal(
  boq: Boq,
  tenant: string,
  offreId: number,
): Promise<string | null> {
  const [{ renderToBuffer }, { DocumentOffre }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/lib/offres/DocumentOffre'),
  ]);

  const buffer = await renderToBuffer(DocumentOffre({ boq }));

  // Horodaté : une régénération ne doit pas remplacer le document déjà relu,
  // et l'URL signée précédente reste valide le temps de sa durée de vie.
  const chemin = `${tenant}/${offreId}/${boq.referenceOffre}-${Date.now()}.pdf`;

  const db = createAdminClient();
  const { error } = await db.storage
    .from('offres')
    .upload(chemin, buffer, { contentType: 'application/pdf', upsert: true });

  if (error) {
    console.error(`[offre] stockage du PDF impossible : ${error.message}`);
    return null;
  }

  const { data } = await db.storage
    .from('offres')
    .createSignedUrl(chemin, 60 * 60 * 24 * 365);

  return data?.signedUrl ?? null;
}
