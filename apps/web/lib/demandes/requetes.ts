import { createAdminClient } from '@/lib/supabase/admin';
import type { ProfilUtilisateur } from '@/lib/auth/session';
import type { Tables } from '@/lib/supabase/types';
import { estStatutValide, type StatutDemande } from '@/lib/demandes/statuts';

export const TAILLE_PAGE = 20;

/**
 * Statuts visibles par AFTER_SALES.
 *
 * Sa permission est `demande.voir_gagnees` : il ne doit jamais voir une demande
 * en cours de traitement. Le filtre est appliqué en base, pas après lecture.
 */
const STATUTS_APRES_VENTE: StatutDemande[] = ['gagnee'];

export type LigneListe = Pick<
  Tables<'demandes'>,
  | 'id'
  | 'code'
  | 'titre'
  | 'statut'
  | 'deadline'
  | 'date_reception'
  | 'email_client'
  | 'source'
> & {
  client: { nom: string } | null;
  nb_articles: number;
};

export type FiltresListe = {
  recherche: string;
  statut: StatutDemande | null;
  tri: 'recent' | 'ancien' | 'deadline';
  page: number;
};

/** Normalise les paramètres d'URL : toute valeur inattendue retombe au défaut. */
export function lireFiltres(
  params: Record<string, string | string[] | undefined>,
): FiltresListe {
  const seul = (v: string | string[] | undefined): string =>
    (Array.isArray(v) ? v[0] : v) ?? '';

  const statut = seul(params.statut);
  const tri = seul(params.tri);
  const page = Number.parseInt(seul(params.page), 10);

  return {
    recherche: seul(params.q).trim().slice(0, 100),
    statut: estStatutValide(statut) ? statut : null,
    tri: tri === 'ancien' || tri === 'deadline' ? tri : 'recent',
    page: Number.isFinite(page) && page > 1 ? page : 1,
  };
}

/**
 * Liste paginée des demandes du périmètre de l'utilisateur.
 *
 * Le filtre `tenant_id` est systématique : le client service role contourne RLS,
 * les policies ne sont qu'une seconde barrière.
 */
export async function listerDemandes(
  utilisateur: ProfilUtilisateur,
  filtres: FiltresListe,
): Promise<{ lignes: LigneListe[]; total: number }> {
  const db = createAdminClient();

  let requete = db
    .from('demandes')
    .select(
      'id, code, titre, statut, source, deadline, date_reception, email_client, clients(nom), demande_items(count)',
      { count: 'exact' },
    )
    .eq('tenant_id', utilisateur.tenant_id);

  if (utilisateur.role === 'after_sales') {
    requete = requete.in('statut', STATUTS_APRES_VENTE);
  }

  if (filtres.statut) {
    requete = requete.eq('statut', filtres.statut);
  }

  if (filtres.recherche) {
    // Échappe les caractères de motif : une virgule casserait la syntaxe `or`.
    const motif = `%${filtres.recherche.replace(/[%,()]/g, ' ')}%`;
    requete = requete.or(
      `code.ilike.${motif},titre.ilike.${motif},email_client.ilike.${motif}`,
    );
  }

  requete =
    filtres.tri === 'ancien'
      ? requete.order('date_reception', { ascending: true, nullsFirst: false })
      : filtres.tri === 'deadline'
        ? requete.order('deadline', { ascending: true, nullsFirst: false })
        : requete.order('date_reception', { ascending: false, nullsFirst: false });

  const debut = (filtres.page - 1) * TAILLE_PAGE;
  const { data, count, error } = await requete.range(debut, debut + TAILLE_PAGE - 1);

  if (error) {
    throw new Error(`Lecture des demandes impossible : ${error.message}`);
  }

  const lignes: LigneListe[] = (data ?? []).map((d) => ({
    id: d.id,
    code: d.code,
    titre: d.titre,
    statut: d.statut,
    source: d.source,
    deadline: d.deadline,
    date_reception: d.date_reception,
    email_client: d.email_client,
    client: Array.isArray(d.clients) ? (d.clients[0] ?? null) : d.clients,
    nb_articles: Array.isArray(d.demande_items)
      ? (d.demande_items[0]?.count ?? 0)
      : 0,
  }));

  return { lignes, total: count ?? 0 };
}

export type DemandeDetail = Tables<'demandes'> & {
  client: Tables<'clients'> | null;
};

/**
 * Demande complète, ou null si hors périmètre.
 *
 * Renvoyer null plutôt que de lever : l'appelant affiche un 404, ce qui ne
 * révèle pas l'existence d'une demande d'un autre tenant.
 */
export async function lireDemande(
  utilisateur: ProfilUtilisateur,
  id: number,
): Promise<DemandeDetail | null> {
  const db = createAdminClient();

  let requete = db
    .from('demandes')
    .select('*, clients(*)')
    .eq('tenant_id', utilisateur.tenant_id)
    .eq('id', id);

  if (utilisateur.role === 'after_sales') {
    requete = requete.in('statut', STATUTS_APRES_VENTE);
  }

  const { data, error } = await requete.maybeSingle();

  if (error) {
    throw new Error(`Lecture de la demande impossible : ${error.message}`);
  }
  if (!data) return null;

  const { clients, ...demande } = data;
  return {
    ...demande,
    client: Array.isArray(clients) ? (clients[0] ?? null) : clients,
  };
}

export async function listerArticles(
  demandeId: number,
): Promise<Tables<'demande_items'>[]> {
  const { data, error } = await createAdminClient()
    .from('demande_items')
    .select('*')
    .eq('demande_id', demandeId)
    .order('ligne_num', { ascending: true });

  if (error) {
    throw new Error(`Lecture des articles impossible : ${error.message}`);
  }
  return data ?? [];
}

export type PieceJointeListe = Pick<
  Tables<'pieces_jointes'>,
  'id' | 'nom_fichier' | 'mime_type' | 'taille_octets' | 'est_archive' |
  'parent_archive_id' | 'statut_extraction' | 'erreur_extraction' | 'storage_path'
>;

export async function listerPiecesJointes(
  demandeId: number,
): Promise<PieceJointeListe[]> {
  const { data, error } = await createAdminClient()
    .from('pieces_jointes')
    .select(
      'id, nom_fichier, mime_type, taille_octets, est_archive, parent_archive_id, statut_extraction, erreur_extraction, storage_path',
    )
    .eq('demande_id', demandeId)
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Lecture des pièces jointes impossible : ${error.message}`);
  }
  return data ?? [];
}
