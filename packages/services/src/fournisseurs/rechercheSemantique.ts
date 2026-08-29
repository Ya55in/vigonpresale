import { embedder, embeddingsConfigures } from '../ai/embeddings.js';
import { clientAdmin } from '../supabase.js';

/**
 * Recherche sémantique de fournisseurs à consulter.
 *
 * Répond à la question « qui sait fournir ça ? » à partir de ce que les
 * fournisseurs ont déjà chiffré, et non de leur fiche. Le classement propose,
 * il ne décide pas : l'avant-vente coche qui consulter.
 *
 * Ne remplace pas le sourcing web. Sur une marque absente de l'historique, la
 * similarité ne remonte rien — c'est le cas normal d'un nouveau domaine, et le
 * sourcing reste le filet.
 */

/**
 * Seuil de pertinence, calibré sur l'historique réel — mesuré, pas deviné.
 *
 * Les embeddings Gemini donnent une similarité de fond élevée : deux textes
 * techniques français sans rapport tournent déjà autour de 0,60. Un seuil bas
 * ne filtre donc rien, et chaque fournisseur paraît couvrir tout le besoin.
 *
 * Relevé sur les 33 lignes indexées :
 *   ≥ 0,85  même produit      « Pare-feu UTM » ↔ « Pare-feu UTM FG-100F »
 *   0,72    même domaine      « Borne WiFi 6E ext. » ↔ « Point d'accès WiFi 6 int. »
 *   ≤ 0,71  bruit             « Onduleur rack » ↔ « Baie 42U »
 *
 * 0,72 retient le fournisseur qui travaille le domaine sans avoir coté la
 * référence exacte — c'est précisément ce qu'on cherche pour un sourcing — et
 * écarte le reste.
 */
const SEUIL_DEFAUT = 0.72;

/** Au-delà, le fournisseur a déjà chiffré ce produit, pas seulement son domaine. */
export const SEUIL_CERTAIN = 0.85;

/** Lignes historiques rapportées par article : au-delà, on ne fait qu'ajouter du bruit. */
const VOISINS_PAR_ARTICLE = 20;

export type ArticleRecherche = {
  id: number;
  designation: string;
  reference?: string | null;
  marque?: string | null;
};

export type CouvertureArticle = {
  articleId: number;
  designation: string;
  /** Similarité du meilleur appariement pour cet article, 0 à 1. */
  similarite: number;
  /** Ligne historique qui a produit l'appariement — la justification affichée. */
  preuve: string;
};

/**
 * Comportement passé du fournisseur, repris de `fournisseurs`.
 *
 * La pertinence dit qui SAIT fournir, la fiabilité dit qui RÉPOND. Un
 * fournisseur parfaitement pertinent qui n'a jamais répondu à six consultations
 * ne vaut pas une septième, et l'écran doit le montrer plutôt que de le classer
 * comme les autres.
 */
export type FiabiliteFournisseur = {
  consultations: number;
  reponses: number;
  /** Part de consultations ayant reçu une réponse, 0 à 1. `null` si jamais consulté. */
  tauxReponse: number | null;
  delaiMoyenHeures: number | null;
  /** Score de la fiche, 0 à 100. */
  score: number;
};

export type FournisseurPropose = {
  /**
   * Fiches `fournisseurs` de cette société — une par marque distribuée.
   *
   * Le regroupement se fait par nom et non par identifiant : une même société
   * a autant de fiches que de marques, et la faire apparaître trois fois dans
   * la liste n'aiderait personne à décider qui consulter. La génération des
   * consultations refera elle-même la répartition par marque.
   */
  fournisseurIds: number[];
  nom: string;
  /**
   * Moyenne des similarités sur les seuls articles couverts.
   *
   * Et non la somme : un fournisseur couvrant deux articles avec des scores
   * médiocres dépasserait sinon celui qui en couvre un seul parfaitement.
   */
  score: number;
  articlesCouverts: CouvertureArticle[];
  /** Articles demandés au total, pour afficher « 3 / 13 ». */
  articlesDemandes: number;
  /** `null` quand aucune fiche n'est rattachée — fournisseur connu du seul historique. */
  fiabilite: FiabiliteFournisseur | null;
};

