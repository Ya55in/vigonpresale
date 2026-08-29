import type { TablesInsert } from '@vigon/database';
import { extraireLot, type FichierBrut } from '@vigon/extraction';
import { classificationSchema, devisSchema } from '@vigon/shared';
import {
  clientAdmin,
  estRebond,
  genererJson,
  indexerDevis,
  marquerSuivi,
  promptClassification,
  promptExtractionDevis,
  tenantId,
  type ClientAdmin,
  type MessageEntrant,
} from '@vigon/services';

/**
 * Traitement d'une réponse fournisseur (flux étape 7 de la spec).
 *
 * L'appariement au fil d'origine repose sur `In-Reply-To` et `References`,
 * en-têtes standards que tout serveur respecte — et non sur le `threadId`
 * Gmail, qui n'existe pas quand l'envoi passe par SMTP.
 */

/** Consultations encore susceptibles de recevoir une réponse. */
const STATUTS_OUVERTS = [
  'envoyee',
  'relancee',
  'precision_demandee',
] as const;

const estOuverte = (statut: string | null): boolean =>
  (STATUTS_OUVERTS as readonly string[]).includes(statut ?? '');

export type ResultatReponse =
  | { traite: false; motif: string }
  | { traite: true; nature: string; consultationId: number };

/**
 * Retrouve la consultation dont ce message est la réponse.
 *
 * On teste toute la chaîne `References` et pas seulement `In-Reply-To` : quand
 * le fournisseur répond à une relance, le parent direct est la relance, mais la
 * chaîne remonte au message d'origine.
 */
async function consultationDuFil(
  db: ClientAdmin,
  tenant: string,
  message: MessageEntrant,
): Promise<{ id: number; demande_id: number | null; statut: string | null; marque: string | null; fournisseur_nom: string | null } | null> {
  const candidats = [message.inReplyTo, ...message.references].filter(
    (v): v is string => Boolean(v),
  );

  if (candidats.length === 0) return null;

  // Les communications sortantes portent le Message-ID de chaque envoi, y
  // compris les relances : c'est la table qui relie n'importe quel maillon du
  // fil à sa consultation.
  const { data: communication } = await db
    .from('communications')
    .select('consultation_id')
    .eq('tenant_id', tenant)
    .in('message_id', candidats)
    .not('consultation_id', 'is', null)
    .limit(1)
    .maybeSingle();

  const consultationId = communication?.consultation_id;

  if (!consultationId) {
    // Repli : le message_id porté par la consultation elle-même.
    const { data: parConsultation } = await db
      .from('consultations')
      .select('id, demande_id, statut, marque, fournisseur_nom')
      .eq('tenant_id', tenant)
      .in('message_id', candidats)
      .limit(1)
      .maybeSingle();

    return parConsultation ?? null;
  }

  const { data } = await db
    .from('consultations')
    .select('id, demande_id, statut, marque, fournisseur_nom')
    .eq('id', consultationId)
    .eq('tenant_id', tenant)
    .maybeSingle();

  return data ?? null;
}

async function notifierPresale(
  db: ClientAdmin,
  tenant: string,
  params: {
    demandeId: number | null;
    type: string;
    severite: 'info' | 'avertissement';
    titre: string;
    message: string;
  },
): Promise<void> {
  const { error } = await db.from('notifications').insert({
    tenant_id: tenant,
    role_cible: 'presale',
    type: params.type,
    severite: params.severite,
    titre: params.titre,
    message: params.message,
    lien: params.demandeId ? `/demandes/${params.demandeId}/devis` : null,
    demande_id: params.demandeId,
  });
  if (error) console.error(`[devis] notification impossible : ${error.message}`);
}

/**
 * Traite un avis de non-remise : trace, coupe les relances, alerte PRESALE.
 *
 * Le statut de la consultation n'est **pas** touché et `date_reponse` reste
 * vide : le fournisseur n'a rien répondu, il n'a même rien reçu. En revanche
 * `prochaine_relance` est effacée — relancer une adresse qui rebondit ne fait
 * que répéter l'échec.
 *
 * L'enum `statut_consultation` n'a pas d'état « adresse invalide » et le schéma
 * distant ne se modifie pas depuis ici : c'est la notification qui porte
 * l'information, à charge d'un humain de corriger l'adresse.
 */
