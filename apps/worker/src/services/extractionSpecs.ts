import type { TablesUpdate } from '@vigon/database';
import { specificationsSchema } from '@vigon/shared';
import {
  clientAdmin,
  ErreurQuotaIA,
  genererJson,
  promptSpecifications,
  type ClientAdmin,
} from '@vigon/services';

/**
 * Au-delà, le prompt coûte cher sans rien apporter : les demandes réelles
 * tiennent très en deçà, et une PJ volumineuse est en général un catalogue
 * fournisseur, pas la demande elle-même.
 */
const LONGUEUR_MAX_PROMPT = 60_000;

export type ParamsExtraction = {
  demandeId: number;
  tenant: string;
  code: string;
  contenu: string;
  piecesIllisibles: string[];
};

async function notifier(
  db: ClientAdmin,
  tenant: string,
  demandeId: number,
  params: {
    type: string;
    severite: 'info' | 'avertissement';
    titre: string;
    message: string;
  },
): Promise<void> {
  const { error } = await db.from('notifications').insert({
    tenant_id: tenant,
    role_cible: 'presale',
    type: params.type,
    severite: params.severite,
    titre: params.titre,
    message: params.message,
    lien: `/demandes/${demandeId}`,
    demande_id: demandeId,
  });

  if (error) console.error(`[extraction] notification impossible : ${error.message}`);
}

async function bloquer(
  db: ClientAdmin,
  tenant: string,
  demandeId: number,
  code: string,
  motif: string,
): Promise<void> {
  await db
    .from('demandes')
    .update({ statut: 'bloquee', motif_blocage: motif })
    .eq('id', demandeId)
    .eq('tenant_id', tenant);

  await notifier(db, tenant, demandeId, {
    type: 'extraction_echouee',
    severite: 'avertissement',
    titre: `Demande ${code} — extraction impossible`,
    message: motif,
  });

  console.warn(`[extraction] demande ${code} bloquée : ${motif}`);
}

/**
 * Extrait les spécifications techniques et alimente `demande_items`.
 *
 * La sortie du modèle est validée par zod avant tout INSERT : une réponse hors
 * format bloque la demande pour reprise manuelle plutôt que de polluer la base
 * avec des lignes douteuses.
 */
export async function extraireSpecifications(params: ParamsExtraction): Promise<void> {
  const { demandeId, tenant, code, contenu, piecesIllisibles } = params;
  const db = clientAdmin();

  const tronque = contenu.length > LONGUEUR_MAX_PROMPT;
  const soumis = tronque ? contenu.slice(0, LONGUEUR_MAX_PROMPT) : contenu;

  let specs;
  try {
    specs = await genererJson(
      await promptSpecifications(tenant, soumis),
      specificationsSchema,
      { tentatives: 3, contexte: { demandeId, code } },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);

    // Quota épuisé : la demande est récupérable telle quelle une fois le
    // fournisseur de nouveau disponible, on la laisse en 'nouvelle'.
    if (e instanceof ErreurQuotaIA) {
      await notifier(db, tenant, demandeId, {
        type: 'extraction_reportee',
        severite: 'avertissement',
        titre: `Demande ${code} — extraction reportée`,
        message: `Quota du fournisseur IA épuisé. La demande sera reprise automatiquement. ${detail}`,
      });
      console.warn(`[extraction] demande ${code} reportée (quota) : ${detail}`);
      return;
    }

    await bloquer(db, tenant, demandeId, code, `Extraction IA en échec : ${detail}`);
    return;
  }

  if (specs.articles.length === 0) {
    await bloquer(
      db,
      tenant,
      demandeId,
      code,
      "Aucun article identifié dans la demande. Vérifier le contenu et compléter manuellement.",
    );
    return;
  }

  // Renumérote : le modèle saute parfois un indice ou repart de zéro.
  const lignes = specs.articles.map((article, index) => ({
    demande_id: demandeId,
    ligne_num: index + 1,
    designation: article.designation,
    reference: article.reference,
    marque: article.marque,
    fabricant: article.fabricant,
    quantite: article.quantite,
    unite: article.unite,
    categorie: article.categorie,
    specifications: article.specifications,
    confiance_ia: article.confiance,
  }));

  const { error: insertion } = await db.from('demande_items').insert(lignes);

  if (insertion) {
    await bloquer(
      db,
      tenant,
      demandeId,
      code,
      `Enregistrement des articles impossible : ${insertion.message}`,
    );
    return;
  }

  const maj: TablesUpdate<'demandes'> = {
    statut: 'specs_extraites',
    date_extraction: new Date().toISOString(),
    titre: specs.titre_projet,
  };
  // Laissé intact si le modèle n'a pas trouvé de date : ne jamais écraser
  // une deadline déjà saisie par une valeur vide.
  if (specs.deadline_souhaitee) maj.deadline = specs.deadline_souhaitee;

  /*
   * L'ERREUR EST LUE, et le silence ici coûtait cher.
   *
   * Les articles sont déjà insérés. Si ce seul UPDATE échoue — un `titre`
   * refusé, une deadline que le modèle a rendue hors calendrier, n'importe
   * quelle contrainte — la demande reste `nouvelle` avec ses articles. Le job
   * de reprise la voit alors à chaque cycle, constate qu'elle porte déjà des
   * articles, l'écarte, et recommence deux minutes plus tard : une boucle
   * indéfinie dont le seul signe est un avertissement que personne ne lit.
   *
   * `bloquer` rend l'échec visible et sort la demande de cette boucle : elle
   * n'est plus `nouvelle`, donc plus candidate à la reprise, et l'écran offre
   * le bouton qui la relance une fois la cause corrigée.
   *
   * @see apps/worker/src/jobs/reprendreExtractions.ts — la garde qui écartait
   *      ces demandes sans jamais dire pourquoi elles y revenaient.
   */
  const { error: majStatut } = await db
    .from('demandes')
    .update(maj)
    .eq('id', demandeId)
    .eq('tenant_id', tenant);

  if (majStatut) {
    await bloquer(
      db,
      tenant,
      demandeId,
      code,
      `Articles extraits mais statut non enregistré : ${majStatut.message}`,
    );
    return;
  }

  await db.from('audit_events').insert({
    tenant_id: tenant,
    entite: 'demandes',
    entite_id: demandeId,
    action: 'demande.specs_extraites',
    acteur_type: 'worker',
    details: {
      articles: lignes.length,
      titre_projet: specs.titre_projet,
      deadline: specs.deadline_souhaitee,
      contenu_tronque: tronque,
    },
  });

  // Signale ce qui mérite une relecture humaine plutôt que de le taire.
  const alertes: string[] = [];
  const peuSures = lignes.filter((l) => (l.confiance_ia ?? 0) < 0.6).length;
  if (peuSures > 0) alertes.push(`${peuSures} ligne(s) à confiance faible`);
  if (piecesIllisibles.length > 0) {
    alertes.push(`${piecesIllisibles.length} pièce(s) jointe(s) illisible(s)`);
  }
  if (tronque) alertes.push('contenu tronqué avant analyse');

  await notifier(db, tenant, demandeId, {
    type: 'demande_a_traiter',
    severite: alertes.length > 0 ? 'avertissement' : 'info',
    titre: `Nouvelle demande à traiter — ${code}`,
    message:
      `${specs.titre_projet} : ${lignes.length} article(s) extrait(s).` +
      (alertes.length > 0 ? ` À vérifier : ${alertes.join(', ')}.` : ''),
  });

  console.info(
    `[extraction] demande ${code} → ${lignes.length} article(s)` +
      (alertes.length > 0 ? ` (${alertes.join(', ')})` : ''),
  );
}