export type ResultatRechercheFournisseurs = {
  fournisseurs: FournisseurPropose[];
  /**
   * Articles qu'aucun fournisseur connu ne couvre.
   *
   * La marque est reprise : c'est elle que le sourcing web interroge, et
   * l'écran doit pouvoir nommer ce qu'il irait chercher plutôt que de laisser
   * l'utilisateur deviner.
   */
  articlesNonCouverts: { id: number; designation: string; marque: string | null }[];
  /**
   * Marques distinctes à confier au sourcing web — le démarrage à froid.
   *
   * Un domaine absent de l'historique ne remonte rien, et c'est le cas normal
   * d'une première consultation sur une marque. Sans cette liste, l'écran
   * n'aurait qu'un vide à montrer.
   */
  marquesASourcer: string[];
  /** Vrai quand l'index est vide ou la clé absente : l'écran doit le dire. */
  indisponible: boolean;
};

function texteRequete(article: ArticleRecherche): string {
  return [article.designation, article.reference, article.marque]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join(' · ');
}

/**
 * Fournisseurs susceptibles de couvrir les articles d'une demande.
 *
 * Un embedding par article plutôt qu'un seul pour le besoin entier : sur un
 * appel d'offres multi-lots, un vecteur unique moyennerait bornes WiFi,
 * onduleurs et pare-feux en une bouillie qui ne ressemble à aucun fournisseur.
 * Article par article, chacun retrouve son domaine.
 */