async function traiterRebond(
  db: ClientAdmin,
  tenant: string,
  consultation: {
    id: number;
    demande_id: number | null;
    marque: string | null;
    fournisseur_nom: string | null;
  },
  message: MessageEntrant,
): Promise<ResultatReponse> {
  await db.from('communications').insert({
    tenant_id: tenant,
    demande_id: consultation.demande_id,
    consultation_id: consultation.id,
    direction: 'entrant',
    type: 'rebond',
    message_id: message.messageId,
    in_reply_to: message.inReplyTo,
    expediteur: message.expediteur,
    sujet: message.sujet,
    corps_texte: message.corpsTexte,
    corps_html: message.corpsHtml,
    date_envoi: message.date.toISOString(),
  });

  const { error } = await db
    .from('consultations')
    .update({ prochaine_relance: null })
    .eq('id', consultation.id);

  if (error) {
    console.error(`[devis] arrêt des relances impossible sur #${consultation.id} : ${error.message}`);
  }

  const destinataire = consultation.fournisseur_nom ?? consultation.marque ?? 'fournisseur';

  await notifierPresale(db, tenant, {
    demandeId: consultation.demande_id,
    type: 'rebond',
    severite: 'avertissement',
    titre: `Adresse invalide — ${consultation.marque ?? destinataire}`,
    message:
      `La demande de devis envoyée à ${destinataire} n'a pas pu être remise ` +
      `(avis de non-remise reçu). Les relances sont suspendues : corrigez ` +
      `l'adresse du fournisseur, puis relancez l'envoi.`,
  });

  console.warn(
    `[devis] avis de non-remise sur la consultation #${consultation.id} — relances suspendues.`,
  );

  return { traite: true, nature: 'REBOND', consultationId: consultation.id };
}

