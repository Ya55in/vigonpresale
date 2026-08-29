'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { booleenFormulaire } from '@vigon/shared';

import { ErreurAutorisation, requirePermissionApi } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat =
  | { ok: true; message: string }
  | { ok: false; message: string };

function enEchec(e: unknown): Resultat {
  if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
  console.error('[fournisseurs] action en échec', e);
  return { ok: false, message: "L'opération a échoué. Réessayez." };
}

const fournisseurSchema = z.object({
  marque: z.string().trim().min(1, 'La marque est obligatoire.').max(200),
  nom: z.string().trim().min(1, "Le nom de l'entreprise est obligatoire.").max(300),
  email: z.string().trim().email('Adresse e-mail invalide.').max(300),
  telephone: z.string().trim().max(50).optional(),
  siteWeb: z.string().trim().max(500).optional(),
  pays: z.string().trim().max(100).optional(),
});

/**
 * Ajout manuel d'un fournisseur.
 *
 * Exigé par la spec : quand le sourcing web ne trouve aucun contact
 * exploitable, PRESALE doit pouvoir saisir le fournisseur à la main pour
 * débloquer la consultation.
 */
export async function ajouterFournisseur(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('fournisseur.creer');

    const parse = fournisseurSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { marque, nom, email, telephone, siteWeb, pays } = parse.data;

    const { emailCommercialValide } = await import('@vigon/shared');
    if (!emailCommercialValide(email)) {
      return {
        ok: false,
        message: 'Adresse inexploitable pour une prise de contact (noreply, domaine d’exemple…).',
      };
    }

    const db = createAdminClient();
    const { normaliserMarque } = await import('@vigon/services');

    // Un même couple marque/adresse ne doit pas exister deux fois : le sourcing
    // web pourrait l'avoir déjà enregistré.
    const { data: deja } = await db
      .from('fournisseurs')
      .select('id, nom')
      .eq('tenant_id', utilisateur.tenant_id)
      .eq('marque_norm', normaliserMarque(marque))
      .ilike('email', email)
      .maybeSingle();

    if (deja) {
      return { ok: false, message: `Déjà enregistré pour cette marque : ${deja.nom}.` };
    }

    const { data: cree, error } = await db
      .from('fournisseurs')
      .insert({
        tenant_id: utilisateur.tenant_id,
        marque,
        nom,
        email: email.toLowerCase(),
        telephone: telephone || null,
        site_web: siteWeb || null,
        pays: pays || null,
        source: 'manuel',
      })
      .select('id')
      .single();

    if (error) return { ok: false, message: error.message };

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'fournisseurs',
      entite_id: cree.id,
      action: 'fournisseur.ajoute',
      details: { marque, nom, email, source: 'manuel' },
    });

    revalidatePath('/fournisseurs');
    return { ok: true, message: `${nom} ajouté pour la marque ${marque}.` };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Fixe la langue de correspondance d'un fournisseur.
 *
 * Elle détermine la langue des demandes de devis et des relances qui lui sont
 * adressées. Choisir la langue déduite de son pays efface le réglage explicite :
 * le fournisseur suit alors son pays si celui-ci est corrigé plus tard.
 */
