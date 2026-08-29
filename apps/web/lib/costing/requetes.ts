import { createAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/types';

/** Offre d'un fournisseur pour un article donné. */
export type OffreArticle = {
  ligneDevisId: number;
  devisId: number;
  fournisseurId: number | null;
  fournisseurNom: string;
  numeroDevis: string | null;
  designationFournisseur: string | null;
  reference: string | null;
  prixAchatHt: number;
  remisePct: number;
  prixAchatNetHt: number;
  disponibilite: string | null;
  delaiLivraison: string | null;
  mappingType: string | null;
  confiance: number | null;
};

export type LigneComparatif = {
  demandeItemId: number;
  ligneNum: number;
  designation: string;
  reference: string | null;
  marque: string | null;
  quantite: number;
  offres: OffreArticle[];
  /** Meilleur prix net comparable, null si aucune offre. */
  meilleurPrixNet: number | null;
};

/**
 * Critères de comparaison portés par le devis, non par la ligne.
 *
 * Garantie, paiement et validité s'annoncent une fois pour tout le devis : ils
 * n'ont pas leur place dans un tableau par article, mais les ignorer revient à
 * arbitrer sur le seul prix. Un écart de 24 mois de garantie pèse souvent plus
 * que quelques pourcents.
 */
export type CriteresFournisseur = {
  id: number | null;
  nom: string;
  numeroDevis: string | null;
  /** Somme des prix nets × quantité sur les seuls articles couverts. */
  totalHt: number;
  /** Articles couverts / total demandé : un total bas sur 3 articles ne vaut pas un total sur 10. */
  articlesCouverts: number;
  articlesDemandes: number;
  delaiLivraison: string | null;
  conditionsPaiement: string | null;
  garantie: string | null;
  validiteOffre: string | null;
};

/**
 * Une colonne du tableau comparatif — UN DEVIS, et non un fournisseur.
 *
 * La distinction n'est pas cosmétique, elle décide de ce qui est ATTEIGNABLE.
 * Les colonnes étaient auparavant les fournisseurs, et chaque cellule retrouvait
 * son offre par le NOM. Deux cas la rendaient fausse, tous deux ordinaires :
 *
 *  - une même société porte une fiche par marque distribuée — « Medina Networks »
 *    en a quatre. Trois colonnes identiques apparaissaient, toutes remplies par
 *    la première offre trouvée, et React recevait trois fois la même clé ;
 *  - un même fournisseur répond par PLUSIEURS devis. `find` sur le nom n'en
 *    rendait qu'un : les autres n'étaient ni affichés ni sélectionnables.
 *
 * Mesuré sur DM-2026-000032 avant correction : **6 offres sur 16 inatteignables**,
 * dont la moins chère de chaque paire. L'avant-vente ne pouvait pas retenir le
 * meilleur prix — l'écran le mettait en évidence sans permettre de le choisir.
 *
 * Le devis est la bonne unité : chaque offre appartient à exactement un devis,
 * donc une colonne par devis rend toute offre atteignable, par construction.
 */
export type ColonneComparatif = {
  /** Identité de la colonne. Unique par construction. */
  devisId: number;
  fournisseurId: number | null;
  nom: string;
  /**
   * Ce qui s'affiche en en-tête : le nom seul quand il suffit, complété du
   * numéro de devis quand plusieurs colonnes le partagent. Deux colonnes
   * portant le même libellé ne se distinguent pas à l'œil.
   */
  libelle: string;
  numeroDevis: string | null;
  nbOffres: number;
};

export type Comparatif = {
  lignes: LigneComparatif[];
  /** Une colonne par devis reçu — voir `ColonneComparatif`. */
  colonnes: ColonneComparatif[];
  /** Un bloc par fournisseur : les critères que le tableau par article ne peut porter. */
  criteres: CriteresFournisseur[];
  /** Articles de la demande sans aucune offre chiffrée. */
  articlesSansOffre: string[];
};

/**
 * Construit le tableau comparatif : articles en lignes, fournisseurs en colonnes.
 *
 * Les prix nets viennent de `prix_achat_net_ht`, colonne générée en base —
 * l'application ne recalcule jamais une remise.
 */
export async function lireComparatif(
  demandeId: number,
  tenant: string,
): Promise<Comparatif> {
  const db = createAdminClient();

  // Trois lectures plates plutôt qu'une jointure à deux niveaux : PostgREST
  // sait la faire, mais son inférence de types s'y perd et rend le résultat
  // inutilisable en TypeScript strict.
  const [{ data: articles }, { data: devisListe }, { data: consultationsListe }] =
    await Promise.all([
      db
        .from('demande_items')
        .select('id, ligne_num, designation, reference, marque, quantite')
        .eq('demande_id', demandeId)
        .order('ligne_num', { ascending: true }),
      db
        .from('devis_fournisseur')
        .select(
          'id, numero_devis, delai_livraison, conditions_paiement, garantie, validite_offre, consultation_id',
        )
        .eq('demande_id', demandeId)
        .eq('tenant_id', tenant),
      db
        .from('consultations')
        .select('id, fournisseur_id, fournisseur_nom')
        .eq('demande_id', demandeId)
        .eq('tenant_id', tenant),
    ]);

  const consultationParId = new Map(
    (consultationsListe ?? []).map((c) => [c.id, c]),
  );
  const devisParId = new Map((devisListe ?? []).map((d) => [d.id, d]));

  const { data: lignes } = await db
    .from('lignes_devis')
    .select(
      'id, devis_id, demande_item_id, designation_fournisseur, reference, prix_achat_ht, remise_pct, prix_achat_net_ht, disponibilite, mapping_type, confiance_ia',
    )
    .in('devis_id', [...devisParId.keys()].length ? [...devisParId.keys()] : [-1]);

  const parArticle = new Map<number, OffreArticle[]>();

  // Clé = le devis. Une offre appartient à exactement un devis, donc aucune ne
  // peut être écrasée par une autre — c'est ce que le regroupement par nom ne
  // garantissait pas.
  const colonnes = new Map<number, ColonneComparatif>();

  for (const ligne of lignes ?? []) {
    const devis = ligne.devis_id === null ? undefined : devisParId.get(ligne.devis_id);
    if (!devis || ligne.demande_item_id === null) continue;

    const consultation =
      devis.consultation_id === null
        ? undefined
        : consultationParId.get(devis.consultation_id);

    const nom = consultation?.fournisseur_nom ?? 'Fournisseur inconnu';
    const fournisseurId = consultation?.fournisseur_id ?? null;

    const offre: OffreArticle = {
      ligneDevisId: ligne.id,
      devisId: devis.id,
      fournisseurId,
      fournisseurNom: nom,
      numeroDevis: devis.numero_devis,
      designationFournisseur: ligne.designation_fournisseur,
      reference: ligne.reference,
      prixAchatHt: Number(ligne.prix_achat_ht ?? 0),
      remisePct: Number(ligne.remise_pct ?? 0),
      prixAchatNetHt: Number(ligne.prix_achat_net_ht ?? ligne.prix_achat_ht ?? 0),
      disponibilite: ligne.disponibilite,
      delaiLivraison: devis.delai_livraison,
      mappingType: ligne.mapping_type,
      confiance: ligne.confiance_ia === null ? null : Number(ligne.confiance_ia),
    };

    const liste = parArticle.get(ligne.demande_item_id);
    if (liste) liste.push(offre);
    else parArticle.set(ligne.demande_item_id, [offre]);

    const colonne = colonnes.get(devis.id);
    if (colonne) colonne.nbOffres += 1;
    else {
      colonnes.set(devis.id, {
        devisId: devis.id,
        fournisseurId,
        nom,
        libelle: nom,
        numeroDevis: devis.numero_devis,
        nbOffres: 1,
      });
    }
  }

  /*
   * Désambiguïsation des en-têtes, seulement là où c'est nécessaire.
   *
   * Compléter systématiquement du numéro de devis alourdirait toutes les
   * colonnes pour le cas où un seul fournisseur a répondu — le cas courant.
   * Le libellé ne s'allonge donc que lorsque le nom seul ne suffit plus.
   */
  const occurrences = new Map<string, number>();
  for (const c of colonnes.values()) {
    occurrences.set(c.nom, (occurrences.get(c.nom) ?? 0) + 1);
  }

  for (const c of colonnes.values()) {
    if ((occurrences.get(c.nom) ?? 0) > 1) {
      c.libelle = c.numeroDevis ? `${c.nom} — ${c.numeroDevis}` : `${c.nom} (devis ${c.devisId})`;
    }
  }

  const lignesComparatif: LigneComparatif[] = [];
  const articlesSansOffre: string[] = [];

  for (const article of articles ?? []) {
    const offres = (parArticle.get(article.id) ?? []).sort(
      (a, b) => a.prixAchatNetHt - b.prixAchatNetHt,
    );

    if (offres.length === 0) articlesSansOffre.push(article.designation);

    lignesComparatif.push({
      demandeItemId: article.id,
      ligneNum: article.ligne_num,
      designation: article.designation,
      reference: article.reference,
      marque: article.marque,
      quantite: Number(article.quantite),
      offres,
      // Une offre « alternative » n'est pas comparable à l'identique : on ne
      // la retient pas comme référence de meilleur prix.
      meilleurPrixNet:
        offres.filter((o) => o.mappingType !== 'alternative')[0]?.prixAchatNetHt ??
        offres[0]?.prixAchatNetHt ??
        null,
    });
  }

  // Critères portés par le devis. On agrège depuis les lignes déjà rattachées
  // plutôt que de relire : un devis sans ligne exploitable n'a rien à comparer
  // et resterait une colonne vide de plus.
  const parFournisseur = new Map<string, CriteresFournisseur>();

  for (const ligne of lignesComparatif) {
    for (const offre of ligne.offres) {
      const cle = String(offre.fournisseurId ?? offre.fournisseurNom);
      const devis = devisParId.get(offre.devisId);

      let critere = parFournisseur.get(cle);
      if (!critere) {
        critere = {
          id: offre.fournisseurId,
          // Le nom seul se répète quand une société porte plusieurs fiches :
          // trois blocs « Medina Networks » étaient impossibles à départager.
          // Le numéro de devis les distingue sans allonger le cas courant.
          nom: offre.fournisseurNom,
          numeroDevis: offre.numeroDevis,
          totalHt: 0,
          articlesCouverts: 0,
          articlesDemandes: lignesComparatif.length,
          delaiLivraison: devis?.delai_livraison ?? null,
          conditionsPaiement: devis?.conditions_paiement ?? null,
          garantie: devis?.garantie ?? null,
          validiteOffre: devis?.validite_offre ?? null,
        };
        parFournisseur.set(cle, critere);
      }

      critere.totalHt += offre.prixAchatNetHt * ligne.quantite;
      critere.articlesCouverts += 1;
    }
  }

  // Même désambiguïsation que pour les colonnes, et pour la même raison : trois
  // blocs « Medina Networks » ne se départagent pas à l'œil.
  const occurrencesCriteres = new Map<string, number>();
  for (const c of parFournisseur.values()) {
    occurrencesCriteres.set(c.nom, (occurrencesCriteres.get(c.nom) ?? 0) + 1);
  }
  for (const c of parFournisseur.values()) {
    if ((occurrencesCriteres.get(c.nom) ?? 0) > 1 && c.numeroDevis) {
      c.nom = `${c.nom} — ${c.numeroDevis}`;
    }
  }

  return {
    lignes: lignesComparatif,
    // Le plus couvrant d'abord, puis par nom : deux devis à couverture égale
    // se rangent alors côte à côte, ce qui aide à les comparer.
    colonnes: [...colonnes.values()].sort(
      (a, b) => b.nbOffres - a.nbOffres || a.libelle.localeCompare(b.libelle),
    ),
    // Couverture d'abord : comparer les totaux n'a de sens qu'à périmètre égal.
    criteres: [...parFournisseur.values()].sort(
      (a, b) => b.articlesCouverts - a.articlesCouverts || a.totalHt - b.totalHt,
    ),
    articlesSansOffre,
  };
}

export type FeuilleCout = Tables<'cost_sheets'> & {
  lignes: Tables<'cost_lines'>[];
};

/** Dernière version de la feuille de coûts d'une demande. */
export async function lireFeuilleCourante(
  demandeId: number,
  tenant: string,
): Promise<FeuilleCout | null> {
  const db = createAdminClient();

  const { data: feuille, error } = await db
    .from('cost_sheets')
    .select('*')
    .eq('demande_id', demandeId)
    .eq('tenant_id', tenant)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Lecture du costing impossible : ${error.message}`);
  if (!feuille) return null;

  const { data: lignes } = await db
    .from('cost_lines')
    .select('*')
    .eq('cost_sheet_id', feuille.id)
    .order('ligne_num', { ascending: true });

  return { ...feuille, lignes: lignes ?? [] };
}

export type FeuilleFournisseur = {
  id: number;
  version: number;
  statut: string;
  /**
   * Nom du fournisseur dont proviennent les lignes.
   *
   * `null` quand elles viennent de plusieurs — l'écran affiche alors
   * « Multi-fournisseurs », qui décrit la feuille panachée du parcours
   * « meilleur prix ». Une feuille dont aucune ligne ne porte de fournisseur
   * est signalée distinctement : c'est une anomalie de données, pas un choix.
   */
  fournisseurNom: string | null;
  /** Nombre de fournisseurs distincts, pour distinguer « aucun » de « plusieurs ». */
  nbFournisseurs: number;
  articlesCouverts: number;
  articlesDemandes: number;
  totalVenteHt: number;
  totalTtc: number;
  /** Offre déjà produite depuis cette feuille, le cas échéant. */
  offreNumero: string | null;
  offreId: number | null;
};

/**
 * Toutes les feuilles de la demande, avec leur fournisseur et leur couverture.
 *
 * Depuis qu'une demande porte une feuille par fournisseur, l'écran doit les
 * montrer côte à côte : c'est ce tableau qui permet de voir qui couvre quoi,
 * et quelle offre a déjà été produite.
 *
 * Le fournisseur n'est pas une colonne de `cost_sheets` — il se déduit des
 * lignes. Une feuille dont les lignes viennent de plusieurs fournisseurs (le
 * parcours « meilleur prix ») renvoie donc `null`, ce qui la distingue
 * naturellement des feuilles mono-fournisseur.
 */
export async function listerFeuillesFournisseur(
  demandeId: number,
  tenant: string,
): Promise<FeuilleFournisseur[]> {
  const db = createAdminClient();

  const [{ data: feuilles }, { count: articlesDemandes }, { data: offres }] =
    await Promise.all([
      db
        .from('cost_sheets')
        .select('id, version, statut, total_vente_ht, total_ttc')
        .eq('demande_id', demandeId)
        .eq('tenant_id', tenant)
        .order('version', { ascending: true }),
      db
        .from('demande_items')
        .select('id', { count: 'exact', head: true })
        .eq('demande_id', demandeId),
      db
        .from('offres')
        .select('id, numero, cost_sheet_id')
        .eq('demande_id', demandeId)
        .eq('tenant_id', tenant),
    ]);

  if (!feuilles || feuilles.length === 0) return [];

  const { data: lignes } = await db
    .from('cost_lines')
    .select('cost_sheet_id, fournisseur_id, demande_item_id')
    .in(
      'cost_sheet_id',
      feuilles.map((f) => f.id),
    );

  const { data: fournisseurs } = await db
    .from('fournisseurs')
    .select('id, nom')
    .eq('tenant_id', tenant);

  const nomParFournisseur = new Map((fournisseurs ?? []).map((f) => [f.id, f.nom]));

  // La dernière offre produite pour une feuille prime : régénérer remplace.
  const offreParFeuille = new Map<number, { id: number; numero: string }>();
  for (const o of offres ?? []) {
    if (o.cost_sheet_id === null) continue;
    offreParFeuille.set(o.cost_sheet_id, { id: o.id, numero: o.numero });
  }

  return feuilles.map((f) => {
    const siennes = (lignes ?? []).filter((l) => l.cost_sheet_id === f.id);
    const ids = new Set(siennes.map((l) => l.fournisseur_id).filter((v) => v !== null));

    const offre = offreParFeuille.get(f.id) ?? null;

    return {
      id: f.id,
      version: f.version,
      statut: f.statut,
      fournisseurNom:
        ids.size === 1 ? (nomParFournisseur.get([...ids][0] as number) ?? null) : null,
      nbFournisseurs: ids.size,
      articlesCouverts: new Set(siennes.map((l) => l.demande_item_id)).size,
      articlesDemandes: articlesDemandes ?? 0,
      totalVenteHt: Number(f.total_vente_ht ?? 0),
      totalTtc: Number(f.total_ttc ?? 0),
      offreNumero: offre?.numero ?? null,
      offreId: offre?.id ?? null,
    };
  });
}

export type FeuilleEnAttente = {
  id: number;
  version: number;
  demandeId: number;
  demandeCode: string;
  clientNom: string | null;
  margeGlobalePct: number;
  totalTtc: number;
  totalAchatHt: number;
  creeLe: string | null;
};

/**
 * Feuilles soumises à FINANCE.
 *
 * Le statut « soumis » est la trace de l'escalade : les colonnes
 * `escalade_finance` et `motif_escalade` de la spec n'existent pas au schéma,
 * le motif est donc recalculé à l'affichage depuis les seuils courants.
 */
export async function listerFeuillesEnAttente(
  tenant: string,
): Promise<FeuilleEnAttente[]> {
  const { data, error } = await createAdminClient()
    .from('cost_sheets')
    .select(
      'id, version, demande_id, marge_globale_pct, total_ttc, total_achat_ht, created_at, demandes!inner(code, clients(nom))',
    )
    .eq('tenant_id', tenant)
    .eq('statut', 'soumis')
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Lecture des validations en attente : ${error.message}`);

  return (data ?? []).map((f) => {
    const demande = Array.isArray(f.demandes) ? f.demandes[0] : f.demandes;
    const client = demande
      ? Array.isArray(demande.clients)
        ? demande.clients[0]
        : demande.clients
      : null;

    return {
      id: f.id,
      version: f.version,
      demandeId: f.demande_id!,
      demandeCode: demande?.code ?? '—',
      clientNom: client?.nom ?? null,
      margeGlobalePct: Number(f.marge_globale_pct ?? 0),
      totalTtc: Number(f.total_ttc ?? 0),
      totalAchatHt: Number(f.total_achat_ht ?? 0),
      creeLe: f.created_at,
    };
  });
}

/** Formate un montant en devise, pour l'affichage. */
export function formaterMontant(valeur: number, devise = 'MAD'): string {
  return `${valeur.toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${devise}`;
}
