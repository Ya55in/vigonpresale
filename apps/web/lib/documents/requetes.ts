import { contenuDocumentSchema, estStatutDocument, estTypeDocument } from '@vigon/shared';
import type { ContenuDocument, StatutDocument, TypeDocument } from '@vigon/shared';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Lectures des documents financiers.
 *
 * Le contenu servi vient **toujours** de `contenu_json`, jamais des tables
 * vivantes. C'est la raison d'être de ce module : une facture émise ne doit pas
 * changer parce qu'un prix a bougé après coup. Relire l'offre pour l'afficher
 * annulerait le gel et rendrait le document faux sans que rien ne le signale.
 */

export type DocumentFinancier = {
  id: number;
  /** Affaire d'origine, pour revenir à son écran depuis le document imprimé. */
  demandeId: number | null;
  type: TypeDocument;
  numero: string;
  statut: StatutDocument;
  devise: string;
  totalHt: number;
  totalTva: number;
  totalTtc: number;
  dateEmission: string;
  dateEcheance: string | null;
  dateReglement: string | null;
  notes: string | null;
  offreNumero: string | null;
  contenu: ContenuDocument | null;
};

/**
 * Le `contenu_json` d'une ligne déjà émise peut dater d'une version antérieure
 * du schéma. On le valide sans jamais faire échouer la lecture : un document
 * illisible doit se voir dans la liste, pas faire tomber l'écran entier.
 */
function lireContenu(brut: unknown): ContenuDocument | null {
  const parse = contenuDocumentSchema.safeParse(brut);
  return parse.success ? parse.data : null;
}

function versDocument(ligne: {
  id: number;
  demande_id: number | null;
  type: string;
  numero: string;
  statut: string;
  devise: string;
  total_ht: number;
  total_tva: number;
  total_ttc: number;
  date_emission: string;
  date_echeance: string | null;
  date_reglement: string | null;
  notes: string | null;
  contenu_json: unknown;
  offres?: { numero: string } | { numero: string }[] | null;
}): DocumentFinancier {
  const offre = Array.isArray(ligne.offres) ? ligne.offres[0] : ligne.offres;

  return {
    id: ligne.id,
    demandeId: ligne.demande_id,
    // Un type inconnu vaut mieux qu'un plantage : il vient de la base, qui
    // pourrait porter une valeur d'une version future.
    type: estTypeDocument(ligne.type) ? ligne.type : 'facture',
    numero: ligne.numero,
    statut: estStatutDocument(ligne.statut) ? ligne.statut : 'emis',
    devise: ligne.devise,
    totalHt: Number(ligne.total_ht),
    totalTva: Number(ligne.total_tva),
    totalTtc: Number(ligne.total_ttc),
    dateEmission: ligne.date_emission,
    dateEcheance: ligne.date_echeance,
    dateReglement: ligne.date_reglement,
    notes: ligne.notes,
    offreNumero: offre?.numero ?? null,
    contenu: lireContenu(ligne.contenu_json),
  };
}

const COLONNES =
  'id, demande_id, type, numero, statut, devise, total_ht, total_tva, total_ttc, date_emission, date_echeance, date_reglement, notes, contenu_json, offres(numero)';

/** Documents d'une affaire, du plus récent au plus ancien. */
export async function lireDocuments(
  tenant: string,
  demandeId: number,
): Promise<DocumentFinancier[]> {
  const { data } = await createAdminClient()
    .from('documents_financiers')
    .select(COLONNES)
    .eq('tenant_id', tenant)
    .eq('demande_id', demandeId)
    .order('date_emission', { ascending: false });

  return (data ?? []).map(versDocument);
}

/** Un document, pour son rendu imprimable. */
export async function lireDocument(
  tenant: string,
  id: number,
): Promise<DocumentFinancier | null> {
  const { data } = await createAdminClient()
    .from('documents_financiers')
    .select(COLONNES)
    .eq('tenant_id', tenant)
    .eq('id', id)
    .maybeSingle();

  return data ? versDocument(data) : null;
}

export type OffreEmettable = {
  id: number;
  numero: string;
  titre: string | null;
  dateApprobation: string | null;
};

/**
 * Offres sur lesquelles un document peut être émis.
 *
 * Le filtre est le même que celui d'`emettreDocument` — l'offre doit être
 * approuvée par le client. Le dupliquer ici sert l'affichage, pas la sécurité :
 * l'écran ne propose que ce qui passera, et le service refuse quand même si
 * l'état a changé entre l'affichage et le clic.
 */
export async function lireOffresEmettables(
  tenant: string,
  demandeId: number,
): Promise<OffreEmettable[]> {
  const { data } = await createAdminClient()
    .from('offres')
    .select('id, numero, titre, date_approbation')
    .eq('tenant_id', tenant)
    .eq('demande_id', demandeId)
    .eq('statut', 'approuvee')
    .order('date_approbation', { ascending: false });

  return (data ?? []).map((o) => ({
    id: o.id,
    numero: o.numero,
    titre: o.titre,
    dateApprobation: o.date_approbation,
  }));
}
