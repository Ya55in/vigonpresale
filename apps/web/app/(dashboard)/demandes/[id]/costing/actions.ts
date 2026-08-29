'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { ErreurAutorisation, requirePermissionApi } from '@/lib/auth/guards';
import type { ProfilUtilisateur } from '@/lib/auth/session';
import { decider, motifEscalade, type Seuils } from '@/lib/costing/escalade';
import { tauxAStocker, type ModeCalcul } from '@/lib/costing/marge';
import { createAdminClient } from '@/lib/supabase/admin';
import type { TablesUpdate } from '@/lib/supabase/types';

export type Resultat =
  | { ok: true; message?: string }
  | { ok: false; message: string };

/** Une feuille verrouillée ne se modifie plus : toute reprise crée une version. */
const STATUT_VERROUILLE = 'verrouille';

function enEchec(e: unknown): Resultat {
  if (e instanceof ErreurAutorisation) return { ok: false, message: e.message };
  console.error('[costing] action en échec', e);
  return { ok: false, message: "L'opération a échoué. Réessayez." };
}

async function demandeDuTenant(
  utilisateur: ProfilUtilisateur,
  demandeId: number,
): Promise<{ id: number; code: string } | null> {
  const { data } = await createAdminClient()
    .from('demandes')
    .select('id, code')
    .eq('id', demandeId)
    .eq('tenant_id', utilisateur.tenant_id)
    .maybeSingle();
  return data;
}

/** Seuils d'escalade, lus en base (FINANCE les ajuste sans redéploiement). */
async function lireSeuils(tenant: string): Promise<Seuils> {
  const { lireParametres } = await import('@vigon/services');
  const p = await lireParametres(tenant);
  return {
    margeMin: p.seuilValidationFinanceMargeMin,
    montantMax: p.seuilValidationFinanceMontant,
  };
}

/**
 * Recalcule les totaux de la feuille depuis ses lignes.
 *
 * Les totaux de LIGNE sont générés en base ; ceux de la FEUILLE sont leur somme,
 * qu'aucune colonne générée ne fournit. On les agrège donc à partir des valeurs
 * déjà calculées par Postgres — jamais en refaisant le calcul de prix.
 */
async function rafraichirTotaux(feuilleId: number): Promise<void> {
  const db = createAdminClient();

  const { data: lignes } = await db
    .from('cost_lines')
    .select(
      'quantite, prix_achat_ht, cout_additionnel, total_ligne_ht, total_ligne_ttc, marge_pct',
    )
    .eq('cost_sheet_id', feuilleId);

  let totalAchat = 0;
  let totalCoutsAdd = 0;
  let totalVenteHt = 0;
  let totalTtc = 0;

  for (const l of lignes ?? []) {
    const quantite = Number(l.quantite ?? 0);
    totalAchat += Number(l.prix_achat_ht ?? 0) * quantite;
    totalCoutsAdd += Number(l.cout_additionnel ?? 0) * quantite;
    totalVenteHt += Number(l.total_ligne_ht ?? 0);
    totalTtc += Number(l.total_ligne_ttc ?? 0);
  }

  const coutTotal = totalAchat + totalCoutsAdd;
  const margeValeur = totalVenteHt - coutTotal;

  // Marge globale exprimée en markup, cohérente avec les colonnes générées.
  const margeGlobalePct = coutTotal > 0 ? (margeValeur / coutTotal) * 100 : 0;

  /*
   * `marge_valeur` EST UNE COLONNE GÉNÉRÉE — ne jamais l'écrire.
   *
   * Elle figurait dans cet UPDATE. Postgres refuse alors la requête ENTIÈRE
   * (« column marge_valeur can only be updated to DEFAULT »), et l'erreur
   * n'était pas lue : aucun total de feuille n'était donc rafraîchi, en
   * silence. Le symptôme est invisible à la construction — les lignes, elles,
   * ont bien leurs totaux générés — et n'apparaît qu'en lisant la feuille.
   *
   * Trouvé le 2026-08-21 par `essai:parcours`, qui a buté sur le même refus en
   * verrouillant sa feuille.
   *
   * `margeValeur` reste calculée au-dessus : elle sert au taux global, qui
   * n'est pas généré.
   */
  const { error } = await db
    .from('cost_sheets')
    .update({
      total_achat_ht: totalAchat,
      total_couts_add: totalCoutsAdd,
      total_vente_ht: totalVenteHt,
      total_tva: totalTtc - totalVenteHt,
      total_ttc: totalTtc,
      marge_globale_pct: margeGlobalePct,
      updated_at: new Date().toISOString(),
    })
    .eq('id', feuilleId);

  // Journalisé, jamais avalé : c'est son absence qui a rendu le défaut muet.
  if (error) {
    console.error(`[costing] totaux non rafraîchis sur la feuille ${feuilleId} : ${error.message}`);
  }
}

const creationSchema = z.object({
  demandeId: z.coerce.number().int().positive(),
  /** ligneDevisId retenu pour chaque demande_item, encodé en JSON. */
  selection: z.string(),
  margeGlobalePct: z.coerce.number().min(0).max(1000),
  modeCalcul: z.enum(['markup', 'marge']),
});

