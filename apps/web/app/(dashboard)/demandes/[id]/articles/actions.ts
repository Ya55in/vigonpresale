'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requirePermissionApi, ErreurAutorisation } from '@/lib/auth/guards';
import type { ProfilUtilisateur } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat = { ok: true } | { ok: false; message: string };

const texteOuNull = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === '' ? null : v));

const articleSchema = z.object({
  id: z.coerce.number().int().positive(),
  demandeId: z.coerce.number().int().positive(),
  designation: z.string().trim().min(1, 'La désignation est obligatoire.').max(500),
  reference: texteOuNull,
  marque: z.string().trim().min(1, 'La marque est obligatoire.').max(200),
  quantite: z.coerce
    .number({ invalid_type_error: 'La quantité doit être un nombre.' })
    .positive('La quantité doit être supérieure à 0.'),
  unite: z.string().trim().min(1).max(50),
  categorie: texteOuNull,
  specifications: texteOuNull,
});

const ajoutSchema = articleSchema.omit({ id: true });

/**
 * Vérifie que la demande appartient bien au tenant de l'utilisateur.
 *
 * Sans ce contrôle, un identifiant forgé permettrait d'écrire dans la demande
 * d'un autre tenant : le client service role contourne RLS.
 */
async function demandeDuTenant(
  utilisateur: ProfilUtilisateur,
  demandeId: number,
): Promise<{ code: string; statut: string } | null> {
  const { data } = await createAdminClient()
    .from('demandes')
    .select('code, statut')
    .eq('id', demandeId)
    .eq('tenant_id', utilisateur.tenant_id)
    .maybeSingle();

  return data;
}

/** Vérifie qu'un article appartient bien à la demande visée. */
async function articleDeLaDemande(
  articleId: number,
  demandeId: number,
): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('demande_items')
    .select('id')
    .eq('id', articleId)
    .eq('demande_id', demandeId)
    .maybeSingle();

  return Boolean(data);
}

async function auditer(
  utilisateur: ProfilUtilisateur,
  action: string,
  entiteId: number,
  details: Record<string, unknown>,
): Promise<void> {
  await createAdminClient().from('audit_events').insert({
    tenant_id: utilisateur.tenant_id,
    user_id: utilisateur.id,
    entite: 'demande_items',
    entite_id: entiteId,
    action,
    details: JSON.parse(JSON.stringify(details)),
  });
}

/** Transforme une erreur en message affichable, sans fuiter de détail interne. */
function enEchec(e: unknown): Resultat {
  if (e instanceof ErreurAutorisation) {
    return { ok: false, message: e.message };
  }
  console.error('[articles] action en échec', e);
  return { ok: false, message: "L'opération a échoué. Réessayez." };
}

export async function modifierArticle(
  _etatPrecedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('article.modifier');

    const parse = articleSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return {
        ok: false,
        message: parse.error.issues[0]?.message ?? 'Données invalides.',
      };
    }
    const { id, demandeId, ...champs } = parse.data;

    if (!(await demandeDuTenant(utilisateur, demandeId))) {
      return { ok: false, message: 'Demande introuvable.' };
    }
    if (!(await articleDeLaDemande(id, demandeId))) {
      return { ok: false, message: 'Article introuvable.' };
    }

    const db = createAdminClient();
    const { data: avant } = await db
      .from('demande_items')
      .select(
        'designation, reference, marque, quantite, unite, categorie, specifications, valide_at',
      )
      .eq('id', id)
      .single();

    // Modifier un article annule sa validation : sans cela, la ligne
    // affirmerait qu'un humain a relu un contenu qui a changé depuis.
    const { error } = await db
      .from('demande_items')
      .update({ ...champs, valide_par: null, valide_at: null })
      .eq('id', id);
    if (error) return { ok: false, message: error.message };

    await auditer(utilisateur, 'article.modifie', id, {
      demande_id: demandeId,
      avant,
      apres: champs,
      validation_annulee: Boolean(avant?.valide_at),
    });

    revalidatePath(`/demandes/${demandeId}/articles`);
    return { ok: true };
  } catch (e) {
    return enEchec(e);
  }
}

export async function ajouterArticle(
  _etatPrecedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('article.modifier');

    const parse = ajoutSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return {
        ok: false,
        message: parse.error.issues[0]?.message ?? 'Données invalides.',
      };
    }
    const { demandeId, ...champs } = parse.data;

    if (!(await demandeDuTenant(utilisateur, demandeId))) {
      return { ok: false, message: 'Demande introuvable.' };
    }

    const db = createAdminClient();

    // Se place en fin de liste : la numérotation reste continue même après
    // des suppressions.
    const { data: derniere } = await db
      .from('demande_items')
      .select('ligne_num')
      .eq('demande_id', demandeId)
      .order('ligne_num', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: cree, error } = await db
      .from('demande_items')
      .insert({
        demande_id: demandeId,
        ligne_num: (derniere?.ligne_num ?? 0) + 1,
        // Saisi par un humain : la notion de confiance du modèle ne s'applique pas.
        confiance_ia: null,
        ...champs,
      })
      .select('id')
      .single();

    if (error) return { ok: false, message: error.message };

    await auditer(utilisateur, 'article.ajoute', cree.id, {
      demande_id: demandeId,
      ...champs,
    });

    revalidatePath(`/demandes/${demandeId}/articles`);
    return { ok: true };
  } catch (e) {
    return enEchec(e);
  }
}

export async function supprimerArticle(
  _etatPrecedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('article.modifier');

    const parse = z
      .object({
        id: z.coerce.number().int().positive(),
        demandeId: z.coerce.number().int().positive(),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };
    const { id, demandeId } = parse.data;

    if (!(await demandeDuTenant(utilisateur, demandeId))) {
      return { ok: false, message: 'Demande introuvable.' };
    }
    if (!(await articleDeLaDemande(id, demandeId))) {
      return { ok: false, message: 'Article introuvable.' };
    }

    const db = createAdminClient();
    const { data: avant } = await db
      .from('demande_items')
      .select('*')
      .eq('id', id)
      .single();

    const { error } = await db.from('demande_items').delete().eq('id', id);
    if (error) return { ok: false, message: error.message };

    await auditer(utilisateur, 'article.supprime', id, {
      demande_id: demandeId,
      supprime: avant,
    });

    revalidatePath(`/demandes/${demandeId}/articles`);
    return { ok: true };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Valide l'ensemble des articles : ils sont dès lors considérés relus par un
 * humain, ce qui autorise la suite du flux (recherche fournisseurs).
 */
export async function validerArticles(
  _etatPrecedent: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('article.valider');

    const parse = z
      .object({ demandeId: z.coerce.number().int().positive() })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };
    const { demandeId } = parse.data;

    const demande = await demandeDuTenant(utilisateur, demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    const db = createAdminClient();

    const { data: articles } = await db
      .from('demande_items')
      .select('id')
      .eq('demande_id', demandeId);

    if (!articles || articles.length === 0) {
      return {
        ok: false,
        message: 'Ajoutez au moins un article avant de valider.',
      };
    }

    const { error } = await db
      .from('demande_items')
      .update({ valide_par: utilisateur.id, valide_at: new Date().toISOString() })
      .eq('demande_id', demandeId);

    if (error) return { ok: false, message: error.message };

    await createAdminClient().from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'demandes',
      entite_id: demandeId,
      action: 'articles.valides',
      details: { code: demande.code, articles: articles.length },
    });

    revalidatePath(`/demandes/${demandeId}/articles`);
    revalidatePath(`/demandes/${demandeId}`);
    return { ok: true };
  } catch (e) {
    return enEchec(e);
  }
}
