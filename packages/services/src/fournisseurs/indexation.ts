import { clientAdmin } from '../supabase.js';
import {
  MODELE_EMBEDDING,
  embedderLot,
  embeddingsConfigures,
  texteLigneDevis,
} from '../ai/embeddings.js';

/**
 * Vectorisation de l'historique des devis.
 *
 * Ce qui est indexé n'est pas la fiche fournisseur — nom, marque, pays — mais
 * ce que chaque fournisseur a réellement chiffré. Un fournisseur ayant coté
 * quarante équipements réseau EST un fournisseur réseau, quoi qu'en dise sa
 * colonne `marque`, et c'est ce qui permet de le retrouver sur un besoin dont
 * le libellé ne cite aucune marque.
 *
 * L'indexation est toujours en marge du flux : un échec ici ne doit jamais
 * empêcher un devis d'être enregistré. Au pire la recherche sémantique ignore
 * ces lignes, et le sourcing web reste le filet.
 */

export type ResultatIndexation = {
  indexees: number;
  ignorees: number;
  echecs: number;
};

type LigneAIndexer = {
  ligneDevisId: number;
  fournisseurId: number | null;
  fournisseurNom: string;
  texte: string;
};

/**
 * Remonte de chaque ligne à son fournisseur.
 *
 * Trois sauts sont nécessaires — lignes_devis → devis_fournisseur →
 * consultations — et PostgREST perd son inférence de types sur une jointure à
 * ce niveau d'imbrication. On lit donc à plat, comme le reste du projet.
 */
async function resoudreLignes(
  tenant: string,
  devisIds: number[],
): Promise<LigneAIndexer[]> {
  const db = clientAdmin();
  if (devisIds.length === 0) return [];

  const { data: devis } = await db
    .from('devis_fournisseur')
    .select('id, consultation_id')
    .eq('tenant_id', tenant)
    .in('id', devisIds);

  const consultationIds = (devis ?? [])
    .map((d) => d.consultation_id)
    .filter((v): v is number => v !== null);

  const { data: consultations } = await db
    .from('consultations')
    .select('id, fournisseur_id, fournisseur_nom')
    .in('id', consultationIds.length > 0 ? consultationIds : [-1]);

  const consultationParId = new Map((consultations ?? []).map((c) => [c.id, c]));
  const devisParId = new Map((devis ?? []).map((d) => [d.id, d]));

  const { data: lignes } = await db
    .from('lignes_devis')
    .select('id, devis_id, designation_fournisseur, reference, fabricant')
    .in('devis_id', devisIds);

  const resultat: LigneAIndexer[] = [];

  for (const ligne of lignes ?? []) {
    const d = ligne.devis_id === null ? undefined : devisParId.get(ligne.devis_id);
    const c =
      d?.consultation_id === null || d?.consultation_id === undefined
        ? undefined
        : consultationParId.get(d.consultation_id);

    // Sans nom de fournisseur, le vecteur ne pourrait être attribué à personne :
    // il encombrerait l'index sans jamais remonter dans un résultat utile.
    const nom = c?.fournisseur_nom;
    if (!nom) continue;

    const texte = texteLigneDevis({
      designation: ligne.designation_fournisseur,
      reference: ligne.reference,
      marque: ligne.fabricant,
    });

    if (!texte.trim()) continue;

    resultat.push({
      ligneDevisId: ligne.id,
      fournisseurId: c?.fournisseur_id ?? null,
      fournisseurNom: nom,
      texte,
    });
  }

  return resultat;
}

/**
 * Indexe les lignes d'un ou plusieurs devis.
 *
 * Les lignes déjà vectorisées sont ignorées : l'appel est donc rejouable, ce
 * qui compte pour un rattrapage interrompu à mi-course.
 */
