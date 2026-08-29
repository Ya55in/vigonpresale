import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Tickets du service après-vente.
 *
 * L'écran après-vente listait les affaires gagnées : une lecture, pas un suivi.
 * Un ticket porte l'état d'avancement que la spec demande, et se rattache à la
 * demande d'origine plutôt qu'à l'offre — un client rappelle pour un projet, pas
 * pour un numéro d'offre, et une affaire peut avoir plusieurs versions d'offre
 * dont une seule a été signée.
 */

export const STATUTS_SAV = ['en_cours', 'traite', 'rouvert'] as const;
export type StatutSav = (typeof STATUTS_SAV)[number];

export const LIBELLES_STATUT_SAV: Record<StatutSav, string> = {
  en_cours: 'En cours',
  traite: 'Traité',
  rouvert: 'Rouvert',
};

export const PRIORITES_SAV = ['basse', 'normale', 'haute', 'critique'] as const;
export type PrioriteSav = (typeof PRIORITES_SAV)[number];

export const LIBELLES_PRIORITE_SAV: Record<PrioriteSav, string> = {
  basse: 'Basse',
  normale: 'Normale',
  haute: 'Haute',
  critique: 'Critique',
};

export type TicketSav = {
  id: number;
  numero: string;
  objet: string;
  description: string | null;
  statut: StatutSav;
  priorite: PrioriteSav;
  clientNom: string | null;
  demandeId: number | null;
  demandeCode: string | null;
  dateOuverture: string;
  dateTraitement: string | null;
  resolution: string | null;
};

const estStatut = (v: unknown): v is StatutSav =>
  typeof v === 'string' && (STATUTS_SAV as readonly string[]).includes(v);

const estPriorite = (v: unknown): v is PrioriteSav =>
  typeof v === 'string' && (PRIORITES_SAV as readonly string[]).includes(v);

/**
 * Tickets du tenant, les non traités d'abord.
 *
 * Un ticket traité reste visible : c'est l'historique du support sur une
 * affaire, et le masquer priverait l'après-vente du contexte au prochain appel
 * du même client.
 */
export async function lireTickets(tenant: string): Promise<TicketSav[]> {
  const { data, error } = await createAdminClient()
    .from('tickets_sav')
    .select(
      'id, numero, objet, description, statut, priorite, demande_id, date_ouverture, date_traitement, resolution, clients(nom), demandes(code)',
    )
    .eq('tenant_id', tenant)
    .order('date_ouverture', { ascending: false });

  if (error) {
    console.error(`[sav] lecture impossible : ${error.message}`);
    return [];
  }

  const tickets = (data ?? []).map((t) => {
    const client = Array.isArray(t.clients) ? t.clients[0] : t.clients;
    const demande = Array.isArray(t.demandes) ? t.demandes[0] : t.demandes;

    return {
      id: t.id,
      numero: t.numero,
      objet: t.objet,
      description: t.description,
      // Les contraintes en base garantissent ces valeurs, mais le type généré
      // les donne en `string` : on referme plutôt que de forcer le cast.
      statut: estStatut(t.statut) ? t.statut : 'en_cours',
      priorite: estPriorite(t.priorite) ? t.priorite : 'normale',
      clientNom: client?.nom ?? null,
      demandeId: t.demande_id,
      demandeCode: demande?.code ?? null,
      dateOuverture: t.date_ouverture,
      dateTraitement: t.date_traitement,
      resolution: t.resolution,
    } satisfies TicketSav;
  });

  // Les tickets ouverts remontent, priorité décroissante : c'est la file de
  // travail. Le tri se fait ici et non en SQL, l'ordre des priorités n'étant
  // pas alphabétique.
  const rang: Record<PrioriteSav, number> = { critique: 0, haute: 1, normale: 2, basse: 3 };

  return tickets.sort((a, b) => {
    const aOuvert = a.statut !== 'traite';
    const bOuvert = b.statut !== 'traite';
    if (aOuvert !== bOuvert) return aOuvert ? -1 : 1;
    if (aOuvert) return rang[a.priorite] - rang[b.priorite];
    return 0;
  });
}

/** Affaires gagnées, pour rattacher un ticket à son projet. */
export async function lireAffairesGagnees(
  tenant: string,
): Promise<{ id: number; code: string; titre: string | null; clientId: number | null }[]> {
  const { data } = await createAdminClient()
    .from('demandes')
    .select('id, code, titre, client_id')
    .eq('tenant_id', tenant)
    .eq('statut', 'gagnee')
    .order('date_decision', { ascending: false });

  return (data ?? []).map((d) => ({
    id: d.id,
    code: d.code,
    titre: d.titre,
    clientId: d.client_id,
  }));
}
