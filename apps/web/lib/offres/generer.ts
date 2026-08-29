import { descriptionProduitSchema, syntheseOffreSchema } from "@vigon/shared";
import {
  FuiteDonneesInternes,
  genererCode,
  genererJson,
  lireConditionsOffre,
  type ConditionsOffre,
  promptDescriptionProduit,
  promptSyntheseOffre,
  recupererPhotoProduit,
  type PhotoProduit,
  verifierAnonymisation,
  type Boq,
  type ProduitBoq,
} from "@vigon/services";

import { randomBytes } from "node:crypto";

import { produireDocument } from "@/lib/offres/document";
import { createAdminClient } from "@/lib/supabase/admin";
import type { TablesInsert } from "@/lib/supabase/types";

/**
 * Jeton du lien public de l'offre.
 *
 * La colonne porte un DEFAULT en base, mais les types générés la marquent
 * requise : on fournit donc la même entropie (24 octets, base64url) plutôt que
 * de contourner le typage.
 */
const genererToken = (): string => randomBytes(24).toString("base64url");

export type ResultatGenerationOffre = {
  offreId: number;
  numero: string;
  version: number;
  /** Renseigné si Gamma a produit le document. */
  gammaUrl: string | null;
  pdfUrl: string | null;
  /** Vrai quand le repli PDF local a été utilisé. */
  repliLocal: boolean;
  /** Motif du repli, pour l'afficher à PRESALE. */
  motifRepli: string | null;
  produits: number;
  photosManquantes: string[];
};

/**
 * Génère l'offre d'une demande dont le costing est verrouillé.
 *
 * Enchaîne : enrichissement IA des descriptions, récupération des photos,
 * construction du BoQ, contrôle d'anonymisation, puis Gamma si la clé est
 * présente — sinon le repli PDF local, qui reste un chemin de premier ordre et
 * non un mode dégradé.
 */
