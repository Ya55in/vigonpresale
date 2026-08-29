'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { booleenFormulaire, urlApplication } from '@vigon/shared';

import { ErreurAutorisation, requirePermissionApi } from '@/lib/auth/guards';
import { requireRole } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat =
  | { ok: true; message: string }
  | { ok: false; message: string };

function enEchec(e: unknown): Resultat {
  if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
  console.error('[admin] action en échec', e);
  return { ok: false, message: "L'opération a échoué. Réessayez." };
}

/** Paramètres modifiables depuis l'écran, avec leurs bornes. */
const PARAMETRES_AUTORISES: Record<string, { min: number; max: number; libelle: string }> = {
  marge_defaut_pct: { min: 0, max: 500, libelle: 'Marge par défaut' },
  tva_pct: { min: 0, max: 100, libelle: 'TVA' },
  delai_relance_heures: { min: 1, max: 720, libelle: 'Délai entre relances' },
  max_relances: { min: 0, max: 10, libelle: 'Nombre maximal de relances' },
  delai_expiration_offre: { min: 1, max: 365, libelle: 'Validité des offres' },
  // 0 autorisé : c'est la façon de couper la relance sans déployer.
  delai_relance_client_jours: {
    min: 0,
    max: 90,
    libelle: 'Relance du client avant échéance',
  },
  seuil_validation_finance_montant: {
    min: 0,
    max: 100_000_000,
    libelle: "Plafond avant escalade FINANCE",
  },
  seuil_validation_finance_marge_min: {
    min: 0,
    max: 100,
    libelle: 'Marge minimale avant escalade',
  },
};

/**
 * Enregistre un paramètre métier.
 *
 * Ouvert à ADMIN et à FINANCE : la spec confie à FINANCE la définition des
 * seuils d'escalade. Les bornes sont vérifiées côté serveur — un seuil négatif
 * ou absurde désactiverait silencieusement l'escalade.
 */
export async function enregistrerParametre(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('marge.definir_seuils');

    const parse = z
      .object({
        cle: z.string().trim(),
        valeur: z.coerce.number(),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };
    const { cle, valeur } = parse.data;

    const regle = PARAMETRES_AUTORISES[cle];
    if (!regle) return { ok: false, message: `Paramètre « ${cle} » non modifiable.` };

    if (valeur < regle.min || valeur > regle.max) {
      return {
        ok: false,
        message: `${regle.libelle} doit être entre ${regle.min} et ${regle.max}.`,
      };
    }

    const db = createAdminClient();

    const { data: existant } = await db
      .from('parametres')
      .select('id, valeur')
      .eq('tenant_id', utilisateur.tenant_id)
      .eq('cle', cle)
      .maybeSingle();

    const ancienne = existant?.valeur ?? null;

    if (existant) {
      const { error } = await db
        .from('parametres')
        .update({ valeur: String(valeur), updated_at: new Date().toISOString() })
        .eq('id', existant.id);
      if (error) return { ok: false, message: error.message };
    } else {
      const { error } = await db.from('parametres').insert({
        tenant_id: utilisateur.tenant_id,
        cle,
        valeur: String(valeur),
        type_valeur: 'nombre',
        categorie: cle.startsWith('seuil_') ? 'costing' : 'general',
      });
      if (error) return { ok: false, message: error.message };
    }

    // Le service met les paramètres en cache 60 s : on le vide pour que le
    // changement soit visible immédiatement, sans attendre l'expiration.
    const { invaliderCacheParametres } = await import('@vigon/services');
    invaliderCacheParametres();

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'parametres',
      entite_id: existant?.id ?? null,
      action: 'parametre.modifie',
      ancienne_valeur: ancienne ? { valeur: ancienne } : null,
      nouvelle_valeur: { valeur: String(valeur) },
      details: { cle, libelle: regle.libelle },
    });

    revalidatePath('/admin');
    revalidatePath('/finance');
    return { ok: true, message: `${regle.libelle} enregistré : ${valeur}.` };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Écrit une valeur texte dans `parametres`, en créant la ligne au besoin.
 *
 * Mutualisé entre les conditions d'offre et les prompts : les deux stockent du
 * texte libre là où `enregistrerParametre` n'accepte que des nombres bornés.
 */
