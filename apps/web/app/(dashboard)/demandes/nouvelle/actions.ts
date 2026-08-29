'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { genererCode } from '@vigon/services';

import { ErreurAutorisation, requirePermissionApi } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat =
  | { ok: true; message: string; demandeId: number }
  | { ok: false; message: string };

const texte = (max: number) => z.string().trim().min(1).max(max);

/**
 * Une ligne d'article saisie à la main.
 *
 * `reference` reste facultative : le constructeur n'est pas toujours connu au
 * moment où l'opportunité est ouverte, et bloquer là-dessus reviendrait à
 * inventer une référence pour passer l'écran.
 */
const articleSchema = z.object({
  designation: texte(300),
  reference: z.string().trim().max(120).optional().default(''),
  marque: z.string().trim().max(120).optional().default(''),
  quantite: z.coerce.number().int().positive().max(100_000),
  unite: z.string().trim().max(20).optional().default('u'),
});

const demandeSchema = z.object({
  clientNom: texte(200),
  clientEmail: z.union([z.literal(''), z.string().trim().email()]).optional(),
  titre: texte(300),
  description: z.string().trim().max(5_000).optional().default(''),
  deadline: z.string().trim().optional().default(''),
  // Distingue le projet ouvert en interne du cahier des charges déposé. La
  // valeur vient d'une liste fermée à l'écran, mais elle transite par un
  // formulaire : on la revalide plutôt que de la croire.
  source: z.enum(['interne', 'cps']).optional().default('interne'),
  articles: z.array(articleSchema).min(1, 'Au moins un article est requis.'),
});

/**
 * Crée une demande à la main, articles compris.
 *
 * Deuxième porte d'entrée du flux, à côté de la boîte e-mail : une opportunité
 * naît souvent d'un appel ou d'une réunion, sans message à extraire. Les
 * articles étant saisis par un humain, l'extraction IA est sautée — mais la
 * demande entre en `specs_extraites`, donc au même point du tunnel qu'une
 * demande reçue par mail. Un seul chemin de validation à raisonner ensuite.
 */
export async function creerDemandeManuelle(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('demande.creer');

    const brutArticles = donnees.get('articles');
    let articles: unknown = [];
    try {
      articles = JSON.parse(typeof brutArticles === 'string' ? brutArticles : '[]');
    } catch {
      return { ok: false, message: 'Liste des articles illisible.' };
    }

    const parse = demandeSchema.safeParse({
      clientNom: donnees.get('clientNom'),
      clientEmail: donnees.get('clientEmail') ?? '',
      titre: donnees.get('titre'),
      description: donnees.get('description') ?? '',
      deadline: donnees.get('deadline') ?? '',
      source: donnees.get('source') ?? 'interne',
      articles,
    });

    if (!parse.success) {
      const premier = parse.error.issues[0];
      return {
        ok: false,
        message: premier
          ? `${premier.path.join('.') || 'Formulaire'} : ${premier.message}`
          : 'Données invalides.',
      };
    }

    const { clientNom, clientEmail, titre, description, deadline, source } = parse.data;

    if (deadline && Number.isNaN(new Date(deadline).getTime())) {
      return { ok: false, message: 'Date limite invalide.' };
    }

    const db = createAdminClient();
    const tenant = utilisateur.tenant_id;

    // Client rattaché par son nom : évite de créer un doublon à chaque demande
    // ouverte pour un compte déjà connu.
    const { data: existant } = await db
      .from('clients')
      .select('id')
      .eq('tenant_id', tenant)
      .ilike('nom', clientNom)
      .limit(1)
      .maybeSingle();

    let clientId = existant?.id ?? null;

    if (!clientId) {
      const { data: cree, error: erreurClient } = await db
        .from('clients')
        .insert({
          tenant_id: tenant,
          nom: clientNom,
          email_principal: clientEmail || null,
        })
        .select('id')
        .single();

      if (erreurClient) {
        return { ok: false, message: `Client : ${erreurClient.message}` };
      }
      clientId = cree.id;
    }

    const code = await genererCode('DM', 'seq_demande');

    const { data: demande, error: erreurDemande } = await db
      .from('demandes')
      .insert({
        tenant_id: tenant,
        code,
        client_id: clientId,
        titre,
        description: description || null,
        email_client: clientEmail || null,
        deadline: deadline || null,
        source,
        statut: 'specs_extraites',
        presale_id: utilisateur.id,
        owner_id: utilisateur.id,
        date_extraction: new Date().toISOString(),
      })
      .select('id, code')
      .single();

    if (erreurDemande) {
      return { ok: false, message: `Demande : ${erreurDemande.message}` };
    }

    const lignes = parse.data.articles.map((article, index) => ({
      demande_id: demande.id,
      ligne_num: index + 1,
      designation: article.designation,
      reference: article.reference || null,
      marque: article.marque || null,
      quantite: article.quantite,
      unite: article.unite || 'u',
      // Saisie humaine : aucune confiance de modèle à reporter.
      confiance_ia: null,
    }));

    const { error: erreurArticles } = await db.from('demande_items').insert(lignes);

    if (erreurArticles) {
      // La demande sans ses articles ne mènerait nulle part : on la retire
      // plutôt que de laisser une coquille vide dans la liste.
      await db.from('demandes').delete().eq('id', demande.id);
      return { ok: false, message: `Articles : ${erreurArticles.message}` };
    }

    // Cahier des charges facultatif. Un dépôt en échec ne perd pas la demande
    // déjà créée : on le signale et l'utilisateur rattachera le document plus
    // tard, plutôt que de lui faire ressaisir tous ses articles.
    const fichier = donnees.get('cahierDesCharges');
    let avertissement: string | null = null;

    if (fichier instanceof File && fichier.size > 0) {
      const { deposerCahierDesCharges } = await import('@/lib/demandes/cahierDesCharges');
      const depot = await deposerCahierDesCharges({
        fichier,
        demandeId: demande.id,
        tenant,
      });

      if (!depot.ok) avertissement = depot.motif ?? 'Document non enregistré.';
      else if (depot.motif) avertissement = `Document enregistré mais illisible : ${depot.motif}`;
    }

    await db.from('audit_events').insert({
      tenant_id: tenant,
      user_id: utilisateur.id,
      entite: 'demandes',
      entite_id: demande.id,
      action: 'demande.creee_manuellement',
      details: {
        code: demande.code,
        articles: lignes.length,
        client: clientNom,
        source,
        cahier_des_charges: fichier instanceof File && fichier.size > 0,
      },
    });

    revalidatePath('/demandes');
    revalidatePath('/opportunites');

    return {
      ok: true,
      demandeId: demande.id,
      message: avertissement
        ? `${demande.code} créée avec ${lignes.length} article(s). ${avertissement}`
        : `${demande.code} créée avec ${lignes.length} article(s).`,
    };
  } catch (e) {
    if (e instanceof ErreurAutorisation) {
      return { ok: false, message: e.message };
    }
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Création impossible.',
    };
  }
}
