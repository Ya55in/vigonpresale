'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ErreurAutorisation, requireRole } from '@/lib/auth/guards';
import { createAdminClient } from '@/lib/supabase/admin';

export type Resultat =
  | { ok: true; message: string }
  | { ok: false; message: string };

function enEchec(e: unknown): Resultat {
  if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
  console.error('[admin/cles] action en échec', e);
  return { ok: false, message: "L'opération a échoué. Réessayez." };
}

/**
 * Enregistre ou remplace une clé de service.
 *
 * Réservé à ADMIN : ces valeurs ouvrent l'accès à des services facturés et à la
 * boîte mail de l'entreprise. La valeur n'est jamais relue vers l'interface.
 */
export async function enregistrerCle(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requireRole('admin');

    const parse = z
      .object({
        nom: z.string().trim(),
        valeur: z.string().trim().min(1, 'Valeur vide.').max(4000),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { nom, valeur } = parse.data;

    const { estCleGeree, CLES_GEREES, CATEGORIE_SECRET, chargerSecrets } = await import(
      '@vigon/services'
    );

    // Allowlist stricte : sans elle, ce formulaire écrirait n'importe quelle
    // clé, y compris de quoi détourner la configuration du worker.
    if (!estCleGeree(nom)) {
      return { ok: false, message: `Clé « ${nom} » non gérable depuis cet écran.` };
    }

    /*
     * Contrôle de format, quand la définition en déclare un.
     *
     * Une clé d'API n'a pas de forme vérifiable, mais une adresse si — et une
     * adresse fautive était acceptée en silence, l'erreur n'apparaissant qu'au
     * test de connexion sous forme de refus d'authentification. La valeur est
     * reprise dans le message : ce n'est pas un secret, et c'est la faute de
     * frappe qu'il faut pouvoir lire.
     */
    const definition = CLES_GEREES.find((c) => c.nom === nom);

    if (definition && 'format' in definition && definition.format === 'email') {
      if (!z.string().email().safeParse(valeur).success) {
        return { ok: false, message: `« ${valeur} » n’est pas une adresse e-mail valide.` };
      }
    }

    const db = createAdminClient();

    const { data: existant } = await db
      .from('parametres')
      .select('id')
      .eq('tenant_id', utilisateur.tenant_id)
      .eq('cle', nom)
      .maybeSingle();

    if (existant) {
      const { error } = await db
        .from('parametres')
        .update({
          valeur,
          categorie: CATEGORIE_SECRET,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existant.id);
      if (error) return { ok: false, message: error.message };
    } else {
      const { error } = await db.from('parametres').insert({
        tenant_id: utilisateur.tenant_id,
        cle: nom,
        valeur,
        type_valeur: 'texte',
        categorie: CATEGORIE_SECRET,
        description: 'Clé de service, modifiable depuis l’administration.',
      });
      if (error) return { ok: false, message: error.message };
    }

    // Rechargement immédiat : la clé doit être active sans attendre le cache.
    await chargerSecrets(utilisateur.tenant_id, { force: true });

    // L'audit garde la trace du changement, jamais la valeur.
    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'parametres',
      entite_id: existant?.id ?? null,
      action: 'cle_api.modifiee',
      details: { cle: nom, longueur: valeur.length },
    });

    revalidatePath('/admin');
    return { ok: true, message: `${nom} enregistrée et active.` };
  } catch (e) {
    return enEchec(e);
  }
}

/** Retire la clé de la base ; la variable d'environnement reprend la main. */
export async function supprimerCle(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requireRole('admin');

    const parse = z
      .object({ nom: z.string().trim() })
      .safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const { estCleGeree, CATEGORIE_SECRET, chargerSecrets } = await import('@vigon/services');
    if (!estCleGeree(parse.data.nom)) {
      return { ok: false, message: 'Clé inconnue.' };
    }

    const db = createAdminClient();
    const { error } = await db
      .from('parametres')
      .delete()
      .eq('tenant_id', utilisateur.tenant_id)
      .eq('cle', parse.data.nom)
      .eq('categorie', CATEGORIE_SECRET);

    if (error) return { ok: false, message: error.message };

    await chargerSecrets(utilisateur.tenant_id, { force: true });

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'parametres',
      entite_id: null,
      action: 'cle_api.supprimee',
      details: { cle: parse.data.nom },
    });

    revalidatePath('/admin');
    return {
      ok: true,
      message: `${parse.data.nom} retirée de la base. La variable d'environnement reprend la main si elle existe.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Teste un service avec la configuration courante.
 *
 * Exerce un vrai appel plutôt que de vérifier la présence de la clé : une clé
 * présente mais révoquée passerait un simple contrôle d'existence.
 */
export async function testerService(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requireRole('admin');

    const parse = z
      .object({
        service: z.enum(['ia', 'firecrawl', 'gamma', 'imap', 'envoi', 'whatsapp', 'telegram']),
      })
      .safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Service inconnu.' };

    const services = await import('@vigon/services');
    await services.chargerSecrets(utilisateur.tenant_id, { force: true });

    switch (parse.data.service) {
      case 'ia': {
        const { z: zod } = await import('zod');
        const resultat = await services.genererJson(
          'Réponds uniquement {"ok": true} en JSON.',
          zod.object({ ok: zod.boolean() }),
          { tentatives: 1 },
        );
        // `descriptionIA()` nomme le principal ET les secours : c'est le seul
        // endroit où l'on voit qu'un repli existe, avant d'en avoir besoin.
        return {
          ok: true,
          message: `${services.descriptionIA()} répond (ok=${resultat.ok}).`,
        };
      }

      case 'firecrawl': {
        const r = await services.rechercher('test', { limite: 1 });
        return { ok: true, message: `Firecrawl répond — ${r.length} résultat(s).` };
      }

      case 'gamma': {
        if (!services.gammaConfigure()) {
          return {
            ok: false,
            message: 'Aucune clé Gamma : les offres sont produites en PDF local.',
          };
        }
        return { ok: true, message: 'Clé Gamma présente (génération non déclenchée).' };
      }

      case 'imap': {
        const n = await services.verifierAccesImap();
        return { ok: true, message: `Boîte joignable — ${n} message(s).` };
      }

      case 'envoi': {
        const detail = await services.verifierEnvoi('fournisseur');
        return { ok: true, message: detail };
      }

      case 'whatsapp': {
        // Absence traitée en information et non en erreur : le canal est
        // facultatif, la validation part par courriel sans lui.
        if (!services.whatsappConfigure()) {
          return {
            ok: false,
            message:
              'WhatsApp non configuré : la validation part par courriel. ' +
              'Renseigner le jeton et l’identifiant de numéro ci-dessus.',
          };
        }
        // Interroge la fiche du numéro plutôt que d'envoyer : éprouve le jeton
        // ET l'existence du numéro sans déranger personne.
        const detail = await services.verifierAccesWhatsApp();
        return { ok: true, message: `WhatsApp répond — ${detail}` };
      }

      case 'telegram': {
        if (!services.telegramConfigure()) {
          return {
            ok: false,
            message:
              'Telegram non configuré : la validation part par WhatsApp ou courriel. ' +
              'Renseigner le jeton du bot ci-dessus.',
          };
        }
        // `getMe` plutôt qu'un envoi : éprouve le jeton sans écrire à personne.
        const detail = await services.verifierAccesTelegram();
        return { ok: true, message: `Telegram répond — bot ${detail}` };
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message: message.slice(0, 400) };
  }
}