export async function chercherFournisseurs(params: {
  tenant: string;
  articles: ArticleRecherche[];
  seuil?: number;
}): Promise<ResultatRechercheFournisseurs> {
  const { tenant, articles } = params;
  const seuil = params.seuil ?? SEUIL_DEFAUT;

  if (articles.length === 0 || !embeddingsConfigures()) {
    return {
      fournisseurs: [],
      articlesNonCouverts: [],
      marquesASourcer: [],
      indisponible: true,
    };
  }

  const db = clientAdmin();

  // Index vide : inutile d'appeler le modèle pour n'obtenir aucun résultat.
  const { count } = await db
    .from('fournisseur_embeddings')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant);

  if (!count) {
    return {
      fournisseurs: [],
      articlesNonCouverts: articles.map((a) => ({
        id: a.id,
        designation: a.designation,
        marque: a.marque ?? null,
      })),
      marquesASourcer: marquesDistinctes(articles),
      indisponible: true,
    };
  }

  // Clé = nom de la société. Une même société porte une fiche par marque
  // distribuée — Medina Networks en a quatre — et regrouper par identifiant la
  // ferait apparaître autant de fois dans la liste.
  const parFournisseur = new Map<
    string,
    { fournisseurIds: Set<number>; nom: string; couverture: Map<number, CouvertureArticle> }
  >();

  const couverts = new Set<number>();

  for (const article of articles) {
    let vecteur: number[];

    try {
      vecteur = await embedder(texteRequete(article));
    } catch (e) {
      // Un article non vectorisable ne doit pas priver les autres de résultat :
      // il ressortira simplement comme non couvert.
      console.error(
        `[recherche] article ${article.id} non vectorisé : ${e instanceof Error ? e.message : e}`,
      );
      continue;
    }

    const { data, error } = await db.rpc('chercher_fournisseurs_similaires', {
      requete: JSON.stringify(vecteur),
      tenant,
      seuil,
      limite: VOISINS_PAR_ARTICLE,
    });

    if (error) {
      console.error(`[recherche] similarité impossible : ${error.message}`);
      continue;
    }

    for (const ligne of data ?? []) {
      const cle = ligne.fournisseur_nom.trim().toLowerCase();

      let entree = parFournisseur.get(cle);
      if (!entree) {
        entree = {
          fournisseurIds: new Set(),
          nom: ligne.fournisseur_nom,
          couverture: new Map(),
        };
        parFournisseur.set(cle, entree);
      }

      if (ligne.fournisseur_id !== null) entree.fournisseurIds.add(ligne.fournisseur_id);

      // Seul le meilleur appariement par article est retenu : un fournisseur
      // ayant chiffré dix fois le même produit ne mérite pas dix fois le poids.
      const existant = entree.couverture.get(article.id);
      if (!existant || ligne.similarite > existant.similarite) {
        entree.couverture.set(article.id, {
          articleId: article.id,
          designation: article.designation,
          similarite: ligne.similarite,
          preuve: ligne.texte,
        });
      }

      couverts.add(article.id);
    }
  }

  /*
   * LA MARQUE DÉCLARÉE, ET PAS SEULEMENT L'HISTORIQUE.
   *
   * La recherche ci-dessus interroge ce qui a été chiffré. Elle ignore donc un
   * distributeur officiel qui n'a encore rien coté : Pure Solutions porte
   * `marque = 'Cisco'` sur sa fiche, mais sans devis Cisco passé, aucun vecteur
   * ne le rapproche d'un commutateur Cisco. Il n'apparaissait pas du tout — et
   * c'est précisément celui qu'on veut consulter.
   *
   * La correspondance de marque est donc versée en plus. Elle porte une preuve
   * explicite pour que l'humain sache d'où vient la suggestion : « distribue la
   * marque Cisco » ne se lit pas comme « a chiffré un commutateur Cisco ».
   *
   * La similarité conventionnelle de 0.75 traduit ce compromis — signal plus
   * fiable qu'une proximité sémantique moyenne, moins précis qu'un devis réel
   * sur le produit exact. Un appariement sémantique meilleur la remplace, la
   * couverture retenant toujours le maximum.
   */
  const SIMILARITE_MARQUE_DECLAREE = 0.75;

  const parMarque = new Map<string, ArticleRecherche[]>();
  for (const article of articles) {
    const marque = article.marque?.trim();
    if (!marque) continue;
    const cle = marque.toLowerCase();
    parMarque.set(cle, [...(parMarque.get(cle) ?? []), article]);
  }

  if (parMarque.size > 0) {
    const { data: parMarqueFiches } = await db
      .from('fournisseurs')
      .select('id, nom, marque')
      .eq('tenant_id', tenant)
      .not('marque', 'is', null);

    for (const fiche of parMarqueFiches ?? []) {
      const marqueFiche = fiche.marque?.trim().toLowerCase();
      if (!marqueFiche) continue;

      const concernes = parMarque.get(marqueFiche);
      if (!concernes) continue;

      const cle = fiche.nom.trim().toLowerCase();
      let entree = parFournisseur.get(cle);

      if (!entree) {
        entree = { fournisseurIds: new Set(), nom: fiche.nom, couverture: new Map() };
        parFournisseur.set(cle, entree);
      }

      entree.fournisseurIds.add(fiche.id);

      for (const article of concernes) {
        const existant = entree.couverture.get(article.id);
        if (existant && existant.similarite >= SIMILARITE_MARQUE_DECLAREE) continue;

        entree.couverture.set(article.id, {
          articleId: article.id,
          designation: article.designation,
          similarite: SIMILARITE_MARQUE_DECLAREE,
          preuve: `distribue la marque ${fiche.marque}`,
        });

        couverts.add(article.id);
      }
    }
  }

  // Comportement passé, lu en une fois pour tout le lot. La pertinence dit qui
  // SAIT fournir ; ces chiffres disent qui RÉPOND.
  const tousIds = [...parFournisseur.values()].flatMap((f) => [...f.fournisseurIds]);

  const { data: fiches } = await db
    .from('fournisseurs')
    .select('id, nb_consultations, nb_reponses, delai_moyen_reponse_h, score_fiabilite')
    .in('id', tousIds.length > 0 ? tousIds : [-1]);

  const ficheParId = new Map((fiches ?? []).map((x) => [x.id, x]));

  const fournisseurs: FournisseurPropose[] = [...parFournisseur.values()]
    .map((f) => {
      const articlesCouverts = [...f.couverture.values()].sort(
        (a, b) => b.similarite - a.similarite,
      );

      const score =
        articlesCouverts.reduce((s, a) => s + a.similarite, 0) / articlesCouverts.length;

      // Une société a autant de fiches que de marques : on somme leurs
      // compteurs, la fiabilité étant une propriété de l'entreprise et non de
      // la marque qu'elle distribue.
      const lignesFiche = [...f.fournisseurIds]
        .map((id) => ficheParId.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

      const fiabilite =
        lignesFiche.length === 0
          ? null
          : (() => {
              const consultations = lignesFiche.reduce(
                (s, x) => s + Number(x.nb_consultations ?? 0),
                0,
              );
              const reponses = lignesFiche.reduce(
                (s, x) => s + Number(x.nb_reponses ?? 0),
                0,
              );

              const delais = lignesFiche
                .map((x) => x.delai_moyen_reponse_h)
                .filter((d): d is number => d !== null);

              return {
                consultations,
                reponses,
                // `null` et non 0 quand jamais consulté : un fournisseur neuf
                // n'a pas un mauvais taux, il n'en a pas.
                tauxReponse: consultations > 0 ? reponses / consultations : null,
                delaiMoyenHeures:
                  delais.length > 0
                    ? delais.reduce((s, d) => s + Number(d), 0) / delais.length
                    : null,
                score: Math.max(...lignesFiche.map((x) => Number(x.score_fiabilite ?? 0))),
              };
            })();

      return {
        fournisseurIds: [...f.fournisseurIds],
        nom: f.nom,
        score,
        articlesCouverts,
        articlesDemandes: articles.length,
        fiabilite,
      };
    })
    // Couverture d'abord : celui qui couvre huit articles passe avant celui qui
    // en couvre un, même mieux apparié. C'est le nombre de consultations à
    // envoyer qu'on cherche à réduire.
    //
    // La fiabilité ne départage qu'à égalité, et n'est jamais fondue dans le
    // score : un classement dont le nombre mêle pertinence et comportement ne
    // s'explique plus, et l'avant-vente ne saurait pas si un fournisseur est
    // mal placé parce qu'il ne sait pas fournir ou parce qu'il répond mal. Le
    // taux de réponse est affiché à côté ; c'est l'humain qui arbitre.
    .sort(
      (a, b) =>
        b.articlesCouverts.length - a.articlesCouverts.length ||
        b.score - a.score ||
        (b.fiabilite?.tauxReponse ?? 0) - (a.fiabilite?.tauxReponse ?? 0),
    );

  const nonCouverts = articles.filter((a) => !couverts.has(a.id));

  return {
    fournisseurs,
    articlesNonCouverts: nonCouverts.map((a) => ({
      id: a.id,
      designation: a.designation,
      marque: a.marque ?? null,
    })),
    marquesASourcer: marquesDistinctes(nonCouverts),
    indisponible: false,
  };
}

/** Marques renseignées et distinctes, dans l'ordre de première apparition. */
function marquesDistinctes(articles: ArticleRecherche[]): string[] {
  const vues = new Map<string, string>();

  for (const a of articles) {
    const marque = a.marque?.trim();
    // « Multimarque » désigne l'absence de marque imposée : le sourcing web
    // n'en tirerait aucun distributeur.
    if (!marque || marque.toLowerCase() === 'multimarque') continue;
    if (!vues.has(marque.toLowerCase())) vues.set(marque.toLowerCase(), marque);
  }

  return [...vues.values()];
}
