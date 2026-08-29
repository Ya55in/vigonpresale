'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ErreurAutorisation, requirePermissionApi } from '@/lib/auth/guards';
import type { ProfilUtilisateur } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat =
  | { ok: true; message: string }
  | { ok: false; message: string };

/** Une offre partie chez le client ne se retouche plus. */
const STATUTS_FIGES = ['envoyee', 'consultee', 'approuvee', 'refusee', 'expiree'];

function enEchec(e: unknown): Resultat {
  if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
  console.error('[offre/preview] action en échec', e);
  return { ok: false, message: "L'opération a échoué. Réessayez." };
}

async function offreDuTenant(
  utilisateur: ProfilUtilisateur,
  offreId: number,
): Promise<{
  id: number;
  demande_id: number | null;
  statut: string | null;
  numero: string;
  source_json: unknown;
} | null> {
  const { data } = await createAdminClient()
    .from('offres')
    .select('id, demande_id, statut, numero, source_json')
    .eq('id', offreId)
    .eq('tenant_id', utilisateur.tenant_id)
    .maybeSingle();

  return data;
}

/**
 * Réécrit le BoQ stocké après une retouche.
 *
 * `source_json` est la source de vérité du document : c'est lui qui est rendu
 * en PDF et affiché au client. Le laisser divergeant de `offre_produits`
 * produirait un écran de relecture qui ne correspond pas à l'envoi.
 */
async function synchroniserBoq(offreId: number): Promise<void> {
  const db = createAdminClient();

  const [{ data: offre }, { data: produits }] = await Promise.all([
    db.from('offres').select('source_json').eq('id', offreId).single(),
    db
      .from('offre_produits')
      .select('designation, reference, marque, description_technique, points_cles, image_url, quantite, prix_unitaire_ht, total_ht')
      .eq('offre_id', offreId)
      .order('ordre', { ascending: true }),
  ]);

  if (!offre?.source_json) return;

  const boq = offre.source_json as Record<string, unknown>;

  boq.produits = (produits ?? []).map((p) => ({
    designation: p.designation,
    reference: p.reference,
    marque: p.marque,
    imageUrl: p.image_url,
    descriptionTechnique: p.description_technique,
    pointsCles: p.points_cles ?? [],
    quantite: Number(p.quantite ?? 1),
    prixUnitaireHt: Number(p.prix_unitaire_ht ?? 0),
    totalHt: Number(p.total_ht ?? 0),
  }));

  await db
    .from('offres')
    .update({ source_json: JSON.parse(JSON.stringify(boq)) })
    .eq('id', offreId);
}

const produitSchema = z.object({
  offreId: z.coerce.number().int().positive(),
  produitId: z.coerce.number().int().positive(),
  descriptionTechnique: z.string().trim().max(3000),
  /** Une ligne par point clé. */
  pointsCles: z.string().max(3000),
});

export async function modifierProduit(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('offre.modifier');

    const parse = produitSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { offreId, produitId, descriptionTechnique, pointsCles } = parse.data;

    const offre = await offreDuTenant(utilisateur, offreId);
    if (!offre) return { ok: false, message: 'Offre introuvable.' };
    if (STATUTS_FIGES.includes(offre.statut ?? '')) {
      return { ok: false, message: 'Offre déjà envoyée au client.' };
    }

    const db = createAdminClient();

    // Le produit doit appartenir à cette offre : sans ce contrôle, un
    // identifiant forgé modifierait l'offre d'un autre dossier.
    const { data: produit } = await db
      .from('offre_produits')
      .select('id')
      .eq('id', produitId)
      .eq('offre_id', offreId)
      .maybeSingle();

    if (!produit) return { ok: false, message: 'Produit introuvable.' };

    const points = pointsCles
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 10);

    const { error } = await db
      .from('offre_produits')
      .update({
        description_technique: descriptionTechnique || null,
        points_cles: points,
      })
      .eq('id', produitId);

    if (error) return { ok: false, message: error.message };

    await synchroniserBoq(offreId);

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'offre_produits',
      entite_id: produitId,
      action: 'offre.produit_modifie',
      details: { offre_id: offreId, numero: offre.numero },
    });

    revalidatePath(`/offres/${offreId}/preview`);
    return { ok: true, message: 'Produit mis à jour.' };
  } catch (e) {
    return enEchec(e);
  }
}

