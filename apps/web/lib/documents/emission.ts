import {
  LIBELLES_DOCUMENT,
  PREFIXES_DOCUMENT,
  calculerTotaux,
  contenuDocumentSchema,
  type ContenuDocument,
  type LigneDocument,
  type TypeDocument,
} from '@vigon/shared';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Émission d'un document financier à partir d'une offre approuvée.
 *
 * Le contenu est repris du BoQ figé dans `offres.source_json`, jamais recalculé
 * depuis la feuille de coûts : celle-ci peut avoir bougé depuis, et une facture
 * qui ne correspond pas à l'offre signée est un litige.
 */

export type ResultatEmission =
  | { ok: true; id: number; numero: string }
  | { ok: false; message: string };

/**
 * Numéro séquentiel, par tenant, par type et par année.
 *
 * Compté plutôt que tiré d'une séquence Postgres : `gen_code` s'appuie sur des
 * séquences déclarées en base qu'on ne peut pas ajouter d'ici. L'index unique
 * `(tenant_id, numero)` rattrape la collision de deux émissions simultanées, et
 * l'appelant réessaie — un numéro sauté serait plus gênant qu'un échec visible,
 * la séquence devant rester continue pour être opposable.
 */
async function prochainNumero(tenant: string, type: TypeDocument): Promise<string> {
  const annee = new Date().getFullYear();

  const { count } = await createAdminClient()
    .from('documents_financiers')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant)
    .eq('type', type)
    .gte('date_emission', `${annee}-01-01`);

  return `${PREFIXES_DOCUMENT[type]}-${annee}-${String((count ?? 0) + 1).padStart(4, '0')}`;
}

/** Lignes du BoQ ramenées à ce qu'un document financier doit porter. */
function lignesDepuisBoq(boq: Record<string, unknown>): LigneDocument[] {
  const produits = Array.isArray(boq.produits) ? boq.produits : [];

  return produits.map((p) => {
    const produit = p as Record<string, unknown>;
    const quantite = Number(produit.quantite ?? 1);
    const prixUnitaireHt = Number(produit.prixUnitaireHt ?? 0);

    return {
      designation: String(produit.designation ?? 'Article'),
      reference: produit.reference ? String(produit.reference) : null,
      quantite,
      unite: String(produit.unite ?? 'u'),
      prixUnitaireHt,
      // Recalculé et non repris : un total de ligne qui ne découle pas de son
      // prix et de sa quantité est le genre d'écart qu'on découvre au litige.
      totalHt: Math.round(quantite * prixUnitaireHt * 100) / 100,
    };
  });
}

export async function emettreDocument(params: {
  tenant: string;
  utilisateurId: string;
  offreId: number;
  type: TypeDocument;
  /** Échéance de règlement, pour les factures. */
  dateEcheance?: string;
  notes?: string;
}): Promise<ResultatEmission> {
  const { tenant, utilisateurId, offreId, type } = params;
  const db = createAdminClient();

  const { data: offre } = await db
    .from('offres')
    .select('id, numero, titre, statut, demande_id, source_json')
    .eq('id', offreId)
    .eq('tenant_id', tenant)
    .maybeSingle();

  if (!offre) return { ok: false, message: 'Offre introuvable.' };

  // Une facture sur une offre que le client n'a pas approuvée n'a aucune base :
  // c'est le bon de commande qui matérialise son accord.
  if (offre.statut !== 'approuvee') {
    return {
      ok: false,
      message: `${LIBELLES_DOCUMENT[type]} : l'offre doit être approuvée par le client.`,
    };
  }

  const boq = offre.source_json as Record<string, unknown> | null;
  if (!boq) return { ok: false, message: 'Offre sans contenu exploitable.' };

  const lignes = lignesDepuisBoq(boq);
  if (lignes.length === 0) return { ok: false, message: 'Offre sans ligne.' };

  const totauxBoq = (boq.totaux ?? {}) as Record<string, unknown>;
  const tvaPct = Number(totauxBoq.tvaPct ?? 20);
  const devise = String(totauxBoq.devise ?? 'MAD');

  const totaux = calculerTotaux(lignes, tvaPct);

  const { data: demande } = offre.demande_id
    ? await db
        .from('demandes')
        .select('id, code, client_id, clients(nom, adresse, email_principal)')
        .eq('id', offre.demande_id)
        .maybeSingle()
    : { data: null };

  const client = Array.isArray(demande?.clients) ? demande.clients[0] : demande?.clients;
  const conditions = (boq.conditions ?? null) as Record<string, unknown> | null;

  const contenu: ContenuDocument = contenuDocumentSchema.parse({
    client: {
      nom: client?.nom ?? 'Client',
      adresse: client?.adresse ?? null,
      email: client?.email_principal ?? null,
    },
    reference: offre.numero,
    objet: offre.titre,
    lignes,
    totaux: { devise, tvaPct, ...totaux },
    conditions: conditions
      ? {
          livraison: conditions.livraison ? String(conditions.livraison) : null,
          paiement: conditions.paiement ? String(conditions.paiement) : null,
          garantie: conditions.garantie ? String(conditions.garantie) : null,
        }
      : null,
  });

  const numero = await prochainNumero(tenant, type);

  const { data: document, error } = await db
    .from('documents_financiers')
    .insert({
      tenant_id: tenant,
      demande_id: offre.demande_id,
      offre_id: offre.id,
      client_id: demande?.client_id ?? null,
      type,
      numero,
      contenu_json: contenu,
      devise,
      total_ht: totaux.totalHt,
      total_tva: totaux.totalTva,
      total_ttc: totaux.totalTtc,
      statut: 'emis',
      emis_par: utilisateurId,
      date_echeance: params.dateEcheance || null,
      notes: params.notes || null,
    })
    .select('id, numero')
    .single();

  if (error || !document) {
    console.error('[documents] émission impossible', error?.message);
    return { ok: false, message: 'Émission impossible. Réessayez.' };
  }

  await db.from('audit_events').insert({
    tenant_id: tenant,
    user_id: utilisateurId,
    entite: 'documents_financiers',
    entite_id: document.id,
    action: 'document.emis',
    details: { type, numero, offre: offre.numero, total_ttc: totaux.totalTtc },
  });

  return { ok: true, id: document.id, numero: document.numero };
}