export async function genererOffreComplete(params: {
  demandeId: number;
  tenant: string;
  utilisateurId: string;
  /**
   * Feuille à chiffrer. Omise, la plus récente est prise.
   *
   * Explicite depuis qu'une demande porte une feuille par fournisseur : sans
   * cet identifiant, générer la deuxième offre reprendrait la feuille de la
   * première, et les N offres seraient identiques.
   */
  costSheetId?: number;
  /**
   * Récupération des visuels produits.
   *
   * Activée par défaut : c'est le comportement d'avant, et une offre illustrée
   * se lit mieux. La couper sert aux besoins purement techniques — un lot de
   * licences ou de prestations, où chaque visuel serait un générique sans
   * rapport qui affaiblit la proposition plus qu'il ne la sert.
   */
  avecImages?: boolean;
  /**
   * Conditions commerciales propres à cette offre.
   *
   * Omises, celles du tenant s'appliquent — le modèle standard. Renseignées,
   * elles ne valent que pour cette offre et n'altèrent pas le paramétrage
   * général : une remise exceptionnelle sur un dossier ne doit pas devenir la
   * règle par inadvertance.
   */
  conditions?: ConditionsOffre;
}): Promise<ResultatGenerationOffre> {
  const { demandeId, tenant, utilisateurId, costSheetId } = params;
  const avecImages = params.avecImages ?? true;
  const db = createAdminClient();

  // --- Feuille de coûts verrouillée : rien ne se génère avant validation ---
  const requeteFeuille = db
    .from("cost_sheets")
    .select(
      "id, version, statut, devise, tva_pct, total_vente_ht, total_tva, total_ttc",
    )
    .eq("demande_id", demandeId)
    .eq("tenant_id", tenant);

  const { data: feuille } = costSheetId
    ? await requeteFeuille.eq("id", costSheetId).maybeSingle()
    : await requeteFeuille
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

  if (!feuille) throw new Error("Aucune feuille de coûts pour cette demande.");
  if (feuille.statut !== "verrouille") {
    throw new Error(
      "Le costing doit être validé et verrouillé avant de générer l’offre.",
    );
  }

  const { data: demande } = await db
    .from("demandes")
    .select("id, code, titre, devise, clients(nom, logo_url, email_principal)")
    .eq("id", demandeId)
    .eq("tenant_id", tenant)
    .single();

  if (!demande) throw new Error("Demande introuvable.");

  const client = Array.isArray(demande.clients)
    ? demande.clients[0]
    : demande.clients;

  const { data: lignes } = await db
    .from("cost_lines")
    .select(
      "id, ligne_num, designation_client, description_technique, reference, quantite, prix_vente_ht, total_ligne_ht, demande_item_id",
    )
    .eq("cost_sheet_id", feuille.id)
    .order("ligne_num", { ascending: true });

  if (!lignes || lignes.length === 0) {
    throw new Error("La feuille de coûts ne contient aucune ligne.");
  }

  // Marques : elles viennent des articles de la demande, jamais du fournisseur.
  const { data: articles } = await db
    .from("demande_items")
    .select("id, marque, specifications, designation, reference, quantite")
    .eq("demande_id", demandeId);

  const marqueParArticle = new Map(
    (articles ?? []).map((a) => [
      a.id,
      { marque: a.marque, specs: a.specifications },
    ]),
  );

  // Ce que cette offre ne couvre pas : la feuille est bâtie sur le devis d'un
  // seul fournisseur, qui n'a pas forcément chiffré tout le besoin. Calculé par
  // différence, jamais demandé au modèle.
  const chiffres = new Set(
    lignes.map((l) => l.demande_item_id).filter((id): id is number => id !== null),
  );
  const articlesNonProposes = (articles ?? [])
    .filter((a) => !chiffres.has(a.id))
    .map((a) => ({
      designation: a.designation,
      reference: a.reference,
      quantite: Number(a.quantite ?? 1),
    }));

  // Noms de fournisseurs impliqués : servent uniquement au contrôle de fuite.
  const { data: consultations } = await db
    .from("consultations")
    .select("fournisseur_nom")
    .eq("demande_id", demandeId)
    .eq("tenant_id", tenant);

  const nomsFournisseurs = (consultations ?? [])
    .map((c) => c.fournisseur_nom)
    .filter((n): n is string => Boolean(n));

  // --- Numéro et version de l'offre ---
  const { data: offresExistantes } = await db
    .from("offres")
    .select("numero, version")
    .eq("demande_id", demandeId)
    .eq("tenant_id", tenant)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (offresExistantes?.version ?? 0) + 1;

  // `numero` porte une contrainte UNIQUE : il inclut donc la version, ce qui
  // correspond au format de référence attendu par la spec (PR-2026-000321-V01).
  // La base est reprise de la version précédente pour que toutes les versions
  // d'une même offre partagent leur racine.
  const base = offresExistantes?.numero
    ? offresExistantes.numero.replace(/-V\d+$/, "")
    : await genererCode("PR", "seq_offre");

  const numero = `${base}-V${String(version).padStart(2, "0")}`;
  const referenceOffre = numero;

  // --- Création de l'offre : son id sert de dossier de stockage aux photos ---
  const { data: offre, error: erreurOffre } = await db
    .from("offres")
    .insert({
      tenant_id: tenant,
      demande_id: demandeId,
      cost_sheet_id: feuille.id,
      numero,
      version,
      titre: demande.titre ?? numero,
      token_public: genererToken(),
      statut: "brouillon",
      cree_par: utilisateurId,
    })
    .select("id")
    .single();

  if (erreurOffre || !offre) {
    throw new Error(`Création de l'offre impossible : ${erreurOffre?.message}`);
  }

  // À partir d'ici la ligne `offres` existe : tout échec doit la retirer, sinon
  // chaque tentative laisserait une offre en brouillon et ferait grimper le
  // numéro de version sans qu'aucun document n'ait été produit.
  const offreId = offre.id;

  try {
    // --- Enrichissement produit par produit ---
    const produits: ProduitBoq[] = [];
    const photosManquantes: string[] = [];
    const aInserer: TablesInsert<"offre_produits">[] = [];

    for (const [index, ligne] of lignes.entries()) {
      const infosArticle =
        ligne.demande_item_id === null
          ? undefined
          : marqueParArticle.get(ligne.demande_item_id);
      const marque = infosArticle?.marque ?? "Non specifie";
      const designation = ligne.designation_client ?? "Article";

      // Description commerciale : un échec laisse la description technique
      // d'origine plutôt que d'interrompre toute l'offre.
      let descriptionTechnique = ligne.description_technique;
      let pointsCles: string[] = [];

      try {
        const enrichi = await genererJson(
          await promptDescriptionProduit(tenant, {
            designation,
            marque,
            reference: ligne.reference,
            specifications: infosArticle?.specs ?? ligne.description_technique,
          }),
          descriptionProduitSchema,
          {
            tentatives: 2,
            contexte: { offreId: offre.id, ligne: ligne.ligne_num },
          },
        );
        descriptionTechnique = enrichi.description_technique;
        pointsCles = enrichi.points_cles;
      } catch (e) {
        console.error(
          `[offre] description non enrichie pour « ${designation} » : ${e instanceof Error ? e.message : e}`,
        );
      }

      // Sans images, on saute l'appel réseau plutôt que de le faire pour jeter
      // le résultat : c'est la partie la plus lente de la génération.
      const photo = avecImages
        ? await recupererPhotoProduit({
            tenant,
            offreId: offre.id,
            marque,
            reference: ligne.reference,
            designation,
          })
        : ({ imageUrl: null, imageSource: null, placeholder: false } satisfies PhotoProduit);

      if (photo.placeholder) {
        photosManquantes.push(designation);
      }

      const prixUnitaireHt = Number(ligne.prix_vente_ht ?? 0);
      const totalHt = Number(ligne.total_ligne_ht ?? 0);

      produits.push({
        designation,
        reference: ligne.reference,
        marque,
        imageUrl: photo.imageUrl,
        descriptionTechnique,
        pointsCles,
        quantite: Number(ligne.quantite ?? 1),
        prixUnitaireHt,
        totalHt,
      });

      aInserer.push({
        offre_id: offre.id,
        cost_line_id: ligne.id,
        ordre: index + 1,
        designation,
        reference: ligne.reference,
        marque,
        description_technique: descriptionTechnique,
        points_cles: pointsCles,
        image_url: photo.imageUrl,
        image_source: photo.imageSource,
        image_validee: false,
        quantite: Number(ligne.quantite ?? 1),
        prix_unitaire_ht: prixUnitaireHt,
        total_ht: totalHt,
      });
    }

    // --- Synthèse de la solution ---
    let solution = {
      titre: demande.titre ?? "Proposition commerciale",
      resume:
        "Notre proposition répond au besoin exprimé avec un ensemble cohérent de matériels et de services.",
      tableauExplicatif: [] as {
        besoin: string;
        solutionProposee: string;
        benefice: string;
      }[],
    };

    try {
      const synthese = await genererJson(
        await promptSyntheseOffre(tenant, {
          titreProjet: demande.titre ?? "Projet",
          produits: produits.map((p) => ({
            designation: p.designation,
            quantite: p.quantite,
          })),
        }),
        syntheseOffreSchema,
        { tentatives: 2, contexte: { offreId: offre.id } },
      );

      solution = {
        titre: synthese.titre,
        resume: synthese.resume,
        tableauExplicatif: synthese.tableau_explicatif.map((l) => ({
          besoin: l.besoin,
          solutionProposee: l.solution_proposee,
          benefice: l.benefice,
        })),
      };
    } catch (e) {
      console.error(
        `[offre] synthèse non générée, texte de repli utilisé : ${e instanceof Error ? e.message : e}`,
      );
    }

    const devise = feuille.devise ?? demande.devise ?? "MAD";

    const boq: Boq = {
      client: {
        nom: client?.nom ?? "Client",
        logoUrl: client?.logo_url ?? null,
        contact: client?.email_principal ?? null,
      },
      referenceOffre,
      date: new Date().toLocaleDateString("fr-FR"),
      validite: "15 jours",
      solution,
      produits,
      totaux: {
        totalHt: Number(feuille.total_vente_ht ?? 0),
        tvaPct: Number(feuille.tva_pct ?? 20),
        totalTva: Number(feuille.total_tva ?? 0),
        totalTtc: Number(feuille.total_ttc ?? 0),
        devise,
      },
      // Gelées ici : une modification ultérieure des conditions ne réécrit pas
      // une offre déjà transmise, dont `source_json` fait foi.
      // Gelées ici : une modification ultérieure des conditions ne réécrit pas
      // une offre déjà partie. La surcharge ne vaut que pour cette offre.
      conditions: params.conditions ?? (await lireConditionsOffre(tenant)),
      articlesNonProposes,
    };

    // --- Garde d'anonymisation : avant toute sortie, interne ou externe ---
    try {
      verifierAnonymisation(boq, nomsFournisseurs);
    } catch (e) {
      // Le nettoyage est fait par le wrapper : mieux vaut aucune offre qu'une
      // offre révélant les prix d'achat ou le fournisseur au client.
      if (e instanceof FuiteDonneesInternes) {
        throw new Error(
          `Génération interrompue — données internes détectées : ${e.termes.join(", ")}.`,
        );
      }
      throw e;
    }

    const { error: erreurProduits } = await db
      .from("offre_produits")
      .insert(aInserer);
    if (erreurProduits) {
      throw new Error(
        `Enregistrement des produits impossible : ${erreurProduits.message}`,
      );
    }

    // --- Gamma si disponible, repli PDF local sinon ---
    const { gammaDocId, gammaUrl, pdfUrl, repliLocal, motifRepli } =
      await produireDocument(boq, tenant, offre.id);

    /*
     * C'EST ICI QUE L'OFFRE DEVIENT RÉELLE — et l'échec de cette seule écriture
     * ne devait pas passer pour un succès.
     *
     * `source_json` est la photographie figée : sans elle, la page publique n'a
     * rien à montrer, et `pdf_url` désigne un fichier bien déposé mais que plus
     * rien ne relie à l'offre. La fonction rendait pourtant un résultat complet,
     * numéro compris, après cent secondes de travail — l'écran annonçait donc
     * une offre générée dont il ne restait qu'une coquille.
     *
     * L'exception est délibérée : le `catch` en fin de fonction retire l'offre
     * et ses produits. Perdre la génération en le disant vaut mieux que garder
     * une offre à moitié écrite dont personne ne connaît l'état.
     */
    const { error: erreurOffre } = await db
      .from("offres")
      .update({
        statut: "generee",
        date_generation: new Date().toISOString(),
        gamma_doc_id: gammaDocId,
        gamma_url: gammaUrl,
        pdf_url: pdfUrl,
        source_json: JSON.parse(JSON.stringify(boq)),
        contenu_html: null,
      })
      .eq("id", offre.id);

    if (erreurOffre) {
      throw new Error(
        `Enregistrement de l'offre générée impossible : ${erreurOffre.message}`,
      );
    }

    // Le statut de la demande, lui, ne conditionne pas l'offre : elle existe et
    // s'ouvre. Journalisé sans annuler — détruire une offre valide pour un
    // statut d'affaire non suivi serait disproportionné.
    const { error: erreurDemande } = await db
      .from("demandes")
      .update({ statut: "offre_generee", date_offre: new Date().toISOString() })
      .eq("id", demandeId)
      .eq("tenant_id", tenant);

    if (erreurDemande) {
      console.error(
        `[offre] ${numero} générée mais statut de la demande non suivi : ${erreurDemande.message}`,
      );
    }

    await db.from("audit_events").insert({
      tenant_id: tenant,
      user_id: utilisateurId,
      entite: "offres",
      entite_id: offre.id,
      action: "offre.generee",
      details: {
        code: demande.code,
        reference: referenceOffre,
        version,
        produits: produits.length,
        photos_manquantes: photosManquantes,
        source: repliLocal ? "pdf_local" : "gamma",
        motif_repli: motifRepli,
      },
    });

    return {
      offreId: offre.id,
      numero,
      version,
      gammaUrl,
      pdfUrl,
      repliLocal,
      motifRepli,
      produits: produits.length,
      photosManquantes,
    };
  } catch (e) {
    await db.from("offre_produits").delete().eq("offre_id", offreId);
    await db.from("offres").delete().eq("id", offreId);
    throw e;
  }
}