/**
 * Crée (ou remplace) la feuille de coûts à partir des offres retenues.
 *
 * Si la version courante est verrouillée, une nouvelle version est créée :
 * la spec impose qu'une modification après verrouillage n'écrase jamais la
 * feuille validée.
 */
export async function construireFeuille(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('costing.creer');

    const parse = creationSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { demandeId, margeGlobalePct, modeCalcul } = parse.data;

    const demande = await demandeDuTenant(utilisateur, demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    let selection: Record<string, number>;
    try {
      selection = JSON.parse(parse.data.selection) as Record<string, number>;
    } catch {
      return { ok: false, message: 'Sélection illisible.' };
    }

    const idsRetenus = Object.values(selection).filter((v) => Number.isFinite(v));
    if (idsRetenus.length === 0) {
      return { ok: false, message: 'Retenez au moins une offre.' };
    }

    const db = createAdminClient();

    // Les lignes retenues doivent appartenir à des devis de CETTE demande :
    // sans ce contrôle, un identifiant forgé importerait le prix d'un autre dossier.
    const { data: devisDemande } = await db
      .from('devis_fournisseur')
      .select('id')
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id);

    const devisAutorises = new Set((devisDemande ?? []).map((d) => d.id));

    const { data: lignesDevis } = await db
      .from('lignes_devis')
      .select(
        'id, devis_id, demande_item_id, designation_fournisseur, reference, quantite, unite, prix_achat_net_ht, tva_pct, disponibilite',
      )
      .in('id', idsRetenus);

    const valides = (lignesDevis ?? []).filter(
      (l) => l.devis_id !== null && devisAutorises.has(l.devis_id),
    );

    if (valides.length === 0) {
      return { ok: false, message: 'Aucune offre valide pour cette demande.' };
    }

    const { data: articles } = await db
      .from('demande_items')
      .select('id, ligne_num, designation, reference, specifications')
      .eq('demande_id', demandeId);

    const articleParId = new Map((articles ?? []).map((a) => [a.id, a]));

    const { data: consultations } = await db
      .from('consultations')
      .select('id, fournisseur_id')
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id);

    const { data: devisComplets } = await db
      .from('devis_fournisseur')
      .select('id, consultation_id')
      .in('id', [...devisAutorises].length ? [...devisAutorises] : [-1]);

    const fournisseurParDevis = new Map<number, number | null>();
    for (const d of devisComplets ?? []) {
      const c = (consultations ?? []).find((x) => x.id === d.consultation_id);
      fournisseurParDevis.set(d.id, c?.fournisseur_id ?? null);
    }

    // Version suivante s'il existe déjà une feuille verrouillée.
    const { data: courante } = await db
      .from('cost_sheets')
      .select('id, version, statut')
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    const tauxStocke = tauxAStocker(margeGlobalePct, modeCalcul as ModeCalcul);

    let feuilleId: number;

    if (courante && courante.statut !== STATUT_VERROUILLE) {
      // Brouillon ou feuille soumise : on la reconstruit en place.
      feuilleId = courante.id;
      await db.from('cost_lines').delete().eq('cost_sheet_id', feuilleId);
      await db
        .from('cost_sheets')
        .update({
          mode_calcul: modeCalcul,
          marge_globale_pct: tauxStocke,
          statut: 'brouillon',
        })
        .eq('id', feuilleId);
    } else {
      const { data: creee, error } = await db
        .from('cost_sheets')
        .insert({
          tenant_id: utilisateur.tenant_id,
          demande_id: demandeId,
          version: (courante?.version ?? 0) + 1,
          mode_calcul: modeCalcul,
          marge_globale_pct: tauxStocke,
          statut: 'brouillon',
          cree_par: utilisateur.id,
        })
        .select('id')
        .single();

      if (error) return { ok: false, message: error.message };
      feuilleId = creee.id;
    }

    const lignes = valides.map((l, index) => {
      const article = l.demande_item_id === null ? null : articleParId.get(l.demande_item_id);
      return {
        cost_sheet_id: feuilleId,
        demande_item_id: l.demande_item_id,
        ligne_devis_id: l.id,
        fournisseur_id: l.devis_id === null ? null : (fournisseurParDevis.get(l.devis_id) ?? null),
        ligne_num: article?.ligne_num ?? index + 1,
        // La désignation client vient de la demande, pas du fournisseur : elle
        // finira dans l'offre, où le fournisseur ne doit pas apparaître.
        designation_client: article?.designation ?? l.designation_fournisseur ?? 'Article',
        description_technique: article?.specifications ?? null,
        reference: article?.reference ?? l.reference,
        quantite: Number(l.quantite ?? 1),
        unite: l.unite ?? 'unité',
        prix_achat_ht: Number(l.prix_achat_net_ht ?? 0),
        marge_pct: tauxStocke,
        tva_pct: Number(l.tva_pct ?? 20),
      };
    });

    const { error: erreurLignes } = await db.from('cost_lines').insert(lignes);
    if (erreurLignes) return { ok: false, message: erreurLignes.message };

    await rafraichirTotaux(feuilleId);

    await db
      .from('demandes')
      .update({ statut: 'en_costing', date_costing: new Date().toISOString() })
      .eq('id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id);

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'cost_sheets',
      entite_id: feuilleId,
      action: 'costing.construit',
      details: {
        code: demande.code,
        lignes: lignes.length,
        mode_calcul: modeCalcul,
        marge_saisie_pct: margeGlobalePct,
        marge_stockee_markup_pct: tauxStocke,
      },
    });

    revalidatePath(`/demandes/${demandeId}/costing`);
    return { ok: true, message: `Feuille de coûts construite — ${lignes.length} ligne(s).` };
  } catch (e) {
    return enEchec(e);
  }
}