export async function indexerDevis(
  tenant: string,
  devisIds: number[],
): Promise<ResultatIndexation> {
  if (!embeddingsConfigures()) {
    console.warn('[indexation] GEMINI_API_KEY absente : historique non vectorisé.');
    return { indexees: 0, ignorees: 0, echecs: 0 };
  }

  const db = clientAdmin();
  const candidates = await resoudreLignes(tenant, devisIds);
  if (candidates.length === 0) return { indexees: 0, ignorees: 0, echecs: 0 };

  // On ne saute que les lignes vectorisées PAR LE MODÈLE COURANT. Deux modèles
  // différents ne produisent pas des vecteurs comparables : garder les anciens
  // reviendrait à mesurer des distances entre espaces sans rapport, et le
  // classement serait faux sans que rien ne le signale.
  const { data: deja } = await db
    .from('fournisseur_embeddings')
    .select('ligne_devis_id')
    .eq('modele', MODELE_EMBEDDING)
    .in(
      'ligne_devis_id',
      candidates.map((c) => c.ligneDevisId),
    );

  const vues = new Set((deja ?? []).map((d) => d.ligne_devis_id));
  const aFaire = candidates.filter((c) => !vues.has(c.ligneDevisId));

  if (aFaire.length === 0) {
    return { indexees: 0, ignorees: candidates.length, echecs: 0 };
  }

  let echecs = 0;

  const vecteurs = await embedderLot(
    aFaire.map((l) => l.texte),
    (index, erreur) => {
      echecs += 1;
      console.error(
        `[indexation] ligne ${aFaire[index]?.ligneDevisId} : ${erreur instanceof Error ? erreur.message : erreur}`,
      );
    },
  );

  const lignes = aFaire
    .map((l, i) => ({ ligne: l, vecteur: vecteurs[i] }))
    .filter((x): x is { ligne: LigneAIndexer; vecteur: number[] } => x.vecteur !== null)
    .map(({ ligne, vecteur }) => ({
      tenant_id: tenant,
      ligne_devis_id: ligne.ligneDevisId,
      fournisseur_id: ligne.fournisseurId,
      fournisseur_nom: ligne.fournisseurNom,
      texte: ligne.texte,
      embedding: JSON.stringify(vecteur),
      modele: MODELE_EMBEDDING,
    }));

  if (lignes.length === 0) {
    return { indexees: 0, ignorees: candidates.length - aFaire.length, echecs };
  }

  // `upsert` sur la contrainte d'unicité : deux rattrapages concurrents ne
  // doivent pas doubler le poids d'une ligne dans le classement.
  const { error } = await db
    .from('fournisseur_embeddings')
    .upsert(lignes, { onConflict: 'ligne_devis_id' });

  if (error) {
    console.error(`[indexation] écriture impossible : ${error.message}`);
    return { indexees: 0, ignorees: candidates.length - aFaire.length, echecs: aFaire.length };
  }

  return {
    indexees: lignes.length,
    ignorees: candidates.length - aFaire.length,
    echecs,
  };
}

/**
 * Vecteurs produits par un modèle qui n'est plus celui en vigueur.
 *
 * Ils ne sont pas comparables aux nouveaux : les laisser en base fausserait
 * silencieusement tout classement mêlant les deux générations.
 */
export async function compterVecteursPerimes(tenant: string): Promise<number> {
  const { count } = await clientAdmin()
    .from('fournisseur_embeddings')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant)
    .neq('modele', MODELE_EMBEDDING);

  return count ?? 0;
}

/**
 * Rattrape tout l'historique non encore vectorisé par le modèle courant.
 *
 * Sert au premier remplissage et après un changement de modèle. Séquentiel par
 * construction — voir `embedderLot` — donc lent sur un gros historique, mais
 * lancé à la main et rejouable sans dégât.
 *
 * Les vecteurs d'un ancien modèle sont supprimés AVANT recalcul plutôt qu'après
 * : une interruption laisserait sinon coexister deux générations, et un
 * classement mêlant des espaces vectoriels différents est faux sans le dire.
 * Mieux vaut un index temporairement incomplet, qui ne remonte rien, qu'un
 * index qui remonte n'importe quoi.
 */
export async function indexerHistorique(tenant: string): Promise<ResultatIndexation> {
  const db = clientAdmin();

  const perimes = await compterVecteursPerimes(tenant);

  if (perimes > 0) {
    console.info(
      `[indexation] ${perimes} vecteur(s) d'un modèle antérieur : suppression avant recalcul.`,
    );

    const { error } = await db
      .from('fournisseur_embeddings')
      .delete()
      .eq('tenant_id', tenant)
      .neq('modele', MODELE_EMBEDDING);

    if (error) {
      throw new Error(`Purge des vecteurs périmés impossible : ${error.message}`);
    }
  }

  const { data: devis } = await db
    .from('devis_fournisseur')
    .select('id')
    .eq('tenant_id', tenant);

  return indexerDevis(
    tenant,
    (devis ?? []).map((d) => d.id),
  );
}