export async function modifierSynthese(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('offre.modifier');

    const parse = z
      .object({
        offreId: z.coerce.number().int().positive(),
        titre: z.string().trim().min(1, 'Le titre est obligatoire.').max(300),
        resume: z.string().trim().min(1, 'Le résumé est obligatoire.').max(5000),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { offreId, titre, resume } = parse.data;

    const offre = await offreDuTenant(utilisateur, offreId);
    if (!offre) return { ok: false, message: 'Offre introuvable.' };
    if (STATUTS_FIGES.includes(offre.statut ?? '')) {
      return { ok: false, message: 'Offre déjà envoyée au client.' };
    }

    const db = createAdminClient();
    const boq = (offre.source_json ?? {}) as Record<string, unknown>;
    const solution = (boq.solution ?? {}) as Record<string, unknown>;

    boq.solution = { ...solution, titre, resume };

    const { error } = await db
      .from('offres')
      .update({ source_json: JSON.parse(JSON.stringify(boq)), titre })
      .eq('id', offreId);

    if (error) return { ok: false, message: error.message };

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'offres',
      entite_id: offreId,
      action: 'offre.synthese_modifiee',
      details: { numero: offre.numero },
    });

    revalidatePath(`/offres/${offreId}/preview`);
    return { ok: true, message: 'Synthèse mise à jour.' };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Remplace le visuel d'un produit, par téléversement ou nouvelle recherche.
 *
 * Le fichier téléversé est validé côté serveur : type et taille. Ce qui arrive
 * d'un formulaire n'est jamais de confiance, même venant d'un utilisateur
 * authentifié.
 */
export async function remplacerVisuel(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('offre.modifier');

    const offreId = Number(donnees.get('offreId'));
    const produitId = Number(donnees.get('produitId'));
    const mode = String(donnees.get('mode') ?? 'recherche');

    if (!Number.isInteger(offreId) || !Number.isInteger(produitId)) {
      return { ok: false, message: 'Données invalides.' };
    }

    const offre = await offreDuTenant(utilisateur, offreId);
    if (!offre) return { ok: false, message: 'Offre introuvable.' };
    if (STATUTS_FIGES.includes(offre.statut ?? '')) {
      return { ok: false, message: 'Offre déjà envoyée au client.' };
    }

    const db = createAdminClient();
    const { data: produit } = await db
      .from('offre_produits')
      .select('id, marque, reference, designation')
      .eq('id', produitId)
      .eq('offre_id', offreId)
      .maybeSingle();

    if (!produit) return { ok: false, message: 'Produit introuvable.' };

    let imageUrl: string | null = null;
    let imageSource: string | null = null;

    if (mode === 'upload') {
      const fichier = donnees.get('fichier');
      if (!(fichier instanceof File) || fichier.size === 0) {
        return { ok: false, message: 'Aucun fichier fourni.' };
      }

      const typesAcceptes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!typesAcceptes.includes(fichier.type)) {
        return { ok: false, message: 'Formats acceptés : JPEG, PNG, WebP.' };
      }
      if (fichier.size > 4 * 1024 * 1024) {
        return { ok: false, message: 'Fichier trop volumineux (4 Mo maximum).' };
      }

      const extension = fichier.type === 'image/png' ? 'png' : fichier.type === 'image/webp' ? 'webp' : 'jpg';
      const chemin = `${utilisateur.tenant_id}/${offreId}/produits/manuel-${produitId}-${Date.now()}.${extension}`;

      const { error: erreurUpload } = await db.storage
        .from('offres')
        .upload(chemin, Buffer.from(await fichier.arrayBuffer()), {
          contentType: fichier.type,
          upsert: true,
        });

      if (erreurUpload) {
        return { ok: false, message: `Téléversement impossible : ${erreurUpload.message}` };
      }

      const { data: signee } = await db.storage
        .from('offres')
        .createSignedUrl(chemin, 60 * 60 * 24 * 365);

      imageUrl = signee?.signedUrl ?? null;
      imageSource = `Téléversé par ${utilisateur.email}`;
    } else {
      const { recupererPhotoProduit } = await import('@vigon/services');
      const photo = await recupererPhotoProduit({
        tenant: utilisateur.tenant_id,
        offreId,
        marque: produit.marque ?? 'Non specifie',
        reference: produit.reference,
        designation: produit.designation,
      });

      if (photo.placeholder) {
        return { ok: false, message: photo.motif ?? 'Aucun visuel trouvé.' };
      }
      imageUrl = photo.imageUrl;
      imageSource = photo.imageSource;
    }

    const { error } = await db
      .from('offre_produits')
      .update({
        image_url: imageUrl,
        image_source: imageSource,
        image_validee: mode === 'upload',
      })
      .eq('id', produitId);

    if (error) return { ok: false, message: error.message };

    await synchroniserBoq(offreId);

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'offre_produits',
      entite_id: produitId,
      action: 'offre.visuel_remplace',
      details: { offre_id: offreId, mode, source: imageSource },
    });

    revalidatePath(`/offres/${offreId}/preview`);
    return {
      ok: true,
      message: mode === 'upload' ? 'Visuel téléversé.' : 'Nouveau visuel trouvé.',
    };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Retire le visuel d'un produit, ou le rétablit.
 *
 * Un visuel trouvé automatiquement est parfois pire que pas de visuel : une
 * photo générique de rack sur une ligne de licences, un produit d'une autre
 * gamme, une image de mauvaise qualité. La coupure par offre existait déjà,
 * mais elle est trop grossière — elle sacrifie les bons visuels avec le mauvais.
 *
 * `image_validee` distingue les deux absences, et c'est ce qui rend l'action
 * réversible : une image nulle et non validée est un visuel jamais trouvé, que
 * la régénération tentera de nouveau ; une image nulle et VALIDÉE est un retrait
 * décidé par un humain, que rien ne doit écraser.
 */