const ligneSchema = z.object({
  demandeId: z.coerce.number().int().positive(),
  ligneId: z.coerce.number().int().positive(),
  margePct: z.coerce.number().min(0).max(1000).optional(),
  coutAdditionnel: z.coerce.number().min(0).optional(),
  coutLibelle: z.string().trim().max(200).optional(),
  commentaire: z.string().trim().max(1000).optional(),
});

/** Ajuste une ligne : marge, coût additionnel, commentaire. */
export async function modifierLigne(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('costing.modifier');

    const parse = ligneSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { demandeId, ligneId, margePct, coutAdditionnel, coutLibelle, commentaire } =
      parse.data;

    if (!(await demandeDuTenant(utilisateur, demandeId))) {
      return { ok: false, message: 'Demande introuvable.' };
    }

    const db = createAdminClient();

    const { data: ligne } = await db
      .from('cost_lines')
      .select('id, cost_sheet_id, cost_sheets!inner(demande_id, tenant_id, statut, mode_calcul)')
      .eq('id', ligneId)
      .maybeSingle();

    const feuille = ligne
      ? Array.isArray(ligne.cost_sheets)
        ? ligne.cost_sheets[0]
        : ligne.cost_sheets
      : null;

    if (
      !ligne ||
      !feuille ||
      feuille.demande_id !== demandeId ||
      feuille.tenant_id !== utilisateur.tenant_id
    ) {
      return { ok: false, message: 'Ligne introuvable.' };
    }

    if (feuille.statut === STATUT_VERROUILLE) {
      return {
        ok: false,
        message: 'Feuille verrouillée : reconstruisez-la pour créer une nouvelle version.',
      };
    }

    // Un coût additionnel sans justification est intraçable en revue FINANCE :
    // la spec le rend obligatoire.
    if ((coutAdditionnel ?? 0) > 0 && !coutLibelle && !commentaire) {
      return {
        ok: false,
        message: 'Un coût additionnel exige un libellé ou un commentaire.',
      };
    }

    const maj: TablesUpdate<'cost_lines'> = {};
    if (margePct !== undefined) {
      maj.marge_pct = tauxAStocker(margePct, (feuille.mode_calcul ?? 'markup') as ModeCalcul);
    }
    if (coutAdditionnel !== undefined) maj.cout_additionnel = coutAdditionnel;
    if (coutLibelle !== undefined) maj.cout_additionnel_libelle = coutLibelle || null;
    if (commentaire !== undefined) maj.commentaire = commentaire || null;

    if (Object.keys(maj).length === 0) return { ok: true };

    const { error } = await db.from('cost_lines').update(maj).eq('id', ligneId);
    if (error) return { ok: false, message: error.message };

    await rafraichirTotaux(ligne.cost_sheet_id!);

    revalidatePath(`/demandes/${demandeId}/costing`);
    return { ok: true };
  } catch (e) {
    return enEchec(e);
  }
}

/** Applique une marge à toutes les lignes de la feuille courante. */
export async function appliquerMargeGlobale(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('marge.definir');

    const parse = z
      .object({
        demandeId: z.coerce.number().int().positive(),
        margePct: z.coerce.number().min(0).max(1000),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { demandeId, margePct } = parse.data;

    if (!(await demandeDuTenant(utilisateur, demandeId))) {
      return { ok: false, message: 'Demande introuvable.' };
    }

    const db = createAdminClient();
    const { data: feuille } = await db
      .from('cost_sheets')
      .select('id, statut, mode_calcul')
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!feuille) return { ok: false, message: 'Aucune feuille de coûts.' };
    if (feuille.statut === STATUT_VERROUILLE) {
      return { ok: false, message: 'Feuille verrouillée.' };
    }

    const tauxStocke = tauxAStocker(margePct, (feuille.mode_calcul ?? 'markup') as ModeCalcul);

    await db.from('cost_lines').update({ marge_pct: tauxStocke }).eq('cost_sheet_id', feuille.id);
    await db
      .from('cost_sheets')
      .update({ marge_globale_pct: tauxStocke })
      .eq('id', feuille.id);

    await rafraichirTotaux(feuille.id);

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'cost_sheets',
      entite_id: feuille.id,
      action: 'marge.definie',
      details: { marge_saisie_pct: margePct, mode: feuille.mode_calcul },
    });

    revalidatePath(`/demandes/${demandeId}/costing`);
    return { ok: true, message: `Marge de ${margePct} % appliquée à toutes les lignes.` };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Valide et verrouille, ou soumet à FINANCE selon les seuils.
 *
 * La décision est reprise côté serveur : le libellé du bouton côté client n'est
 * qu'un affichage, jamais une autorisation.
 */
