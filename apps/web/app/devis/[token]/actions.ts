'use server';

import { revalidatePath } from 'next/cache';

import { reponseFournisseurSchema, validerReponse } from '@vigon/shared';

import { lireConsultationPublique } from '@/lib/consultations/public';
import { deposerFichier } from '@/lib/fichiers/depot';
import { createAdminClient } from '@/lib/supabase/admin';

export type ResultatDevis =
  | { ok: true; message: string }
  | { ok: false; message: string };

/**
 * Réponse du fournisseur, saisie depuis le formulaire en ligne.
 *
 * Le jeton EST l'autorisation, comme sur la page offre : il est long, aléatoire
 * et ne circule que dans la demande de devis envoyée à ce fournisseur. Aucun
 * identifiant interne n'est accepté du formulaire — la consultation, le tenant
 * et la demande sont tous retrouvés depuis le jeton, pour qu'un paramètre forgé
 * ne puisse pas viser une autre consultation.
 *
 * Ce chemin ne passe pas par l'extraction : les données arrivent structurées,
 * donc rien à deviner. C'est tout l'intérêt — un prix mal extrait se propageait
 * jusqu'au costing sans que personne ne le voie.
 */
export async function enregistrerReponseFournisseur(
  token: string,
  _etat: ResultatDevis | null,
  donnees: FormData,
): Promise<ResultatDevis> {
  const consultation = await lireConsultationPublique(token);

  if (!consultation || consultation.pasEncoreEnvoyee) {
    return { ok: false, message: 'Ce lien n’est pas valide.' };
  }

  if (consultation.dejaRepondu) {
    return {
      ok: false,
      message: 'Une réponse a déjà été enregistrée pour cette demande.',
    };
  }

  let lignesBrutes: unknown = [];
  try {
    const brut = donnees.get('lignes');
    lignesBrutes = JSON.parse(typeof brut === 'string' ? brut : '[]');
  } catch {
    return { ok: false, message: 'Formulaire illisible : rechargez la page.' };
  }

  const parse = reponseFournisseurSchema.safeParse({
    lignes: lignesBrutes,
    delaiLivraison: donnees.get('delaiLivraison') ?? '',
    conditionsPaiement: donnees.get('conditionsPaiement') ?? '',
    garantie: donnees.get('garantie') ?? '',
    validiteOffre: donnees.get('validiteOffre') ?? '',
    numeroDevis: donnees.get('numeroDevis') ?? '',
  });

  if (!parse.success) {
    const premier = parse.error.issues[0];
    return {
      ok: false,
      message: premier ? premier.message : 'Saisie invalide.',
    };
  }

  const motif = validerReponse(parse.data);
  if (motif) return { ok: false, message: motif };

  // Les articles autorisés viennent de la base, pas du formulaire : une ligne
  // visant un article d'une autre consultation est écartée en silence.
  const autorises = new Set(consultation.articles.map((a) => a.demandeItemId));
  const retenues = parse.data.lignes.filter(
    (l) => l.chiffree && autorises.has(l.demandeItemId),
  );

  if (retenues.length === 0) {
    return { ok: false, message: 'Aucune ligne exploitable dans votre réponse.' };
  }

  const db = createAdminClient();

  const { data: devis, error: erreurDevis } = await db
    .from('devis_fournisseur')
    .insert({
      tenant_id: consultation.tenantId,
      consultation_id: consultation.id,
      demande_id: consultation.demandeId,
      numero_devis: parse.data.numeroDevis,
      date_devis: new Date().toISOString().slice(0, 10),
      devise: 'MAD',
      validite_offre: parse.data.validiteOffre,
      delai_livraison: parse.data.delaiLivraison,
      conditions_paiement: parse.data.conditionsPaiement,
      garantie: parse.data.garantie,
      source: 'formulaire',
      statut_extraction: 'ok',
      // Saisi par le fournisseur lui-même : rien n'a été deviné, donc aucune
      // ligne à relire pour cause de doute d'extraction.
      confiance_globale: 1,
    })
    .select('id')
    .single();

  if (erreurDevis || !devis) {
    console.error('[devis formulaire] création impossible', erreurDevis?.message);
    return {
      ok: false,
      message: 'Enregistrement impossible. Réessayez ou répondez par courriel.',
    };
  }

  const parArticle = new Map(consultation.articles.map((a) => [a.demandeItemId, a]));

  const { error: erreurLignes } = await db.from('lignes_devis').insert(
    retenues.map((ligne) => {
      const article = parArticle.get(ligne.demandeItemId)!;
      return {
        devis_id: devis.id,
        demande_item_id: ligne.demandeItemId,
        designation_fournisseur: article.designation,
        reference: article.reference,
        fabricant: article.marque,
        quantite: article.quantite,
        unite: article.unite,
        prix_achat_ht: ligne.prixUnitaireHt!,
        remise_pct: ligne.remisePct,
        disponibilite: ligne.disponibilite,
        mapping_type: 'exact',
        confiance_ia: 1,
      };
    }),
  );

  if (erreurLignes) {
    // Le devis sans ses lignes serait un devis vide qui bloque toute nouvelle
    // réponse : on le retire pour que le fournisseur puisse recommencer.
    await db.from('devis_fournisseur').delete().eq('id', devis.id);
    console.error('[devis formulaire] lignes impossibles', erreurLignes.message);
    return {
      ok: false,
      message: 'Enregistrement impossible. Réessayez ou répondez par courriel.',
    };
  }

  // Document joint, si le fournisseur en a déposé un. Volontairement APRÈS
  // l'enregistrement des lignes et sans pouvoir le faire échouer : un devis
  // saisi ne doit pas être perdu parce que sa pièce jointe a été refusée. Le
  // motif du refus est remonté dans le message de retour.
  let avertissementDocument: string | null = null;

  const document = donnees.get('document');

  if (document instanceof File && document.size > 0) {
    const depot = await deposerFichier({
      fichier: document,
      tenant: consultation.tenantId,
      dossier: `devis/${devis.id}`,
      rattachement: { devisId: devis.id },
      contexte: 'devis formulaire',
    });

    if (!depot.ok) avertissementDocument = depot.motif ?? 'Document non enregistré.';
  }

  // Le fournisseur a rempli le formulaire et s'en va. Si la consultation reste
  // « envoyee », le job de relance le rappellera pour un devis qu'il a déjà
  // remis — et le devis, lui, n'apparaîtra dans aucune liste d'attente.
  const { error: erreurStatut } = await db
    .from('consultations')
    .update({ statut: 'devis_recu', date_reponse: new Date().toISOString() })
    .eq('id', consultation.id);

  if (erreurStatut) {
    console.error(
      `[devis formulaire] devis ${devis.id} enregistré mais consultation ${consultation.id} non close : ${erreurStatut.message}`,
    );
  }

  await db.from('notifications').insert({
    tenant_id: consultation.tenantId,
    role_cible: 'presale',
    type: 'devis_recu',
    severite: 'info',
    titre: `Devis saisi en ligne — ${consultation.fournisseurNom ?? 'fournisseur'}`,
    message:
      `${retenues.length} ligne(s) chiffrée(s) via le formulaire, sans extraction à relire.` +
      (document instanceof File && document.size > 0 && !avertissementDocument
        ? ` Document joint : ${document.name}.`
        : ''),
    lien: `/demandes/${consultation.demandeId}/costing`,
    demande_id: consultation.demandeId,
  });

  await db.from('audit_events').insert({
    tenant_id: consultation.tenantId,
    entite: 'devis_fournisseur',
    entite_id: devis.id,
    action: 'devis.saisi_formulaire',
    acteur_type: 'fournisseur',
    details: {
      consultation_id: consultation.id,
      lignes: retenues.length,
      articles_proposes: consultation.articles.length,
    },
  });

  // Vectorisation en marge du flux : ce que ce fournisseur vient de chiffrer
  // enrichit la recherche sémantique des prochaines demandes. L'échec est
  // avalé volontairement — le devis est enregistré, c'est ce qui compte, et un
  // rattrapage rejouable existe.
  try {
    const { indexerDevis } = await import('@vigon/services');
    await indexerDevis(consultation.tenantId, [devis.id]);
  } catch (e) {
    console.error(
      `[devis formulaire] indexation ignorée : ${e instanceof Error ? e.message : e}`,
    );
  }

  revalidatePath(`/devis/${token}`);

  return {
    ok: true,
    // Le refus du document est dit, sans laisser croire que la réponse a
    // échoué : les prix sont enregistrés, c'est le document qui manque.
    message: avertissementDocument
      ? `Votre offre est enregistrée. En revanche, le document n'a pas pu être joint : ${avertissementDocument}`
      : 'Merci, votre offre est enregistrée. Nos équipes reviendront vers vous.',
  };
}