async function ecrireParametreTexte(params: {
  tenant: string;
  cle: string;
  valeur: string;
  categorie: string;
  description: string;
}): Promise<{ id: number | null; ancienne: string | null } | { erreur: string }> {
  const db = createAdminClient();

  const { data: existant } = await db
    .from('parametres')
    .select('id, valeur')
    .eq('tenant_id', params.tenant)
    .eq('cle', params.cle)
    .maybeSingle();

  if (existant) {
    const { error } = await db
      .from('parametres')
      .update({ valeur: params.valeur, updated_at: new Date().toISOString() })
      .eq('id', existant.id);

    if (error) return { erreur: error.message };
    return { id: existant.id, ancienne: existant.valeur };
  }

  const { data: cree, error } = await db
    .from('parametres')
    .insert({
      tenant_id: params.tenant,
      cle: params.cle,
      valeur: params.valeur,
      type_valeur: 'texte',
      categorie: params.categorie,
      description: params.description,
    })
    .select('id')
    .single();

  if (error) return { erreur: error.message };
  return { id: cree.id, ancienne: null };
}

/**
 * Enregistre une condition commerciale de l'offre.
 *
 * Elles figurent au pied de chaque offre et sont gelées dans `source_json` à la
 * génération : modifier une condition ici n'altère aucune offre déjà partie
 * chez un client.
 */
