import { randomBytes } from 'node:crypto';

import { rfqSchema, urlApplication } from '@vigon/shared';

import { genererJson } from '../ai/index.js';
import { promptRfq } from '../ai/prompts.js';
import { buildRfqHtml, buildRfqTexte } from '../email/rfqHtml.js';
import { clientAdmin } from '../supabase.js';
import { langueEffective, lireLanguesChoisies } from './langues.js';
import { resoudreFournisseurs, normaliserMarque } from './sourcing.js';

export type ArticleDemande = {
  /** Identifiant de `demande_items` : sert à rattacher la consultation. */
  id: number;
  designation: string;
  reference: string | null;
  marque: string | null;
  quantite: number;
};

export type ResultatGeneration = {
  creees: number;
  ignorees: number;
  nonResolues: { marque: string; motif: string }[];
  erreurs: { marque: string; motif: string }[];
};

/** Regroupe les articles par marque normalisée, en gardant le libellé d'origine. */
function grouperParMarque(
  articles: ArticleDemande[],
): Map<string, { libelle: string; articles: ArticleDemande[] }> {
  const groupes = new Map<string, { libelle: string; articles: ArticleDemande[] }>();

  for (const article of articles) {
    const marque = article.marque?.trim() || 'Non specifie';
    const cle = normaliserMarque(marque);

    const groupe = groupes.get(cle);
    if (groupe) groupe.articles.push(article);
    else groupes.set(cle, { libelle: marque, articles: [article] });
  }

  return groupes;
}

/**
 * Prépare une consultation par fournisseur identifié.
 *
 * Idempotent par (demande_id, fournisseur_id) : relancer la génération après
 * l'ajout manuel d'un fournisseur complète les consultations sans dupliquer
 * celles déjà préparées ni écraser une rédaction retouchée à la main.
 */
export async function genererConsultations(params: {
  demandeId: number;
  tenant: string;
  articles: ArticleDemande[];
  signature?: string;
  /**
   * Restreint la génération à ces fiches fournisseur.
   *
   * Renseigné quand l'avant-vente a choisi elle-même qui consulter, depuis la
   * proposition sémantique. Absent, le comportement est inchangé : on résout
   * par marque et on consulte tout ce qui est trouvé.
   *
   * Le filtre s'applique APRÈS la résolution, et non à sa place : le sourcing
   * reste la seule voie qui sache créer une fiche pour une marque inconnue, et
   * les marques non résolues doivent continuer d'être signalées.
   */
  fournisseursRetenus?: number[];
}): Promise<ResultatGeneration> {
  const { demandeId, tenant, articles, signature } = params;
  const db = clientAdmin();

  const groupes = grouperParMarque(articles);
  const { resolus: tousResolus, nonResolues } = await resoudreFournisseurs(
    tenant,
    [...groupes.values()].map((g) => g.libelle),
  );

  const retenus = params.fournisseursRetenus;
  const resolus =
    retenus && retenus.length > 0
      ? tousResolus.filter((f) => retenus.includes(f.id))
      : tousResolus;

  // Lues une fois pour tout le lot : la boucle traite plusieurs fournisseurs.
  const languesChoisies = await lireLanguesChoisies(tenant);

  const resultat: ResultatGeneration = {
    creees: 0,
    ignorees: 0,
    nonResolues,
    erreurs: [],
  };

  for (const fournisseur of resolus) {
    const groupe = groupes.get(normaliserMarque(fournisseur.marque));
    if (!groupe || groupe.articles.length === 0) continue;

    const { data: deja } = await db
      .from('consultations')
      .select('id')
      .eq('demande_id', demandeId)
      .eq('fournisseur_id', fournisseur.id)
      .maybeSingle();

    if (deja) {
      resultat.ignorees += 1;
      continue;
    }

    const langue = langueEffective(fournisseur, languesChoisies);

    let rfq;
    try {
      rfq = await genererJson(
        await promptRfq(tenant, {
          marque: groupe.libelle,
          nomFournisseur: fournisseur.nom,
          langue,
          articles: groupe.articles.map((a) => ({
            designation: a.designation,
            reference: a.reference,
            quantite: a.quantite,
          })),
        }),
        rfqSchema,
        { tentatives: 3, contexte: { demandeId, marque: groupe.libelle, langue } },
      );
    } catch (e) {
      resultat.erreurs.push({
        marque: groupe.libelle,
        motif: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    // Même construction que le jeton d'offre : 192 bits, donc hors de portée
    // d'une énumération. C'est la seule autorisation du formulaire.
    const token = randomBytes(24).toString('base64url');
    const appUrl = urlApplication();

    const { data: creee, error } = await db.from('consultations').insert({
      tenant_id: tenant,
      demande_id: demandeId,
      fournisseur_id: fournisseur.id,
      fournisseur_nom: fournisseur.nom,
      fournisseur_email: fournisseur.email,
      marque: groupe.libelle,
      sujet: rfq.sujet,
      token_public: token,
      corps_html: buildRfqHtml(rfq, {
        signature,
        langue,
        lienFormulaire: `${appUrl}/devis/${token}`,
      }),
      corps_texte: buildRfqTexte(rfq, { signature }),
      statut: 'en_validation',
    })
      .select('id')
      .single();

    if (error || !creee) {
      resultat.erreurs.push({
        marque: groupe.libelle,
        motif: error?.message ?? 'consultation non créée',
      });
      continue;
    }

    // Trace des articles réellement consultés. Sans elle, le formulaire de
    // réponse devrait re-déduire la liste par marque — or la marque d'un
    // article peut changer après l'envoi, et le fournisseur verrait alors
    // autre chose que ce qu'on lui a écrit.
    const { error: erreurLiens } = await db.from('consultation_items').insert(
      groupe.articles.map((article) => ({
        consultation_id: creee.id,
        demande_item_id: article.id,
      })),
    );

    if (erreurLiens) {
      // Non bloquant : la consultation part quand même, le fournisseur répondra
      // par courriel. Seul le formulaire en ligne est privé d'articles.
      console.error(
        `[consultations] rattachement des articles impossible (${groupe.libelle}) : ${erreurLiens.message}`,
      );
    }

    resultat.creees += 1;
  }

  return resultat;
}
