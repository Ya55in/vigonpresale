'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ErreurAutorisation, requirePermissionApi } from '@/lib/auth/guards';
import { STATUTS_SAV } from '@/lib/sav/requetes';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat =
  | { ok: true; message: string }
  | { ok: false; message: string };

function enEchec(e: unknown): Resultat {
  if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
  console.error('[sav] action en échec', e);
  return { ok: false, message: "L'opération a échoué. Réessayez." };
}

/**
 * Numéro du ticket, séquentiel par tenant et par année.
 *
 * `gen_code` sert aux demandes et aux offres, mais avec des séquences déclarées
 * en base qu'on ne peut pas ajouter ici sans migration. On compte donc les
 * tickets de l'année : l'index unique `(tenant_id, numero)` rattrape une
 * collision improbable entre deux créations simultanées, et l'utilisateur
 * réessaie.
 */
async function prochainNumero(tenant: string): Promise<string> {
  const annee = new Date().getFullYear();

  const { count } = await createAdminClient()
    .from('tickets_sav')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant)
    .gte('date_ouverture', `${annee}-01-01`);

  return `SAV-${annee}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}

const ouvertureSchema = z.object({
  objet: z.string().trim().min(1, "L'objet est obligatoire.").max(300),
  description: z.string().trim().max(5_000).optional().default(''),
  demandeId: z.coerce.number().int().positive().optional(),
  priorite: z.enum(['basse', 'normale', 'haute', 'critique']).optional().default('normale'),
});

/**
 * Ouvre un ticket de support.
 *
 * Le rattachement à une affaire est facultatif : un client peut appeler pour un
 * matériel livré il y a deux ans, dont la demande d'origine n'existe plus dans
 * la plateforme. Exiger le lien empêcherait d'enregistrer l'appel.
 */
export async function ouvrirTicket(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('dashboard.apres_vente');

    const parse = ouvertureSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return {
        ok: false,
        message: parse.error.issues[0]?.message ?? 'Données invalides.',
      };
    }

    const db = createAdminClient();
    let clientId: number | null = null;

    // Le client est repris de la demande, jamais saisi : deux sources
    // divergeraient dès la première correction sur la fiche client.
    if (parse.data.demandeId) {
      const { data: demande } = await db
        .from('demandes')
        .select('id, client_id')
        .eq('id', parse.data.demandeId)
        .eq('tenant_id', utilisateur.tenant_id)
        .maybeSingle();

      if (!demande) return { ok: false, message: 'Affaire introuvable.' };
      clientId = demande.client_id;
    }

    const numero = await prochainNumero(utilisateur.tenant_id);

    const { data: ticket, error } = await db
      .from('tickets_sav')
      .insert({
        tenant_id: utilisateur.tenant_id,
        demande_id: parse.data.demandeId ?? null,
        client_id: clientId,
        numero,
        objet: parse.data.objet,
        description: parse.data.description || null,
        priorite: parse.data.priorite,
        statut: 'en_cours',
        ouvert_par: utilisateur.id,
      })
      .select('id')
      .single();

    if (error || !ticket) {
      // La collision de numéro est le cas attendu : deux ouvertures
      // simultanées. Le message invite à refaire, ce qui produira le suivant.
      console.error('[sav] ouverture impossible', error?.message);
      return { ok: false, message: 'Ouverture impossible. Réessayez.' };
    }

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'tickets_sav',
      entite_id: ticket.id,
      action: 'sav.ticket_ouvert',
      details: { numero, objet: parse.data.objet, priorite: parse.data.priorite },
    });

    revalidatePath('/apres-vente');
    return { ok: true, message: `${numero} ouvert.` };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Fait avancer un ticket.
 *
 * `date_traitement` n'est posée qu'au passage à « traité », et effacée si le
 * ticket rouvre : sans quoi le délai de traitement afficherait celui d'une
 * résolution qui n'a pas tenu.
 */
export async function changerStatutTicket(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('dashboard.apres_vente');

    const parse = z
      .object({
        id: z.coerce.number().int().positive(),
        statut: z.enum(STATUTS_SAV),
        resolution: z.string().trim().max(2_000).optional().default(''),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const traite = parse.data.statut === 'traite';

    const { data, error } = await createAdminClient()
      .from('tickets_sav')
      .update({
        statut: parse.data.statut,
        date_traitement: traite ? new Date().toISOString() : null,
        resolution: parse.data.resolution || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parse.data.id)
      .eq('tenant_id', utilisateur.tenant_id)
      .select('numero')
      .maybeSingle();

    if (error) return { ok: false, message: error.message };
    if (!data) return { ok: false, message: 'Ticket introuvable.' };

    revalidatePath('/apres-vente');
    return {
      ok: true,
      message: traite ? `${data.numero} clos.` : `${data.numero} rouvert.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}