export async function enregistrerConditionOffre(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('marge.definir_seuils');

    const { CLES_CONDITIONS } = await import('@vigon/services');

    const parse = z
      .object({
        champ: z.enum(['livraison', 'paiement', 'garantie']),
        valeur: z
          .string()
          .trim()
          .min(3, 'Le texte est trop court.')
          .max(500, 'Le texte dépasse 500 caractères.'),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { champ, valeur } = parse.data;

    const resultat = await ecrireParametreTexte({
      tenant: utilisateur.tenant_id,
      cle: CLES_CONDITIONS[champ],
      valeur,
      categorie: 'offre',
      description: `Condition commerciale « ${champ} » affichée sur les offres`,
    });

    if ('erreur' in resultat) return { ok: false, message: resultat.erreur };

    await createAdminClient().from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'parametres',
      entite_id: resultat.id,
      action: 'condition_offre.modifiee',
      ancienne_valeur: resultat.ancienne ? { valeur: resultat.ancienne } : null,
      nouvelle_valeur: { valeur },
      details: { champ },
    });

    revalidatePath('/admin');
    return { ok: true, message: 'Condition enregistrée. Elle s’appliquera aux prochaines offres.' };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Enregistre un prompt retouché, ou rétablit celui d'origine.
 *
 * La validation est refusée plutôt que corrigée : un prompt d'extraction privé
 * de sa variable de contenu produirait une réponse plausible sur rien — donc
 * une invention, qu'aucun contrôle en aval ne rattraperait.
 */
export async function enregistrerPrompt(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requireRole('admin');

    const { GABARITS, cleGabarit, estCodeGabarit, validerGabarit, invaliderCacheGabarits } =
      await import('@vigon/services');

    const parse = z
      .object({
        code: z.string().trim(),
        texte: z.string().max(20_000),
        /** Vrai pour effacer la retouche et revenir au texte livré. */
        retablir: booleenFormulaire(false),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };
    const { code, texte, retablir } = parse.data;

    if (!estCodeGabarit(code)) {
      return { ok: false, message: `Prompt « ${code} » inconnu.` };
    }

    const definition = GABARITS[code];
    const db = createAdminClient();
    const cle = cleGabarit(code);

    // --- Rétablissement : la ligne disparaît, le défaut du code reprend ---
    if (retablir) {
      const { data: existant } = await db
        .from('parametres')
        .select('id, valeur')
        .eq('tenant_id', utilisateur.tenant_id)
        .eq('cle', cle)
        .maybeSingle();

      if (!existant) {
        return { ok: true, message: `« ${definition.libelle} » est déjà le texte d’origine.` };
      }

      const { error } = await db.from('parametres').delete().eq('id', existant.id);
      if (error) return { ok: false, message: error.message };

      invaliderCacheGabarits();

      await db.from('audit_events').insert({
        tenant_id: utilisateur.tenant_id,
        user_id: utilisateur.id,
        entite: 'parametres',
        entite_id: existant.id,
        action: 'prompt.retabli',
        ancienne_valeur: { valeur: existant.valeur },
        nouvelle_valeur: null,
        details: { code, libelle: definition.libelle },
      });

      revalidatePath('/admin');
      return { ok: true, message: `« ${definition.libelle} » rétabli au texte d’origine.` };
    }

    // --- Enregistrement d'une retouche ---
    const validation = validerGabarit(code, texte);
    if (!validation.ok) return { ok: false, message: validation.motif };

    // Un texte identique au défaut ne mérite pas de ligne : on le traite comme
    // un rétablissement, ce qui garde le prompt aligné sur les évolutions livrées.
    if (texte.trim() === definition.defaut.trim()) {
      const fd = new FormData();
      fd.set('code', code);
      fd.set('texte', texte);
      fd.set('retablir', 'true');
      return enregistrerPrompt(null, fd);
    }

    const resultat = await ecrireParametreTexte({
      tenant: utilisateur.tenant_id,
      cle,
      valeur: texte.trim(),
      categorie: 'prompt',
      description: definition.libelle,
    });

    if ('erreur' in resultat) return { ok: false, message: resultat.erreur };

    invaliderCacheGabarits();

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'parametres',
      entite_id: resultat.id,
      action: 'prompt.modifie',
      // Le texte intégral, pas un extrait : c'est ce qui permet de revenir à une
      // version antérieure quand une retouche dégrade les extractions.
      ancienne_valeur: resultat.ancienne ? { valeur: resultat.ancienne } : null,
      nouvelle_valeur: { valeur: texte.trim() },
      details: { code, libelle: definition.libelle },
    });

    revalidatePath('/admin');
    return {
      ok: true,
      message: `« ${definition.libelle} » enregistré. Actif sous une minute sur le worker.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Active ou désactive un utilisateur.
 *
 * Pas de suppression : l'historique d'audit référence les utilisateurs, et un
 * compte supprimé rendrait les traces illisibles. La désactivation suffit —
 * `getUtilisateurCourant` refuse déjà un profil inactif.
 */
export async function basculerActif(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requireRole('admin');

    const parse = z
      .object({
        userId: z.string().uuid(),
        actif: booleenFormulaire(),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };
    const { userId, actif } = parse.data;

    // Se désactiver soi-même verrouillerait l'accès administrateur.
    if (userId === utilisateur.id && !actif) {
      return { ok: false, message: 'Vous ne pouvez pas désactiver votre propre compte.' };
    }

    const db = createAdminClient();

    const { data: cible } = await db
      .from('users')
      .select('id, email, role, actif')
      .eq('id', userId)
      .eq('tenant_id', utilisateur.tenant_id)
      .maybeSingle();

    if (!cible) return { ok: false, message: 'Utilisateur introuvable.' };

    // Le dernier administrateur actif ne doit pas pouvoir être désactivé.
    if (cible.role === 'admin' && !actif) {
      const { count } = await db
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', utilisateur.tenant_id)
        .eq('role', 'admin')
        .eq('actif', true);

      if ((count ?? 0) <= 1) {
        return {
          ok: false,
          message: 'Impossible : ce serait le dernier administrateur actif.',
        };
      }
    }

    const { error } = await db.from('users').update({ actif }).eq('id', userId);
    if (error) return { ok: false, message: error.message };

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'users',
      entite_id: null,
      action: actif ? 'utilisateur.active' : 'utilisateur.desactive',
      details: { cible: cible.email, role: cible.role },
    });

    revalidatePath('/admin');
    return {
      ok: true,
      message: `${cible.email} ${actif ? 'activé' : 'désactivé'}.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/** Change le rôle d'un utilisateur. */
export async function changerRole(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requireRole('admin');

    const parse = z
      .object({
        userId: z.string().uuid(),
        role: z.enum(['admin', 'presale', 'finance', 'after_sales']),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };
    const { userId, role } = parse.data;

    if (userId === utilisateur.id && role !== 'admin') {
      return {
        ok: false,
        message: 'Vous ne pouvez pas retirer votre propre rôle administrateur.',
      };
    }

    const db = createAdminClient();

    const { data: cible } = await db
      .from('users')
      .select('id, email, role')
      .eq('id', userId)
      .eq('tenant_id', utilisateur.tenant_id)
      .maybeSingle();

    if (!cible) return { ok: false, message: 'Utilisateur introuvable.' };
    if (cible.role === role) return { ok: true, message: 'Rôle inchangé.' };

    const { error } = await db.from('users').update({ role }).eq('id', userId);
    if (error) return { ok: false, message: error.message };

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'users',
      entite_id: null,
      action: 'utilisateur.role_modifie',
      ancienne_valeur: { role: cible.role },
      nouvelle_valeur: { role },
      details: { cible: cible.email },
    });

    revalidatePath('/admin');
    return { ok: true, message: `${cible.email} est désormais ${role}.` };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Renseigne les coordonnées de notification d'un approbateur.
 *
 * Deux champs, un par canal instantané : le numéro pour WhatsApp, l'identifiant
 * de chat pour Telegram. Sans eux, `soumettreValidation` n'a personne à qui
 * écrire et retombe sur le courriel — silencieusement, ce qui est le
 * comportement voulu mais donne l'impression que le canal ne marche pas.
 *
 * VIDER UN CHAMP LE DÉSACTIVE, et c'est délibéré : une chaîne vide devient
 * `null`, donc le canal est sauté. C'est le seul moyen de retirer un canal sans
 * toucher à la clé du service, qui vaut pour tout le tenant.
 *
 * Les valeurs ne sont pas validées au-delà du format : le numéro passe par
 * `normaliserNumero` à l'envoi, et un identifiant Telegram erroné se signale
 * par un « chat not found » que le repli absorbe.
 */
export async function definirContactsNotification(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requireRole('admin');

    const parse = z
      .object({
        userId: z.string().uuid(),
        telephone: z.string().trim().max(30),
        telegramChatId: z.string().trim().max(50),
        /**
         * Droit de recevoir les demandes d'accord EN SECOURS. Les
         * administrateurs les reçoivent de droit — ce drapeau n'ouvre le canal
         * qu'aux autres, et seulement si aucun admin n'est joignable.
         */
        recoitValidations: booleenFormulaire(false),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const db = createAdminClient();

    const { data: cible } = await db
      .from('users')
      .select('id, email, telephone, telegram_chat_id, recoit_validations')
      .eq('id', parse.data.userId)
      .eq('tenant_id', utilisateur.tenant_id)
      .maybeSingle();

    if (!cible) return { ok: false, message: 'Utilisateur introuvable.' };

    const telephone = parse.data.telephone || null;
    const telegramChatId = parse.data.telegramChatId || null;

    const { error } = await db
      .from('users')
      .update({
        telephone,
        telegram_chat_id: telegramChatId,
        recoit_validations: parse.data.recoitValidations,
      })
      .eq('id', parse.data.userId)
      .eq('tenant_id', utilisateur.tenant_id);

    if (error) return { ok: false, message: error.message };

    // Le numéro et l'identifiant ne sont pas des secrets, mais ils désignent
    // une personne : l'audit garde qui les a changés, pas seulement qu'ils
    // l'ont été.
    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'users',
      entite_id: null,
      action: 'utilisateur.contacts_modifies',
      ancienne_valeur: {
        telephone: cible.telephone,
        telegram_chat_id: cible.telegram_chat_id,
        recoit_validations: cible.recoit_validations,
      },
      nouvelle_valeur: {
        telephone,
        telegram_chat_id: telegramChatId,
        recoit_validations: parse.data.recoitValidations,
      },
      details: { cible: cible.email },
    });

    revalidatePath('/admin');

    const actifs = [telegramChatId && 'Telegram', telephone && 'WhatsApp'].filter(Boolean);

    return {
      ok: true,
      message: actifs.length
        ? `${cible.email} — canaux : ${actifs.join(', ')}.`
        : `${cible.email} — aucun canal instantané, validation par courriel.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Invite un utilisateur en créant son profil.
 *
 * Aucun mot de passe n'est défini ici : le modèle est « sur invitation ». La
 * personne se connecte ensuite par Google ou par courriel avec cette adresse,
 * et `lierProfilApresConnexion` rattache alors son `auth_user_id`. Une adresse
 * absente de cette table est refusée — c'est ce qui interdit l'auto-inscription.
 */
export async function inviterUtilisateur(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requireRole('admin');

    const parse = z
      .object({
        email: z.string().trim().toLowerCase().email('Adresse e-mail invalide.').max(300),
        prenom: z.string().trim().max(100).optional(),
        nom: z.string().trim().max(100).optional(),
        role: z.enum(['admin', 'presale', 'finance', 'after_sales']),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { email, prenom, nom, role } = parse.data;

    const db = createAdminClient();

    const { data: deja } = await db
      .from('users')
      .select('id, actif, role')
      .eq('tenant_id', utilisateur.tenant_id)
      .ilike('email', email)
      .maybeSingle();

    if (deja) {
      return {
        ok: false,
        message: deja.actif
          ? `${email} a déjà un compte (${deja.role}).`
          : `${email} existe mais est désactivé : réactivez-le plutôt.`,
      };
    }

    const { data: cree, error } = await db
      .from('users')
      .insert({
        // La table n'auto-génère pas la clé : on la fournit.
        id: randomUUID(),
        tenant_id: utilisateur.tenant_id,
        email,
        prenom: prenom || null,
        nom: nom || null,
        role,
        actif: true,
        // Rattaché à la première connexion réussie, pas avant.
        auth_user_id: null,
      })
      .select('id')
      .single();

    if (error) return { ok: false, message: error.message };

    // --- Compte d'authentification et lien de première connexion ---
    //
    // Le profil applicatif seul ne permet pas de se connecter : il autorise une
    // adresse, il ne crée aucun moyen de s'authentifier. Sans cette étape,
    // l'invité qui tentait « adresse + mot de passe » était refusé, faute de
    // compte Auth et de mot de passe défini — seul Google fonctionnait.
    //
    // `generateLink` crée le compte ET renvoie le lien sans envoyer de courriel :
    // l'envoi passe par le SMTP de l'application, pas par celui de Supabase,
    // dont le quota par défaut est trop faible pour être fiable.
    const resultatInvitation = await envoyerInvitation(db, {
      email,
      prenom: prenom || null,
      role,
      invitePar: utilisateur.email,
    });

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'users',
      entite_id: null,
      action: 'utilisateur.invite',
      details: {
        email,
        role,
        invite_par: utilisateur.email,
        id: cree.id,
        courriel_envoye: resultatInvitation.ok,
        motif: resultatInvitation.ok ? null : resultatInvitation.motif,
      },
    });

    revalidatePath('/admin');

    // Le profil existe quoi qu'il arrive : un échec d'envoi ne doit pas laisser
    // croire que l'invitation n'a pas eu lieu, mais doit être dit clairement.
    if (!resultatInvitation.ok) {
      return {
        ok: false,
        message:
          `${email} a bien été autorisé comme ${role}, mais le courriel n'a pas pu partir : ` +
          `${resultatInvitation.motif} — utilisez « Renvoyer l'invitation ».`,
      };
    }

    return {
      ok: true,
      message: `${email} invité comme ${role}. Un lien de création de mot de passe lui a été envoyé.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Renvoie le lien de création de mot de passe à un utilisateur déjà autorisé.
 *
 * Indispensable aux profils créés avant que l'invitation n'émette un compte
 * Auth : ils existaient en base sans aucun moyen de se connecter autrement que
 * par Google. Sert aussi quand le lien a expiré.
 */
export async function renvoyerInvitation(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requireRole('admin');

    const parse = z
      .object({ id: z.string().uuid() })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Utilisateur invalide.' };

    const db = createAdminClient();

    const { data: cible } = await db
      .from('users')
      .select('id, email, prenom, role, actif')
      .eq('tenant_id', utilisateur.tenant_id)
      .eq('id', parse.data.id)
      .maybeSingle();

    if (!cible) return { ok: false, message: 'Utilisateur introuvable.' };
    if (!cible.actif) {
      return { ok: false, message: 'Compte désactivé : réactivez-le avant de le réinviter.' };
    }

    const resultat = await envoyerInvitation(db, {
      email: cible.email.toLowerCase(),
      prenom: cible.prenom,
      role: cible.role,
      invitePar: utilisateur.email,
    });

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'users',
      entite_id: null,
      action: 'utilisateur.invitation_renvoyee',
      details: { email: cible.email, envoye: resultat.ok, id: cible.id },
    });

    revalidatePath('/admin');

    return resultat.ok
      ? { ok: true, message: `Lien de connexion renvoyé à ${cible.email}.` }
      : { ok: false, message: `Envoi impossible : ${resultat.motif}` };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Crée le compte Auth s'il manque, puis envoie le lien de choix du mot de passe.
 *
 * Ne lève jamais : l'appelant décide quoi dire quand l'envoi échoue, le profil
 * applicatif étant déjà écrit.
 */
async function envoyerInvitation(
  db: ReturnType<typeof createAdminClient>,
  params: { email: string; prenom: string | null; role: string; invitePar: string },
): Promise<{ ok: true } | { ok: false; motif: string }> {
  try {
    const origine = urlApplication();

    // Un compte Auth peut préexister — invitation renvoyée, ou adresse déjà
    // passée par Google. `invite` échouerait alors ; `recovery` couvre les deux.
    const { data: comptes } = await db.auth.admin.listUsers();
    const existeDeja = (comptes?.users ?? []).some(
      (u) => u.email?.toLowerCase() === params.email,
    );
    const type = existeDeja ? 'recovery' : 'invite';

    const { data: lien, error } = await db.auth.admin.generateLink({
      type,
      email: params.email,
      options: { redirectTo: `${origine}/invitation` },
    });

    if (error || !lien?.properties?.hashed_token) {
      return { ok: false, motif: error?.message ?? 'lien de connexion non généré' };
    }

    // On compose le lien nous-mêmes plutôt que d'expédier `action_link`.
    // Celui-ci passe par le point de vérification de Supabase, qui renvoie ses
    // jetons dans le fragment de l'URL — invisible du serveur — et perdait la
    // destination en route : l'invité arrivait connecté sur le tableau de bord
    // sans jamais choisir de mot de passe.
    const lienInvitation =
      `${origine}/invitation?token_hash=${encodeURIComponent(lien.properties.hashed_token)}` +
      `&type=${encodeURIComponent(type)}`;

    // Marqueur qui rend l'étape obligatoire : tant qu'il est posé, le
    // middleware ramène la session sur l'écran de mot de passe. Sans lui,
    // l'invité pouvait naviguer ailleurs et se retrouver ensuite sans aucun
    // moyen de se reconnecter.
    //
    // Les métadonnées sont remplacées et non fusionnées : on repart donc de
    // l'existant pour ne pas effacer ce que l'OAuth y a déposé.
    if (lien.user?.id) {
      await db.auth.admin.updateUserById(lien.user.id, {
        user_metadata: { ...(lien.user.user_metadata ?? {}), mot_de_passe_a_definir: true },
      });
    }

    const { buildInvitationHtml, buildInvitationTexte } = await import(
      '@/lib/auth/invitationHtml'
    );
    const { envoiConfigure, envoyer } = await import('@vigon/services');

    if (!envoiConfigure('principal')) {
      return { ok: false, motif: "aucun transport d'envoi configuré" };
    }

    const contenu = {
      prenom: params.prenom,
      role: params.role,
      lien: lienInvitation,
      invitePar: params.invitePar,
    };

    await envoyer('principal', {
      a: params.email,
      sujet: 'Votre accès à la plateforme avant-vente Vigon Systems',
      html: buildInvitationHtml(contenu),
      texte: buildInvitationTexte(contenu),
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, motif: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Active ou coupe le circuit d'approbation avant génération d'offre.
 *
 * Désactivé par défaut — voir `CLE_VALIDATION_OBLIGATOIRE`. L'activer impose
 * qu'un administrateur donne son accord avant chaque offre : c'est un durcissement
 * du flux, pas un réglage cosmétique, et il doit être choisi sciemment.
 */
export async function definirValidationObligatoire(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('parametre.modifier');

    const parse = z
      .object({ actif: booleenFormulaire() })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const { CLE_VALIDATION_OBLIGATOIRE } = await import('@/lib/validation/circuit');
    const db = createAdminClient();

    const { error } = await db.from('parametres').upsert(
      {
        tenant_id: utilisateur.tenant_id,
        cle: CLE_VALIDATION_OBLIGATOIRE,
        valeur: String(parse.data.actif),
        type_valeur: 'booleen',
        categorie: 'workflow',
        description: 'Exige l’accord d’un administrateur avant génération d’offre.',
      },
      { onConflict: 'tenant_id,cle' },
    );

    if (error) return { ok: false, message: error.message };

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'parametres',
      entite_id: null,
      action: 'parametre.validation_offre',
      details: { actif: parse.data.actif },
    });

    revalidatePath('/admin');
    return {
      ok: true,
      message: parse.data.actif
        ? 'Validation exigée avant chaque génération d’offre.'
        : 'Validation désactivée : les offres se génèrent directement.',
    };
  } catch (e) {
    return enEchec(e);
  }
}