export async function definirLangue(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('fournisseur.modifier');

    const { LANGUES, LIBELLES_LANGUE } = await import('@vigon/shared');

    const parse = z
      .object({
        id: z.coerce.number().int().positive(),
        langue: z.enum(LANGUES),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Langue invalide.' };
    const { id, langue } = parse.data;

    const db = createAdminClient();

    // Le pays est nécessaire au service : il décide si la langue choisie est la
    // langue déduite, auquel cas il n'écrit rien plutôt que de figer un doublon.
    const { data: fournisseur } = await db
      .from('fournisseurs')
      .select('id, nom, pays')
      .eq('id', id)
      .eq('tenant_id', utilisateur.tenant_id)
      .maybeSingle();

    if (!fournisseur) return { ok: false, message: 'Fournisseur introuvable.' };

    const { definirLangueFournisseur } = await import('@vigon/services');

    await definirLangueFournisseur({
      tenant: utilisateur.tenant_id,
      fournisseurId: id,
      langue,
      pays: fournisseur.pays,
    });

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'fournisseurs',
      entite_id: id,
      action: 'fournisseur.langue_definie',
      nouvelle_valeur: { langue },
      details: { nom: fournisseur.nom, pays: fournisseur.pays },
    });

    revalidatePath('/fournisseurs');
    return {
      ok: true,
      message: `${fournisseur.nom} sera consulté en ${LIBELLES_LANGUE[langue]}.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/** Active ou désactive un fournisseur ; un inactif sort du sourcing. */
export async function basculerFournisseur(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('fournisseur.modifier');

    const parse = z
      .object({
        id: z.coerce.number().int().positive(),
        actif: booleenFormulaire(),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const db = createAdminClient();
    const { data, error } = await db
      .from('fournisseurs')
      .update({ actif: parse.data.actif })
      .eq('id', parse.data.id)
      .eq('tenant_id', utilisateur.tenant_id)
      .select('nom')
      .maybeSingle();

    if (error) return { ok: false, message: error.message };
    if (!data) return { ok: false, message: 'Fournisseur introuvable.' };

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'fournisseurs',
      entite_id: parse.data.id,
      action: parse.data.actif ? 'fournisseur.active' : 'fournisseur.desactive',
      details: { nom: data.nom },
    });

    revalidatePath('/fournisseurs');
    return {
      ok: true,
      message: `${data.nom} ${parse.data.actif ? 'réactivé' : 'désactivé'}.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/* ------------------------------------------------------------------------- */
/* Contacts et initiales                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Vérifie que le fournisseur appartient bien au tenant.
 *
 * Les actions de contact reçoivent un `fournisseurId` du formulaire :
 * `fournisseur_contacts` ne portant pas de `tenant_id`, c'est ce contrôle qui
 * empêche d'écrire sur la fiche d'un autre locataire.
 */
async function fournisseurDuTenant(
  tenant: string,
  fournisseurId: number,
): Promise<{ id: number; nom: string } | null> {
  const { data } = await createAdminClient()
    .from('fournisseurs')
    .select('id, nom')
    .eq('id', fournisseurId)
    .eq('tenant_id', tenant)
    .maybeSingle();

  return data;
}

const contactSchema = z.object({
  fournisseurId: z.coerce.number().int().positive(),
  nom: z.string().trim().max(200).optional().default(''),
  email: z.string().trim().email('Adresse e-mail invalide.').max(300),
  telephone: z.string().trim().max(50).optional().default(''),
  fonction: z.string().trim().max(120).optional().default(''),
  principal: booleenFormulaire(),
});

/**
 * Ajoute un contact à un fournisseur.
 *
 * Le contact principal devient le destinataire des consultations à venir ;
 * l'adresse de la fiche bascule alors en copie plutôt que d'être perdue —
 * elle est souvent la seule réellement relevée.
 */
export async function ajouterContact(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('fournisseur.modifier');

    const parse = contactSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return {
        ok: false,
        message: parse.error.issues[0]?.message ?? 'Données invalides.',
      };
    }

    const { fournisseurId, nom, email, telephone, fonction, principal } = parse.data;

    const fournisseur = await fournisseurDuTenant(utilisateur.tenant_id, fournisseurId);
    if (!fournisseur) return { ok: false, message: 'Fournisseur introuvable.' };

    const db = createAdminClient();

    // Une adresse déjà présente sur cette fiche n'apporterait rien : elle
    // serait dédupliquée à l'envoi, mais figurerait deux fois à l'écran.
    const { data: deja } = await db
      .from('fournisseur_contacts')
      .select('id')
      .eq('fournisseur_id', fournisseurId)
      .ilike('email', email)
      .maybeSingle();

    if (deja) return { ok: false, message: 'Cette adresse est déjà enregistrée.' };

    // Un seul principal par fiche : sans cette remise à zéro, deux contacts
    // pourraient l'être et le destinataire dépendrait de l'ordre de lecture.
    if (principal) {
      await db
        .from('fournisseur_contacts')
        .update({ principal: false })
        .eq('fournisseur_id', fournisseurId);
    }

    const { error } = await db.from('fournisseur_contacts').insert({
      fournisseur_id: fournisseurId,
      nom: nom || null,
      email,
      telephone: telephone || null,
      fonction: fonction || null,
      principal,
    });

    if (error) return { ok: false, message: error.message };

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'fournisseurs',
      entite_id: fournisseurId,
      action: 'fournisseur.contact_ajoute',
      details: { nom: fournisseur.nom, email, principal },
    });

    revalidatePath('/fournisseurs');
    return {
      ok: true,
      message: principal
        ? `${email} devient le destinataire principal.`
        : `${email} recevra les consultations en copie.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/** Retire un contact. L'adresse de la fiche prend le relais s'il était principal. */
export async function supprimerContact(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('fournisseur.modifier');

    const parse = z
      .object({
        id: z.coerce.number().int().positive(),
        fournisseurId: z.coerce.number().int().positive(),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const fournisseur = await fournisseurDuTenant(
      utilisateur.tenant_id,
      parse.data.fournisseurId,
    );
    if (!fournisseur) return { ok: false, message: 'Fournisseur introuvable.' };

    const db = createAdminClient();

    const { data, error } = await db
      .from('fournisseur_contacts')
      .delete()
      .eq('id', parse.data.id)
      // Rattache la suppression à la fiche vérifiée : un identifiant forgé ne
      // peut pas viser le contact d'un autre fournisseur.
      .eq('fournisseur_id', parse.data.fournisseurId)
      .select('email')
      .maybeSingle();

    if (error) return { ok: false, message: error.message };
    if (!data) return { ok: false, message: 'Contact introuvable.' };

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'fournisseurs',
      entite_id: parse.data.fournisseurId,
      action: 'fournisseur.contact_supprime',
      details: { nom: fournisseur.nom, email: data.email },
    });

    revalidatePath('/fournisseurs');
    return { ok: true, message: `${data.email} retiré.` };
  } catch (e) {
    return enEchec(e);
  }
}

/** Enregistre les initiales, ou les efface quand le champ est vidé. */
export async function definirInitiales(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('fournisseur.modifier');

    const parse = z
      .object({
        id: z.coerce.number().int().positive(),
        // Bornées à 6 comme la contrainte en base : au-delà ce n'est plus une
        // initiale mais une abréviation.
        initiales: z.string().trim().max(6, 'Six caractères au maximum.'),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return {
        ok: false,
        message: parse.error.issues[0]?.message ?? 'Données invalides.',
      };
    }

    const db = createAdminClient();
    const { data, error } = await db
      .from('fournisseurs')
      .update({ initiales: parse.data.initiales || null })
      .eq('id', parse.data.id)
      .eq('tenant_id', utilisateur.tenant_id)
      .select('nom')
      .maybeSingle();

    if (error) return { ok: false, message: error.message };
    if (!data) return { ok: false, message: 'Fournisseur introuvable.' };

    revalidatePath('/fournisseurs');
    return {
      ok: true,
      message: parse.data.initiales
        ? `Initiales « ${parse.data.initiales} » enregistrées.`
        : 'Initiales effacées.',
    };
  } catch (e) {
    return enEchec(e);
  }
}