export async function validerCosting(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('costing.valider');

    const parse = z
      .object({ demandeId: z.coerce.number().int().positive() })
      .safeParse(Object.fromEntries(donnees));
    if (!parse.success) return { ok: false, message: 'Données invalides.' };

    const demande = await demandeDuTenant(utilisateur, parse.data.demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    const db = createAdminClient();
    const { data: feuille } = await db
      .from('cost_sheets')
      .select('id, version, statut, marge_globale_pct, total_ttc')
      .eq('demande_id', demande.id)
      .eq('tenant_id', utilisateur.tenant_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!feuille) return { ok: false, message: 'Aucune feuille de coûts.' };
    if (feuille.statut === STATUT_VERROUILLE) {
      return { ok: false, message: 'Feuille déjà verrouillée.' };
    }

    const valeurs = {
      marge_globale_pct: Number(feuille.marge_globale_pct ?? 0),
      total_ttc: Number(feuille.total_ttc ?? 0),
    };

    const seuils = await lireSeuils(utilisateur.tenant_id);
    const decision = decider(utilisateur.role, valeurs, seuils);

    // --- Escalade imposée : on soumet, on ne verrouille pas ---
    if (!decision.autorise) {
      if (!decision.escalade) {
        return { ok: false, message: decision.motif ?? 'Validation non autorisée.' };
      }

      await db.from('cost_sheets').update({ statut: 'soumis' }).eq('id', feuille.id);

      await db.from('notifications').insert({
        tenant_id: utilisateur.tenant_id,
        role_cible: 'finance',
        type: 'costing_a_valider',
        severite: 'avertissement',
        titre: `Costing à valider — ${demande.code}`,
        message: decision.motif ?? 'Hors seuils de validation avant-vente.',
        lien: `/demandes/${demande.id}/costing`,
        demande_id: demande.id,
      });

      await db.from('audit_events').insert({
        tenant_id: utilisateur.tenant_id,
        user_id: utilisateur.id,
        entite: 'cost_sheets',
        entite_id: feuille.id,
        action: 'costing.soumis_finance',
        details: {
          code: demande.code,
          version: feuille.version,
          // Colonnes absentes du schéma : l'audit en est le seul dépositaire.
          escalade_finance: true,
          validateur_role: null,
          motif_escalade: decision.motif,
          marge_globale_pct: valeurs.marge_globale_pct,
          total_ttc: valeurs.total_ttc,
          seuils,
        },
      });

      revalidatePath(`/demandes/${demande.id}/costing`);
      revalidatePath('/finance');
      return { ok: true, message: `Soumis à FINANCE — ${decision.motif ?? ''}` };
    }

    // --- Validation directe et verrouillage ---
    const { data: verrou } = await db
      .from('cost_sheets')
      .update({
        statut: STATUT_VERROUILLE,
        valide_par: utilisateur.id,
        valide_at: new Date().toISOString(),
      })
      .eq('id', feuille.id)
      .neq('statut', STATUT_VERROUILLE)
      .select('id');

    if (!verrou || verrou.length === 0) {
      return { ok: false, message: 'Feuille déjà verrouillée par ailleurs.' };
    }

    await db
      .from('demandes')
      .update({ statut: 'marge_validee' })
      .eq('id', demande.id)
      .eq('tenant_id', utilisateur.tenant_id);

    await db.from('notifications').insert({
      tenant_id: utilisateur.tenant_id,
      role_cible: 'presale',
      type: 'costing_verrouille',
      severite: 'info',
      titre: `Costing validé — ${demande.code}`,
      message: `Marge ${valeurs.marge_globale_pct.toFixed(1)} % verrouillée par ${utilisateur.role}. L'offre peut être générée.`,
      lien: `/demandes/${demande.id}/costing`,
      demande_id: demande.id,
    });

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'cost_sheets',
      entite_id: feuille.id,
      action: 'costing.verrouille',
      details: {
        code: demande.code,
        version: feuille.version,
        escalade_finance: false,
        validateur_role: utilisateur.role,
        marge_globale_pct: valeurs.marge_globale_pct,
        total_ttc: valeurs.total_ttc,
        seuils,
      },
    });

    revalidatePath(`/demandes/${demande.id}/costing`);
    revalidatePath('/finance');
    return { ok: true, message: 'Costing validé et verrouillé.' };
  } catch (e) {
    return enEchec(e);
  }
}