export async function basculerVisuel(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('offre.modifier');

    const offreId = Number(donnees.get('offreId'));
    const produitId = Number(donnees.get('produitId'));

    if (!Number.isInteger(offreId) || !Number.isInteger(produitId)) {
      return { ok: false, message: 'Données invalides.' };
    }

    const offre = await offreDuTenant(utilisateur, offreId);
    if (!offre) return { ok: false, message: 'Offre introuvable.' };
    if (STATUTS_FIGES.includes(offre.statut ?? '')) {
      return { ok: false, message: 'Offre déjà envoyée au client.' };
    }

    const db = createAdminClient();

    const { data: produit } = await db
      .from('offre_produits')
      .select('id, designation, image_url, image_source, image_validee')
      .eq('id', produitId)
      .eq('offre_id', offreId)
      .maybeSingle();

    if (!produit) return { ok: false, message: 'Produit introuvable.' };

    const retire = produit.image_url === null && produit.image_validee;

    if (retire) {
      // Rétablir revient à rendre le produit éligible à une nouvelle recherche :
      // on ne conserve pas l'ancienne URL, qui peut être périmée.
      const { error } = await db
        .from('offre_produits')
        .update({ image_validee: false })
        .eq('id', produitId);

      if (error) return { ok: false, message: error.message };
    } else {
      const { error } = await db
        .from('offre_produits')
        .update({ image_url: null, image_source: null, image_validee: true })
        .eq('id', produitId);

      if (error) return { ok: false, message: error.message };
    }

    await synchroniserBoq(offreId);

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'offre_produits',
      entite_id: produitId,
      action: retire ? 'offre.visuel_retabli' : 'offre.visuel_retire',
      details: { offre_id: offreId, produit: produit.designation },
    });

    revalidatePath(`/offres/${offreId}/preview`);

    return {
      ok: true,
      message: retire
        ? `Visuel rétabli pour « ${produit.designation} » — relancer la recherche pour en trouver un.`
        : `Visuel retiré pour « ${produit.designation} ».`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Régénère le PDF depuis le BoQ retouché, sans repasser par l'IA.
 *
 * Distinct de la régénération complète de l'étape 10 : ici les textes ont été
 * relus par un humain, les redemander au modèle les écraserait.
 */
export async function regenererDocument(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('offre.modifier');

    const parse = z
      .object({ offreId: z.coerce.number().int().positive() })
      .safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const offre = await offreDuTenant(utilisateur, parse.data.offreId);
    if (!offre) return { ok: false, message: 'Offre introuvable.' };
    if (STATUTS_FIGES.includes(offre.statut ?? '')) {
      return { ok: false, message: 'Offre déjà envoyée au client.' };
    }

    const { reconstruireDocument } = await import('@/lib/offres/document');
    const resultat = await reconstruireDocument({
      offreId: offre.id,
      tenant: utilisateur.tenant_id,
    });

    revalidatePath(`/offres/${offre.id}/preview`);
    return {
      ok: true,
      message: resultat.repliLocal
        ? 'Document reconstruit localement.'
        : 'Document Gamma régénéré.',
    };
  } catch (e) {
    return enEchec(e);
  }
}