/** Enregistre les lignes du devis et les rattache aux articles de la demande. */
async function enregistrerDevis(
  db: ClientAdmin,
  tenant: string,
  params: {
    consultationId: number;
    demandeId: number | null;
    contenu: string;
    marque: string | null;
  },
): Promise<{ devisId: number; lignes: number; ignorees: string[] }> {
  if (!params.demandeId) {
    throw new Error('Consultation sans demande rattachée : devis non enregistrable.');
  }

  const devis = await genererJson(
    await promptExtractionDevis(tenant, params.contenu),
    devisSchema,
    { tentatives: 3, contexte: { consultationId: params.consultationId } },
  );

  // Idempotence : une même réponse rejouée ne doit pas créer deux devis.
  const { data: deja } = await db
    .from('devis_fournisseur')
    .select('id')
    .eq('consultation_id', params.consultationId)
    .eq('tenant_id', tenant)
    .maybeSingle();

  if (deja) {
    return { devisId: deja.id, lignes: 0, ignorees: [] };
  }

  const { data: cree, error } = await db
    .from('devis_fournisseur')
    .insert({
      tenant_id: tenant,
      consultation_id: params.consultationId,
      demande_id: params.demandeId,
      numero_devis: devis.numero_devis,
      date_devis: devis.date_devis,
      devise: devis.devise,
      validite_offre: devis.validite,
      delai_livraison: devis.delai_livraison,
      conditions_paiement: devis.conditions_paiement,
      garantie: devis.garantie,
      source: 'email',
      contenu_brut: params.contenu.slice(0, 100_000),
      statut_extraction: 'ok',
      confiance_globale:
        devis.lignes.length > 0
          ? devis.lignes.reduce((s, l) => s + l.confiance, 0) / devis.lignes.length
          : 0,
    })
    .select('id')
    .single();

  if (error || !cree) throw new Error(`Enregistrement du devis : ${error?.message}`);

  // Articles de la demande, pour rattacher chaque ligne du devis. Sans demande
  // rattachée, les lignes restent « additionnel ».
  const { data: articles } = params.demandeId
    ? await db
        .from('demande_items')
        .select('id, reference, designation')
        .eq('demande_id', params.demandeId)
    : { data: [] as { id: number; reference: string | null; designation: string }[] };

  const normaliser = (v: string | null): string =>
    (v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

  const parReference = new Map(
    (articles ?? [])
      .filter((a) => a.reference)
      .map((a) => [normaliser(a.reference), a.id]),
  );

  /*
   * `prix_achat_ht` est NOT NULL en base, or la spec interdit d'inventer un
   * prix absent. Stocker 0 serait le pire choix : dans le comparatif, 0
   * l'emporterait comme « meilleur prix » et fausserait la sélection. Les
   * lignes sans prix sont donc écartées et signalées à PRESALE, qui les
   * complétera à la main.
   */
  const ignorees: string[] = [];

  const lignes: TablesInsert<'lignes_devis'>[] = devis.lignes.flatMap((ligne) => {
    const refNormalisee = normaliser(ligne.reference);
    let articleId = parReference.get(refNormalisee) ?? null;
    let mapping: 'exact' | 'alternative' | 'additionnel' = articleId
      ? 'exact'
      : 'additionnel';

    // Sans correspondance de référence, on tente la désignation : le fournisseur
    // propose parfois un équivalent sous une autre référence.
    if (!articleId) {
      const designation = normaliser(ligne.designation);
      const proche = (articles ?? []).find((a) => {
        const cible = normaliser(a.designation);
        return cible.length > 8 && (cible.includes(designation) || designation.includes(cible));
      });
      if (proche) {
        articleId = proche.id;
        mapping = 'alternative';
      }
    }

    if (ligne.prix_achat_ht === null) {
      ignorees.push(ligne.designation);
      return [];
    }

    return [{
      devis_id: cree.id,
      demande_item_id: articleId,
      designation_fournisseur: ligne.designation,
      reference: ligne.reference,
      fabricant: params.marque,
      quantite: ligne.quantite,
      prix_achat_ht: ligne.prix_achat_ht,
      remise_pct: ligne.remise_pct ?? 0,
      tva_pct: ligne.tva_pct ?? 20,
      disponibilite: ligne.disponibilite,
      mapping_type: mapping,
      confiance_ia: ligne.confiance,
    }];
  });

  if (lignes.length > 0) {
    const { error: erreurLignes } = await db.from('lignes_devis').insert(lignes);
    if (erreurLignes) throw new Error(`Lignes du devis : ${erreurLignes.message}`);
  }

  return { devisId: cree.id, lignes: lignes.length, ignorees };
}

/**
 * Statuts pendant lesquels l'arrivée d'un devis fait encore avancer la demande.
 *
 * Au-delà, le dossier a dépassé la collecte : une réponse tardive ne doit pas
 * le ramener en arrière — un fournisseur qui répond après la signature
 * rouvrirait un deal gagné.
 */
const STATUTS_EN_COLLECTE = [
  'envoyee_fournisseurs',
  'devis_partiels',
  'devis_recus',
  'planifiee',
  'en_validation_rfq',
  'fournisseurs_identifies',
] as const;

/** Fait passer la demande à « devis_recus » quand toutes les consultations ont répondu. */
async function majStatutDemande(
  db: ClientAdmin,
  tenant: string,
  demandeId: number,
): Promise<void> {
  const { data: demande } = await db
    .from('demandes')
    .select('statut')
    .eq('id', demandeId)
    .eq('tenant_id', tenant)
    .maybeSingle();

  if (!demande || !(STATUTS_EN_COLLECTE as readonly string[]).includes(demande.statut)) {
    return;
  }

  const { count: restantes } = await db
    .from('consultations')
    .select('id', { count: 'exact', head: true })
    .eq('demande_id', demandeId)
    .eq('tenant_id', tenant)
    .in('statut', ['envoyee', 'relancee', 'precision_demandee', 'planifiee']);

  const { count: recus } = await db
    .from('consultations')
    .select('id', { count: 'exact', head: true })
    .eq('demande_id', demandeId)
    .eq('tenant_id', tenant)
    .eq('statut', 'devis_recu');

  if ((recus ?? 0) === 0) return;

  await db
    .from('demandes')
    .update({
      statut: (restantes ?? 0) === 0 ? 'devis_recus' : 'devis_partiels',
      date_premier_devis: new Date().toISOString(),
    })
    .eq('id', demandeId)
    .eq('tenant_id', tenant);
}

/**
 * Traite une réponse fournisseur : classification puis extraction.
 *
 * Renvoie `traite: false` quand le message n'appartient à aucun fil connu — le
 * message est alors laissé au flux de réception client.
 */
export async function traiterReponseFournisseur(
  message: MessageEntrant,
): Promise<ResultatReponse> {
  const db = clientAdmin();
  const tenant = await tenantId();

  const consultation = await consultationDuFil(db, tenant, message);
  if (!consultation) return { traite: false, motif: 'aucun fil correspondant' };

  if (!estOuverte(consultation.statut)) {
    return {
      traite: false,
      motif: `consultation #${consultation.id} déjà close (${consultation.statut})`,
    };
  }

  // --- Avis de non-remise : personne n'a reçu la consultation ---
  //
  // Contrôlé avant la classification : soumis au modèle, un rebond cite notre
  // propre demande de devis et se fait passer pour une réponse du fournisseur.
  // La consultation paraîtrait alors traitée alors que l'adresse est morte.
  if (estRebond(message)) {
    return traiterRebond(db, tenant, consultation, message);
  }

  // --- Contenu : corps + pièces jointes + archives ---
  const fichiers: FichierBrut[] = message.piecesJointes.map((pj) => ({
    nom: pj.nom,
    contenu: pj.contenu,
  }));

  const { texte: textePj, resultats } = await extraireLot(fichiers);
  const illisibles = resultats.filter((r) => r.erreur !== null).map((r) => r.nom);

  const contenu = [
    `--- Sujet ---\n${message.sujet}`,
    message.corpsTexte.trim() ? `--- Corps ---\n${message.corpsTexte.trim()}` : '',
    textePj.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');

  // --- Classification ---
  let nature: string;
  try {
    const classification = await genererJson(
      await promptClassification(tenant, contenu.slice(0, 40_000)),
      classificationSchema,
      { tentatives: 2, contexte: { consultationId: consultation.id } },
    );
    nature = classification.nature;
  } catch (e) {
    console.error(
      `[devis] classification impossible pour #${consultation.id} : ${e instanceof Error ? e.message : e}`,
    );
    return { traite: false, motif: 'classification en échec' };
  }

  // Une pièce jointe illisible interdit toute conclusion sur le message.
  //
  // Le garde ne visait que AUTOMATIQUE, mais le modèle lit « voici notre devis
  // ci-joint » et répond DEVIS_RECU sans voir que la pièce est illisible :
  // la consultation passait alors « devis reçu » avec zéro ligne, les relances
  // s'arrêtaient, et le comparatif restait muet sur ce fournisseur. Un dossier
  // qui paraît complet sans l'être est pire qu'un dossier visiblement en
  // attente — quelle que soit la nature annoncée, c'est une demande de
  // précision.
  if (illisibles.length > 0 && nature !== 'DEMANDE_PRECISION') {
    console.warn(
      `[devis] #${consultation.id} : « ${nature} » requalifié en DEMANDE_PRECISION — ` +
        `pièce(s) illisible(s) : ${illisibles.join(', ')}.`,
    );
    nature = 'DEMANDE_PRECISION';
  }

  await db.from('communications').insert({
    tenant_id: tenant,
    demande_id: consultation.demande_id,
    consultation_id: consultation.id,
    direction: 'entrant',
    type: nature.toLowerCase(),
    message_id: message.messageId,
    in_reply_to: message.inReplyTo,
    expediteur: message.expediteur,
    sujet: message.sujet,
    corps_texte: message.corpsTexte,
    corps_html: message.corpsHtml,
    date_envoi: message.date.toISOString(),
  });

  // --- AUTOMATIQUE : absence, boîte pleine, newsletter ---
  if (nature === 'AUTOMATIQUE') {
    console.info(`[devis] message automatique ignoré (consultation #${consultation.id}).`);
    return { traite: true, nature, consultationId: consultation.id };
  }

  // --- DEMANDE_PRECISION : le fil reste ouvert, les relances continuent ---
  if (nature === 'DEMANDE_PRECISION') {
    await db
      .from('consultations')
      .update({ statut: 'precision_demandee', date_reponse: new Date().toISOString() })
      .eq('id', consultation.id);

    await notifierPresale(db, tenant, {
      demandeId: consultation.demande_id,
      type: 'precision_demandee',
      severite: 'avertissement',
      titre: `Précision demandée — ${consultation.marque ?? ''}`,
      message:
        (illisibles.length > 0
          ? `Pièce(s) jointe(s) illisible(s) : ${illisibles.join(', ')}. `
          : '') + message.corpsTexte.trim().slice(0, 400),
    });

    console.info(`[devis] précision demandée sur la consultation #${consultation.id}.`);
    return { traite: true, nature, consultationId: consultation.id };
  }

  // --- DEVIS_RECU ---
  try {
    const resultat = await enregistrerDevis(db, tenant, {
      consultationId: consultation.id,
      demandeId: consultation.demande_id,
      contenu,
      marque: consultation.marque,
    });

    // Un devis sans aucune ligne exploitable n'est pas un devis reçu.
    //
    // Le classer ainsi arrêterait les relances et sortirait le fournisseur du
    // comparatif, sur la foi d'un message dont rien n'a pu être tiré. On garde
    // le fil ouvert et on demande la précision.
    if (resultat.lignes === 0) {
      await db
        .from('consultations')
        .update({ statut: 'precision_demandee', date_reponse: new Date().toISOString() })
        .eq('id', consultation.id);

      await notifierPresale(db, tenant, {
        demandeId: consultation.demande_id,
        type: 'precision_demandee',
        severite: 'avertissement',
        titre: `Devis inexploitable — ${consultation.marque ?? ''}`,
        message:
          `Le message de ${consultation.fournisseur_nom ?? 'ce fournisseur'} annonce un devis, ` +
          `mais aucune ligne chiffrée n'a pu en être extraite. Fil laissé ouvert : ` +
          `demandez le détail des prix, ou saisissez-les à la main.`,
      });

      console.warn(
        `[devis] #${consultation.id} : devis annoncé mais aucune ligne exploitable — précision demandée.`,
      );
      return { traite: true, nature: 'DEMANDE_PRECISION', consultationId: consultation.id };
    }

    await db
      .from('consultations')
      .update({
        statut: 'devis_recu',
        date_reponse: new Date().toISOString(),
        // Le devis reçu sort la consultation du périmètre de relance.
        prochaine_relance: null,
      })
      .eq('id', consultation.id);

    // Le label n'existe qu'avec l'API Gmail ; son absence est sans effet ici.
    if (message.messageId) {
      await marquerSuivi('fournisseur', message.messageId, 'retirer').catch(() => false);
    }

    if (consultation.demande_id) {
      await majStatutDemande(db, tenant, consultation.demande_id);
    }

    await notifierPresale(db, tenant, {
      demandeId: consultation.demande_id,
      type: 'devis_recu',
      severite: resultat.ignorees.length > 0 ? 'avertissement' : 'info',
      titre: `Devis reçu — ${consultation.marque ?? ''}`,
      message:
        `${resultat.lignes} ligne(s) extraite(s) de ${consultation.fournisseur_nom ?? 'ce fournisseur'}.` +
        (resultat.ignorees.length > 0
          ? ` ${resultat.ignorees.length} ligne(s) sans prix écartée(s), à saisir manuellement : ${resultat.ignorees.join(', ')}.`
          : ''),
    });

    await db.from('audit_events').insert({
      tenant_id: tenant,
      entite: 'devis_fournisseur',
      entite_id: resultat.devisId,
      action: 'devis.recu',
      acteur_type: 'worker',
      details: {
        consultation_id: consultation.id,
        marque: consultation.marque,
        lignes: resultat.lignes,
        lignes_sans_prix_ecartees: resultat.ignorees,
        pieces_illisibles: illisibles,
      },
    });

    // Vectorisation en marge : ce que ce fournisseur vient de chiffrer enrichit
    // la recherche sémantique des prochaines demandes. L'échec est avalé — le
    // devis est enregistré, c'est ce qui compte, et le rattrapage est rejouable.
    try {
      const bilan = await indexerDevis(tenant, [resultat.devisId]);
      if (bilan.indexees > 0) {
        console.info(`[devis] ${bilan.indexees} ligne(s) vectorisée(s).`);
      }
    } catch (e) {
      console.error(
        `[devis] indexation ignorée : ${e instanceof Error ? e.message : e}`,
      );
    }

    console.info(
      `[devis] devis reçu de ${consultation.fournisseur_nom} — ${resultat.lignes} ligne(s).`,
    );
    return { traite: true, nature, consultationId: consultation.id };
  } catch (e) {
    const motif = e instanceof Error ? e.message : String(e);

    // L'extraction a échoué mais le fournisseur a bien répondu : on bascule en
    // demande de précision plutôt que de perdre la réponse.
    await db
      .from('consultations')
      .update({ statut: 'precision_demandee', date_reponse: new Date().toISOString() })
      .eq('id', consultation.id);

    await notifierPresale(db, tenant, {
      demandeId: consultation.demande_id,
      type: 'devis_extraction_echouee',
      severite: 'avertissement',
      titre: `Devis illisible — ${consultation.marque ?? ''}`,
      message: `Réponse reçue mais extraction impossible : ${motif}. À saisir manuellement.`,
    });

    console.error(`[devis] extraction échouée pour #${consultation.id} : ${motif}`);
    return { traite: true, nature: 'EXTRACTION_ECHOUEE', consultationId: consultation.id };
  }
}