/** FINANCE renvoie la feuille à PRESALE avec un motif. */
export async function renvoyerCosting(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('costing.reviser');

    const parse = z
      .object({
        demandeId: z.coerce.number().int().positive(),
        motif: z.string().trim().min(3, 'Indiquez un motif.').max(1000),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { demandeId, motif } = parse.data;

    const demande = await demandeDuTenant(utilisateur, demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    const db = createAdminClient();
    const { data: feuille } = await db
      .from('cost_sheets')
      .select('id, version')
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!feuille) return { ok: false, message: 'Aucune feuille de coûts.' };

    await db.from('cost_sheets').update({ statut: 'brouillon' }).eq('id', feuille.id);

    await db.from('notifications').insert({
      tenant_id: utilisateur.tenant_id,
      role_cible: 'presale',
      type: 'costing_renvoye',
      severite: 'avertissement',
      titre: `Costing renvoyé — ${demande.code}`,
      message: motif,
      lien: `/demandes/${demandeId}/costing`,
      demande_id: demandeId,
    });

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'cost_sheets',
      entite_id: feuille.id,
      action: 'costing.renvoye',
      details: { code: demande.code, version: feuille.version, motif, validateur_role: utilisateur.role },
    });

    revalidatePath(`/demandes/${demandeId}/costing`);
    revalidatePath('/finance');
    return { ok: true, message: 'Costing renvoyé à l’avant-vente.' };
  } catch (e) {
    return enEchec(e);
  }
}

const parFournisseurSchema = z.object({
  demandeId: z.coerce.number().int().positive(),
  margeGlobalePct: z.coerce.number().min(0).max(1000),
  modeCalcul: z.enum(['markup', 'marge']),
});

/**
 * Construit une feuille de coûts par fournisseur ayant répondu.
 *
 * Chaque fournisseur donne lieu à une offre distincte, que le client compare
 * lui-même. C'est un choix métier assumé : retenir d'office le prix le plus bas
 * revenait à trancher à sa place, alors que le délai, la disponibilité ou la
 * cohérence d'un lot chez un seul interlocuteur pèsent souvent davantage que
 * quelques dirhams.
 *
 * Un fournisseur qui n'a chiffré qu'une partie des articles produit malgré tout
 * sa feuille : les articles manquants apparaîtront comme « non proposés » dans
 * l'offre. L'écarter priverait le client d'une option qu'il aurait peut-être
 * retenue — et sur certaines demandes, aucun fournisseur ne couvre tout.
 *
 * Les feuilles verrouillées ne sont jamais touchées : la reconstruction ne
 * remplace que les brouillons, et repart au-dessus de la version la plus haute.
 */
