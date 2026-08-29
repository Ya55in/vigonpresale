import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Lecture d'une consultation par son jeton, pour le formulaire fournisseur.
 *
 * Même règle que la page offre : le fournisseur ne reçoit qu'une allowlist
 * explicite de champs, jamais la ligne complète. Le filtrage se fait ICI, avant
 * tout rendu — masquer après coup laisserait les données dans le flux envoyé au
 * navigateur.
 *
 * Ce qu'il ne doit surtout pas voir : les autres fournisseurs consultés, leurs
 * prix, la marge visée, le nom du client final. Un fournisseur qui apprend qui
 * d'autre est consulté négocie autrement.
 */

export type ArticleConsulte = {
  demandeItemId: number;
  ligneNum: number;
  designation: string;
  reference: string | null;
  marque: string | null;
  quantite: number;
  unite: string;
};

export type ConsultationPublique = {
  /** Identifiant interne, jamais rendu : il sert aux actions serveur. */
  id: number;
  tenantId: string;
  demandeId: number;
  fournisseurNom: string | null;
  marque: string | null;
  articles: ArticleConsulte[];
  /** Vrai si un devis est déjà rattaché : le formulaire passe en lecture seule. */
  dejaRepondu: boolean;
  /** Vrai tant que la consultation n'est pas partie : le lien ne doit rien ouvrir. */
  pasEncoreEnvoyee: boolean;
};

/**
 * Statuts pour lesquels le formulaire est légitimement ouvert.
 *
 * `en_validation` en est exclu : la consultation n'est pas partie, le
 * fournisseur ne peut pas détenir le lien autrement que par fuite.
 */
const STATUTS_OUVERTS = [
  'envoyee',
  'relancee',
  'precision_demandee',
  'devis_recu',
  'sans_reponse',
];

export async function lireConsultationPublique(
  token: string,
): Promise<ConsultationPublique | null> {
  // Un jeton court ou vide ne peut pas être valide : on évite la requête.
  if (!token || token.length < 20) return null;

  const db = createAdminClient();

  const { data, error } = await db
    .from('consultations')
    .select('id, tenant_id, demande_id, fournisseur_nom, marque, statut')
    .eq('token_public', token)
    .maybeSingle();

  // Sans ce log, un jeton valide rejeté pour une raison technique donne le même
  // 404 qu'un jeton inconnu — indiagnosticable en production.
  if (error) {
    console.error('[consultation publique] lecture impossible', {
      message: error.message,
      details: error.details,
    });
    return null;
  }

  if (!data) return null;

  const pasEncoreEnvoyee = !STATUTS_OUVERTS.includes(data.statut);

  const { data: devis } = await db
    .from('devis_fournisseur')
    .select('id')
    .eq('consultation_id', data.id)
    .maybeSingle();

  // Les articles réellement consultés, pas toute la demande : une consultation
  // ne porte que sur les articles d'une marque.
  const { data: liens } = await db
    .from('consultation_items')
    .select('demande_item_id')
    .eq('consultation_id', data.id);

  const identifiants = (liens ?? [])
    .map((l) => l.demande_item_id)
    .filter((v): v is number => v !== null);

  const { data: articles } = identifiants.length
    ? await db
        .from('demande_items')
        .select('id, ligne_num, designation, reference, marque, quantite, unite')
        .in('id', identifiants)
        .order('ligne_num', { ascending: true })
    : { data: [] };

  return {
    id: data.id,
    tenantId: data.tenant_id,
    demandeId: data.demande_id,
    fournisseurNom: data.fournisseur_nom,
    marque: data.marque,
    dejaRepondu: devis !== null,
    pasEncoreEnvoyee,
    articles: (articles ?? []).map((a) => ({
      demandeItemId: a.id,
      ligneNum: a.ligne_num,
      designation: a.designation,
      reference: a.reference,
      marque: a.marque,
      quantite: Number(a.quantite),
      unite: a.unite,
    })),
  };
}
