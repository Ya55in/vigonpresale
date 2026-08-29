import { createAdminClient } from '@/lib/supabase/admin';
import type { Enums, Tables } from '@/lib/supabase/types';

export type StatutConsultation = Enums<'statut_consultation'>;

type Apparence = 'default' | 'secondary' | 'succes' | 'attention' | 'info' | 'neutre';

export const STATUTS_CONSULTATION: Record<
  StatutConsultation,
  { libelle: string; apparence: Apparence }
> = {
  brouillon: { libelle: 'Brouillon', apparence: 'neutre' },
  en_validation: { libelle: 'À valider', apparence: 'attention' },
  planifiee: { libelle: 'Planifiée', apparence: 'info' },
  envoyee: { libelle: 'Envoyée', apparence: 'info' },
  relancee: { libelle: 'Relancée', apparence: 'attention' },
  devis_recu: { libelle: 'Devis reçu', apparence: 'succes' },
  precision_demandee: { libelle: 'Précision demandée', apparence: 'attention' },
  sans_reponse: { libelle: 'Sans réponse', apparence: 'secondary' },
  abandonnee: { libelle: 'Exclue', apparence: 'secondary' },
};

export type ConsultationListe = Pick<
  Tables<'consultations'>,
  | 'id'
  | 'marque'
  | 'fournisseur_nom'
  | 'fournisseur_email'
  | 'sujet'
  | 'corps_html'
  | 'corps_texte'
  | 'statut'
  | 'date_envoi_prevue'
  | 'date_envoi_reelle'
  | 'relances'
>;

export async function listerConsultations(
  demandeId: number,
  tenant: string,
): Promise<ConsultationListe[]> {
  const { data, error } = await createAdminClient()
    .from('consultations')
    .select(
      'id, marque, fournisseur_nom, fournisseur_email, sujet, corps_html, corps_texte, statut, date_envoi_prevue, date_envoi_reelle, relances',
    )
    .eq('demande_id', demandeId)
    .eq('tenant_id', tenant)
    .order('marque', { ascending: true });

  if (error) {
    throw new Error(`Lecture des consultations impossible : ${error.message}`);
  }
  return data ?? [];
}

export type EchangeConsultation = {
  id: number;
  consultationId: number;
  direction: 'entrant' | 'sortant';
  type: string;
  sujet: string | null;
  corpsTexte: string | null;
  expediteur: string | null;
  date: string | null;
};

/**
 * Fil des échanges d'une demande, par consultation.
 *
 * Sans lui, une demande de précision oblige à quitter la plateforme pour aller
 * lire le courriel dans sa boîte, puis à répondre depuis un client de messagerie
 * — la réponse échappe alors à la traçabilité du dossier.
 *
 * Les avis de non-remise sont écartés : ce sont des incidents techniques déjà
 * signalés par une notification, pas des échanges avec le fournisseur.
 */
export async function listerEchanges(
  demandeId: number,
  tenant: string,
): Promise<Map<number, EchangeConsultation[]>> {
  const { data, error } = await createAdminClient()
    .from('communications')
    .select('id, consultation_id, direction, type, sujet, corps_texte, expediteur, date_envoi, created_at')
    .eq('demande_id', demandeId)
    .eq('tenant_id', tenant)
    .not('consultation_id', 'is', null)
    .neq('type', 'rebond')
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Lecture des échanges impossible : ${error.message}`);
  }

  const parConsultation = new Map<number, EchangeConsultation[]>();

  for (const c of data ?? []) {
    if (c.consultation_id === null) continue;

    const echange: EchangeConsultation = {
      id: c.id,
      consultationId: c.consultation_id,
      direction: c.direction === 'sortant' ? 'sortant' : 'entrant',
      type: c.type,
      sujet: c.sujet,
      corpsTexte: c.corps_texte,
      expediteur: c.expediteur,
      date: c.date_envoi ?? c.created_at,
    };

    const liste = parConsultation.get(c.consultation_id) ?? [];
    liste.push(echange);
    parConsultation.set(c.consultation_id, liste);
  }

  return parConsultation;
}

/**
 * Marques des articles sans consultation préparée.
 *
 * Se calcule à la lecture plutôt que d'être stocké : la liste bouge dès qu'un
 * article est corrigé ou qu'un fournisseur est ajouté, et une colonne figée
 * se désynchroniserait au premier changement.
 */
export async function marquesSansConsultation(
  demandeId: number,
  tenant: string,
): Promise<string[]> {
  const db = createAdminClient();

  const [{ data: articles }, { data: consultations }] = await Promise.all([
    db.from('demande_items').select('marque').eq('demande_id', demandeId),
    db
      .from('consultations')
      .select('marque')
      .eq('demande_id', demandeId)
      .eq('tenant_id', tenant),
  ]);

  const couvertes = new Set(
    (consultations ?? [])
      .map((c) => c.marque?.toLowerCase().trim())
      .filter((m): m is string => Boolean(m)),
  );

  const manquantes = new Set<string>();
  for (const article of articles ?? []) {
    const marque = article.marque?.trim();
    if (!marque) continue;
    if (!couvertes.has(marque.toLowerCase())) manquantes.add(marque);
  }

  return [...manquantes].sort();
}