export async function construireFeuillesParFournisseur(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('costing.creer');

    const parse = parFournisseurSchema.safeParse(Object.fromEntries(donnees));
    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }
    const { demandeId, margeGlobalePct, modeCalcul } = parse.data;

    const demande = await demandeDuTenant(utilisateur, demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    const db = createAdminClient();

    const { data: devis } = await db
      .from('devis_fournisseur')
      .select('id, consultation_id, numero_devis')
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id);

    if (!devis || devis.length === 0) {
      return { ok: false, message: 'Aucun devis fournisseur reçu pour cette demande.' };
    }

    const { data: consultations } = await db
      .from('consultations')
      .select('id, fournisseur_id, fournisseur_nom')
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id);

    const consultationParId = new Map((consultations ?? []).map((c) => [c.id, c]));

    const { data: lignesDevis } = await db
      .from('lignes_devis')
      .select(
        'id, devis_id, demande_item_id, designation_fournisseur, reference, quantite, unite, prix_achat_net_ht, tva_pct',
      )
      .in('devis_id', devis.map((d) => d.id));

    const { data: articles } = await db
      .from('demande_items')
      .select('id, ligne_num, designation, reference, specifications, quantite')
      .eq('demande_id', demandeId);

    const articleParId = new Map((articles ?? []).map((a) => [a.id, a]));

    // Regroupement par fournisseur, et non par devis : un même fournisseur peut
    // avoir répondu en plusieurs envois, qui doivent former une seule offre.
    type LigneDevis = NonNullable<typeof lignesDevis>[number];
    type Groupe = { nom: string; fournisseurId: number | null; lignes: LigneDevis[] };
    const groupes = new Map<string, Groupe>();

    for (const ligne of lignesDevis ?? []) {
      if (ligne.demande_item_id === null || ligne.devis_id === null) continue;

      const d = devis.find((x) => x.id === ligne.devis_id);
      const consultation =
        d?.consultation_id == null ? undefined : consultationParId.get(d.consultation_id);

      const fournisseurId = consultation?.fournisseur_id ?? null;
      const nom = consultation?.fournisseur_nom ?? 'Fournisseur inconnu';
      const cle = fournisseurId === null ? `nom:${nom}` : `id:${fournisseurId}`;

      const groupe = groupes.get(cle) ?? { nom, fournisseurId, lignes: [] };
      groupe.lignes.push(ligne);
      groupes.set(cle, groupe);
    }

    if (groupes.size === 0) {
      return { ok: false, message: 'Aucune ligne de devis exploitable.' };
    }

    // Les brouillons de la série précédente sont remplacés ; les feuilles
    // verrouillées restent, et la nouvelle série se numérote au-dessus.
    const { data: existantes } = await db
      .from('cost_sheets')
      .select('id, version, statut')
      .eq('demande_id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id)
      .order('version', { ascending: false });

    for (const f of existantes ?? []) {
      if (f.statut === STATUT_VERROUILLE) continue;
      await db.from('cost_lines').delete().eq('cost_sheet_id', f.id);
      await db.from('cost_sheets').delete().eq('id', f.id);
    }

    const verrouillees = (existantes ?? []).filter((f) => f.statut === STATUT_VERROUILLE);
    let version = verrouillees.length > 0 ? Math.max(...verrouillees.map((f) => f.version)) : 0;

    const tauxStocke = tauxAStocker(margeGlobalePct, modeCalcul as ModeCalcul);
    const resume: string[] = [];

    for (const groupe of groupes.values()) {
      version += 1;

      const { data: creee, error } = await db
        .from('cost_sheets')
        .insert({
          tenant_id: utilisateur.tenant_id,
          demande_id: demandeId,
          version,
          mode_calcul: modeCalcul,
          marge_globale_pct: tauxStocke,
          statut: 'brouillon',
          cree_par: utilisateur.id,
        })
        .select('id')
        .single();

      if (error) return { ok: false, message: error.message };

      // Une seule ligne par article : si le fournisseur a chiffré deux fois la
      // même référence, la moins chère l'emporte — comparer un fournisseur à
      // lui-même n'aurait pas de sens.
      const meilleureParArticle = new Map<number, LigneDevis>();
      for (const l of groupe.lignes) {
        if (l.demande_item_id === null) continue;
        const actuelle = meilleureParArticle.get(l.demande_item_id);
        if (
          !actuelle ||
          Number(l.prix_achat_net_ht ?? 0) < Number(actuelle.prix_achat_net_ht ?? 0)
        ) {
          meilleureParArticle.set(l.demande_item_id, l);
        }
      }

      const lignes = [...meilleureParArticle.entries()].map(([articleId, l], index) => {
        const article = articleParId.get(articleId);
        return {
          cost_sheet_id: creee.id,
          demande_item_id: articleId,
          ligne_devis_id: l.id,
          fournisseur_id: groupe.fournisseurId,
          ligne_num: article?.ligne_num ?? index + 1,
          // La désignation vient de la demande, pas du fournisseur : elle finit
          // dans l'offre, où le fournisseur ne doit pas apparaître.
          designation_client: article?.designation ?? l.designation_fournisseur ?? 'Article',
          description_technique: article?.specifications ?? null,
          reference: article?.reference ?? l.reference,
          quantite: Number(l.quantite ?? article?.quantite ?? 1),
          unite: l.unite ?? 'unité',
          prix_achat_ht: Number(l.prix_achat_net_ht ?? 0),
          marge_pct: tauxStocke,
          tva_pct: Number(l.tva_pct ?? 20),
        };
      });

      const { error: erreurLignes } = await db.from('cost_lines').insert(lignes);
      if (erreurLignes) return { ok: false, message: erreurLignes.message };

      await rafraichirTotaux(creee.id);

      const couverture = `${lignes.length}/${articles?.length ?? lignes.length}`;
      resume.push(`${groupe.nom} (${couverture})`);
    }

    await db
      .from('demandes')
      .update({ statut: 'en_costing', date_costing: new Date().toISOString() })
      .eq('id', demandeId)
      .eq('tenant_id', utilisateur.tenant_id);

    await db.from('audit_events').insert({
      tenant_id: utilisateur.tenant_id,
      user_id: utilisateur.id,
      entite: 'demandes',
      entite_id: demandeId,
      action: 'costing.construit_par_fournisseur',
      details: {
        code: demande.code,
        feuilles: groupes.size,
        mode_calcul: modeCalcul,
        marge_saisie_pct: margeGlobalePct,
      },
    });

    revalidatePath(`/demandes/${demandeId}/costing`);
    return {
      ok: true,
      message: `${groupes.size} feuille(s) construite(s) — ${resume.join(', ')}.`,
    };
  } catch (e) {
    return enEchec(e);
  }
}

/* ------------------------------------------------------------------------- */
/* Circuit d'approbation avant génération de l'offre                          */
/* ------------------------------------------------------------------------- */

/**
 * Soumet la feuille verrouillée à l'accord de l'administrateur.
 *
 * Le lien part par courriel aujourd'hui. Le canal n'est qu'un transport : le
 * jour où le compte WhatsApp Business existera, le même contenu partira par là
 * sans que rien d'autre ne change — la demande, le jeton et la décision sont
 * déjà indépendants du support.
 *
 * L'échec d'envoi ne perd pas la demande : elle est créée, et le lien est
 * renvoyé dans le message pour être transmis autrement. C'est la même règle que
 * pour l'envoi d'offre.
 */
export async function soumettreValidation(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('costing.valider');

    /*
     * PLUS D'ADRESSE SAISIE. L'accord revient à l'administrateur, et le laisser
     * désigner par l'avant-vente vidait la garde de son sens : on choisissait
     * son propre approbateur. `resoudreApprobateurs` tranche à partir des rôles.
     */
    const parse = z
      .object({
        demandeId: z.coerce.number().int().positive(),
        costSheetId: z.coerce.number().int().positive(),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }

    const demande = await demandeDuTenant(utilisateur, parse.data.demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    const { demanderValidation, resoudreApprobateurs, peutApprouverSurPlace } = await import(
      '@/lib/validation/circuit'
    );

    /*
     * Le demandeur est écarté de ses propres destinataires. Sans cela, un
     * administrateur qui soumet sa feuille se réexpédie le lien sur son propre
     * Telegram — un aller-retour hors plateforme pour rien.
     */
    const { destinataires, parSecours } = await resoudreApprobateurs(
      utilisateur.tenant_id,
      utilisateur.id,
    );

    if (destinataires.length === 0) {
      return {
        ok: false,
        message: peutApprouverSurPlace(utilisateur.role)
          ? 'Vous êtes le seul approbateur : donnez l’accord directement depuis cet écran.'
          : 'Aucun administrateur actif pour donner l’accord. Créez-en un dans /admin, ou autorisez un collaborateur à recevoir les validations.',
      };
    }

    const resultat = await demanderValidation({
      tenant: utilisateur.tenant_id,
      utilisateurId: utilisateur.id,
      costSheetId: parse.data.costSheetId,
      canal: 'email',
    });

    if (!resultat.ok) return { ok: false, message: resultat.message };

    const db = createAdminClient();

    const { data: feuille } = await db
      .from('cost_sheets')
      .select('devise, total_vente_ht, total_ttc, marge_globale_pct')
      .eq('id', parse.data.costSheetId)
      .maybeSingle();

    const { data: infos } = await db
      .from('demandes')
      .select('code, titre, clients(nom)')
      .eq('id', demande.id)
      .maybeSingle();

    const client = Array.isArray(infos?.clients) ? infos.clients[0] : infos?.clients;
    const devise = feuille?.devise ?? 'MAD';

    const format = (v: unknown): string =>
      `${Number(v ?? 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${devise}`;

    const {
      buildValidationHtml,
      envoyer,
      envoiConfigure,
      sujetValidation,
      texteValidation,
      whatsappConfigure,
      envoyerWhatsApp,
      telegramConfigure,
      envoyerTelegram,
      chargerSecrets,
    } = await import('@vigon/services');

    /*
     * Sans cet appel, une clé saisie dans /admin resterait invisible ICI.
     *
     * Les clés gérées vivent dans `parametres`, pas dans l'environnement du
     * processus : `chargerSecrets` les y injecte. L'écran d'administration et
     * le worker l'appellent déjà ; cette action ne le faisait pas, et
     * `whatsappConfigure()` aurait donc répondu « non configuré » pour
     * toujours — la validation serait repartie par courriel sans que personne
     * ne comprenne pourquoi la clé ne « prenait » pas.
     *
     * Le cache interne est d'une minute : l'appel par requête ne coûte rien.
     */
    await chargerSecrets(utilisateur.tenant_id);

    const params = {
      demandeCode: infos?.code ?? null,
      clientNom: client?.nom ?? null,
      objet: infos?.titre ?? null,
      totalHt: format(feuille?.total_vente_ht),
      totalTtc: format(feuille?.total_ttc),
      margePct:
        feuille?.marge_globale_pct === null || feuille?.marge_globale_pct === undefined
          ? null
          : Number(feuille.marge_globale_pct),
      lienValidation: resultat.lien,
      expireLe: new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('fr-FR'),
      demandePar: utilisateur.nom ?? null,
    };

    /*
     * TROIS CANAUX, ESSAYÉS DANS L'ORDRE : Telegram, WhatsApp, courriel.
     *
     * La spec décrivait ce circuit par WhatsApp ; il a été livré par courriel
     * parce que le compte Business n'existait pas. Telegram s'est ajouté le
     * 2026-08-20, WhatsApp restant bloqué côté Meta — Business Portfolio non
     * vérifié et carte bancaire marocaine refusée sur la vérification
     * récurrente, deux points sur lesquels le code ne peut rien.
     *
     * Telegram d'abord parce que c'est le seul canal instantané réellement
     * opérationnel aujourd'hui. L'ordre se lit dans ce tableau et nulle part
     * ailleurs : le jour où WhatsApp se débloque, on échange deux lignes.
     *
     * Le contenu ne change pas d'un canal à l'autre — `texteValidation` a été
     * rédigé en texte brut d'emblée, précisément pour des canaux sans HTML.
     *
     * REPLI SILENCIEUX à chaque étage : clé absente, identifiant absent sur la
     * fiche, ou refus du fournisseur, et le canal suivant prend le relais. Une
     * validation qui ne part pas bloquerait la génération de l'offre — ce
     * circuit doit avoir plusieurs jambes.
     */
    for (const cible of destinataires) {
      const canaux: {
        nom: 'telegram' | 'whatsapp';
        configure: boolean;
        adresse: string | null;
        envoyer: (adresse: string) => Promise<unknown>;
        libelle: (adresse: string) => string;
      }[] = [
        {
          nom: 'telegram',
          configure: telegramConfigure(),
          adresse: cible.telegramChatId,
          // Le lien est passé à part : Telegram n'autolie pas une adresse en
          // texte brut, et l'approbateur aurait dû la recopier à la main.
          envoyer: (chatId) =>
            envoyerTelegram({
              chatId,
              texte: texteValidation(params),
              lien: resultat.lien,
            }),
          libelle: () => 'Telegram',
        },
        {
          nom: 'whatsapp',
          configure: whatsappConfigure(),
          adresse: cible.telephone,
          envoyer: (numero) =>
            envoyerWhatsApp({ destinataire: numero, texte: texteValidation(params) }),
          libelle: (numero) => `WhatsApp au ${numero}`,
        },
      ];

      for (const canal of canaux) {
        if (!canal.configure || !canal.adresse) continue;

        try {
          await canal.envoyer(canal.adresse);

          await db
            .from('validations_offre')
            .update({ canal: canal.nom })
            .eq('token_public', resultat.token);

          revalidatePath(`/demandes/${demande.id}/costing`);
          return {
            ok: true,
            message:
              `Demande envoyée par ${canal.libelle(canal.adresse)} à ${cible.nom ?? cible.email}.` +
              (parSecours ? ' Aucun administrateur joignable — envoyée au suppléant.' : ''),
          };
        } catch (e) {
          // Journalisé et non remonté : le canal suivant part juste après, et
          // l'utilisateur n'a pas à arbitrer un incident de transport.
          console.error(`[validation] ${canal.nom} indisponible, canal suivant`, e);
        }
      }
    }

    // Dernier recours : le courriel, à tous les destinataires résolus. Aucun
    // canal instantané n'a abouti, mais la demande doit partir — sans elle, la
    // génération de l'offre reste bloquée.
    const adresses = destinataires.map((d) => d.email);

    if (!envoiConfigure('principal')) {
      return {
        ok: true,
        message: `Demande enregistrée. Aucun transport configuré : transmettez ce lien — ${resultat.lien}`,
      };
    }

    try {
      await envoyer('principal', {
        a: adresses[0]!,
        cc: adresses.slice(1),
        sujet: sujetValidation({ demandeCode: params.demandeCode, totalTtc: params.totalTtc }),
        html: buildValidationHtml(params),
        texte: texteValidation(params),
      });
    } catch (e) {
      console.error('[validation] envoi impossible', e);
      return {
        ok: true,
        message: `Demande enregistrée mais courriel non parti. Transmettez ce lien — ${resultat.lien}`,
      };
    }

    revalidatePath(`/demandes/${demande.id}/costing`);
    return { ok: true, message: `Demande envoyée par courriel à ${adresses.join(', ')}.` };
  } catch (e) {
    return enEchec(e);
  }
}

/**
 * Accord donné sans escalade, par l'administrateur lui-même.
 *
 * L'ESCALADE VA VERS QUELQU'UN D'AUTRE. Quand l'administrateur est celui qui
 * travaille l'opportunité, il n'y a personne au-dessus à qui demander : la
 * décision se prend ici, devant les montants, et débloque la génération de la
 * même façon qu'un accord venu de Telegram.
 *
 * `costing.valider` ne suffit pas — l'avant-vente l'a aussi, et pourrait alors
 * s'auto-approuver, ce qui viderait le circuit de son sens. La garde est le
 * rôle, lu côté serveur.
 */
export async function approuverSurPlaceAction(
  _etat: Resultat | null,
  donnees: FormData,
): Promise<Resultat> {
  try {
    const utilisateur = await requirePermissionApi('costing.valider');

    const { approuverSurPlace, peutApprouverSurPlace } = await import(
      '@/lib/validation/circuit'
    );

    if (!peutApprouverSurPlace(utilisateur.role)) {
      return {
        ok: false,
        message: 'Seul un administrateur donne l’accord. Soumettez la feuille à validation.',
      };
    }

    const parse = z
      .object({
        demandeId: z.coerce.number().int().positive(),
        costSheetId: z.coerce.number().int().positive(),
      })
      .safeParse(Object.fromEntries(donnees));

    if (!parse.success) {
      return { ok: false, message: parse.error.issues[0]?.message ?? 'Données invalides.' };
    }

    // Le tenant est revérifié ici : `approuverSurPlace` filtre la feuille, mais
    // la demande doit elle aussi appartenir à l'utilisateur pour que le
    // rafraîchissement de page ne serve pas d'oracle.
    const demande = await demandeDuTenant(utilisateur, parse.data.demandeId);
    if (!demande) return { ok: false, message: 'Demande introuvable.' };

    const resultat = await approuverSurPlace({
      tenant: utilisateur.tenant_id,
      utilisateurId: utilisateur.id,
      costSheetId: parse.data.costSheetId,
    });

    if (resultat.ok) revalidatePath(`/demandes/${demande.id}/costing`);

    return { ok: resultat.ok, message: resultat.message };
  } catch (e) {
    return enEchec(e);
  }
}
