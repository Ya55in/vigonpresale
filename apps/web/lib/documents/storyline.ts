import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Historique d'une affaire, de la réception à la facture.
 *
 * Aucune table nouvelle : tout est déjà écrit. `audit_events` porte les actes,
 * `communications` les échanges, et les tables métier leurs dates clés. Créer
 * une table d'historique reviendrait à dupliquer ces faits, avec la certitude
 * qu'elle divergerait — un événement écrit d'un côté et pas de l'autre.
 *
 * La reconstruction se fait donc à la lecture, ce qui coûte quelques requêtes
 * sur un écran consulté ponctuellement. C'est le bon compromis.
 *
 * DEUX NATURES D'ÉVÉNEMENT, ET POURQUOI ELLES SE RECOUVRENT
 *
 * Une colonne de date dit un ÉTAT : « l'offre est partie le 12 ». Une ligne
 * d'`audit_events` dit un ACTE : « Sophie a envoyé l'offre le 12 ». Le second
 * est strictement plus riche, mais les deux décrivent le même fait et
 * s'afficheraient en double.
 *
 * D'où la clé de dédoublonnage : chaque fait porte un identifiant stable
 * `entité:id:suffixe`, et l'acte tracé chasse l'état déduit. Une action absente
 * de `SUFFIXE_ACTE` n'est pas perdue — elle apparaît sur sa propre ligne. Le
 * mode de défaillance de ce tableau est donc une ligne en double, jamais un
 * événement manquant : c'est ce qui le rend tenable.
 */

export type CategorieEvenement =
  | 'demande'
  | 'consultation'
  | 'devis'
  | 'offre'
  | 'document'
  | 'support'
  | 'echange';

export type EvenementAffaire = {
  date: string;
  /** Famille, pour la pastille de couleur et le filtrage. */
  categorie: CategorieEvenement;
  titre: string;
  detail: string | null;
  /** Lien vers l'écran concerné, quand il en existe un. */
  lien: string | null;
  /** Qui a agi. Null pour un état déduit d'une date, que personne ne « fait ». */
  acteur: string | null;
  /**
   * Poids à l'écran.
   *
   * Une affaire produit beaucoup d'actes de préparation — planifier, préparer,
   * régénérer une offre onze fois — et une poignée de faits qui décident :
   * le devis est arrivé, l'offre est partie, le client a répondu.
   *
   * Tout afficher du même poids revient à ne rien hiérarchiser : l'œil ne sait
   * plus où se poser, et le fait décisif se noie dans la manœuvre.
   */
  importance: 'majeur' | 'courant';
};

/** Événement interne : la clé ne sort pas, elle ne sert qu'au dédoublonnage. */
type EvenementInterne = EvenementAffaire & { cle: string | null };

const ORIGINES: Record<string, string> = {
  email: 'Reçue par courriel',
  cps: 'Cahier des charges déposé',
  interne: 'Projet ouvert en interne',
};

const LIBELLES_DOCUMENT: Record<string, string> = {
  bon_commande: 'Bon de commande',
  proforma: 'Facture pro-forma',
  facture: 'Facture',
};

/**
 * Acteurs qui ne sont pas des utilisateurs.
 *
 * Une décision prise depuis un lien public n'a personne d'authentifié derrière,
 * et l'écrire « — » laisserait croire à une information manquante alors que
 * c'est une information : personne n'était connecté.
 */
const ACTEURS: Record<string, string> = {
  worker: 'Traitement automatique',
  client: 'Le client',
  fournisseur: 'Le fournisseur',
  admin_lien: 'Administrateur (par lien)',
};

/** Famille d'affichage de chaque entité auditée. */
const CATEGORIE_ENTITE: Record<string, CategorieEvenement> = {
  demandes: 'demande',
  consultations: 'consultation',
  devis_fournisseur: 'devis',
  cost_sheets: 'devis',
  offres: 'offre',
  documents_financiers: 'document',
  tickets_sav: 'support',
};

/**
 * Actes tracés qui décrivent le même fait qu'une colonne de date.
 *
 * Le suffixe rejoint la clé construite du côté de l'état déduit ; l'acte, qui
 * porte l'auteur, l'emporte.
 */
const SUFFIXE_ACTE: Record<string, string> = {
  'demande.recue': 'recue',
  'consultation.envoyee': 'envoyee',
  'consultation.relancee': 'relancee',
  'consultation.reponse_envoyee': 'reponse_envoyee',
  'devis.recu': 'recu',
  'devis.saisi_formulaire': 'recu',
  'offre.envoyee': 'envoyee',
  'offre.consultee': 'consultee',
  'offre.approuvee': 'approuvee',
  'offre.refusee': 'refusee',
  'document.emis': 'emis',
  'sav.ticket_ouvert': 'ouvert',
};

/**
 * Courriels sortants qui sont l'exécution d'un acte déjà tracé.
 *
 * L'envoi d'une demande de devis produit DEUX écritures à 140 ms d'écart :
 * la ligne `communications` (qui porte le sujet et le destinataire) et la ligne
 * `audit_events` (qui porte l'auteur). Deux lignes à l'écran pour un seul
 * envoi, et aucune des deux complète.
 *
 * Leur donner la même clé les fait fusionner en une ligne qui porte les deux.
 */
const SUFFIXE_COURRIEL: Record<string, { entite: 'consultations' | 'offres'; suffixe: string }> = {
  demande_devis: { entite: 'consultations', suffixe: 'envoyee' },
  relance: { entite: 'consultations', suffixe: 'relancee' },
  reponse_precision: { entite: 'consultations', suffixe: 'reponse_envoyee' },
  offre_client: { entite: 'offres', suffixe: 'envoyee' },
  offre_consultee: { entite: 'offres', suffixe: 'consultee' },
};

/**
 * Intitulés lisibles des actes. Une action absente s'affiche telle quelle.
 *
 * La liste est relevée sur `audit_events` en base, pas sur le code : les actes
 * passent par un helper `auditer(utilisateur, action, …)` qui prend l'action en
 * argument positionnel, et un `grep` sur `action: '…'` en manquait un tiers —
 * dont les onze `offre.generee`, qui s'affichaient bruts à l'écran.
 */
const LIBELLES_ACTION: Record<string, string> = {
  'demande.recue': 'Demande reçue',
  'demande.creee_manuellement': 'Demande créée à la main',
  'demande.specs_extraites': 'Spécifications extraites du message',
  'articles.valides': 'Articles validés',
  'article.modifie': 'Article corrigé',
  'article.supprime': 'Article retiré',
  'consultations.preparees': 'Consultations préparées',
  'consultations.planifiees': 'Envoi des consultations planifié',
  'consultations.planification_annulee': 'Planification annulée',
  'consultation.modifiee': 'Consultation modifiée',
  'consultation.envoyee': 'Demande de devis envoyée',
  'consultation.relancee': 'Fournisseur relancé',
  'consultation.reponse_envoyee': 'Réponse envoyée au fournisseur',
  'consultation.sans_reponse': 'Consultation close sans réponse',
  'devis.recu': 'Devis reçu',
  'devis.saisi_formulaire': 'Devis saisi en ligne par le fournisseur',
  'costing.construit': 'Costing construit',
  'costing.construit_par_fournisseur': 'Costing construit par fournisseur',
  'costing.soumis_finance': 'Costing soumis à la finance',
  'costing.verrouille': 'Costing verrouillé',
  'costing.renvoye': 'Costing renvoyé pour reprise',
  'marge.definie': 'Marge ajustée',
  'validation.demandee': 'Accord demandé à l’administrateur',
  'validation.approuvee': 'Génération de l’offre approuvée',
  'validation.refusee': 'Génération de l’offre refusée',
  'offre.generee': 'Offre générée',
  'offre.validee': 'Offre validée en interne',
  'offre.visuel_remplace': 'Visuel produit remplacé',
  'offre.envoyee': 'Offre envoyée au client',
  'offre.envoi_echoue': 'Échec de l’envoi de l’offre',
  'offre.consultee': 'Offre consultée par le client',
  'offre.approuvee': 'Offre approuvée par le client',
  'offre.refusee': 'Offre refusée par le client',
  'offre.modification_demandee': 'Modification demandée par le client',
  'offre.expiree': 'Offre expirée',
  'offre.synthese_modifiee': 'Synthèse de l’offre retouchée',
  'document.emis': 'Document émis',
  'document.regle': 'Règlement constaté',
  'document.annule': 'Document annulé',
  'sav.ticket_ouvert': 'Ticket de support ouvert',
};

/**
 * Actes qui font avancer l'affaire, par opposition à ceux qui la préparent.
 *
 * Le critère n'est pas la rareté mais la conséquence : un envoi raté ou une
 * consultation close sans réponse sont majeurs parce qu'ils **expliquent** un
 * silence — et c'est la question qu'on vient poser à cet écran.
 */
const ACTIONS_MAJEURES = new Set([
  'demande.recue',
  'demande.creee_manuellement',
  'consultation.envoyee',
  'consultation.sans_reponse',
  'devis.recu',
  'devis.saisi_formulaire',
  'costing.verrouille',
  'costing.soumis_finance',
  'costing.renvoye',
  'validation.approuvee',
  'validation.refusee',
  'offre.envoyee',
  'offre.envoi_echoue',
  'offre.consultee',
  'offre.approuvee',
  'offre.refusee',
  'offre.modification_demandee',
  'offre.expiree',
  'document.emis',
  'document.regle',
  'document.annule',
  'sav.ticket_ouvert',
]);

/** Échanges qui font avancer l'affaire. Le reste est de la manœuvre. */
const COURRIELS_MAJEURS = new Set([
  'demande_client',
  'devis_recu',
  'offre_client',
  'offre_consultee',
  'demande_modification',
]);

/**
 * Intitulés des échanges.
 *
 * Le vocabulaire est celui réellement écrit en base, relevé sur les huit sites
 * d'insertion et confirmé sur les données : `nature.toLowerCase()` du tri des
 * réponses fournisseur produit `devis_recu`, `demande_precision` et
 * `automatique`, qu'aucune lecture du code seul n'aurait donnés.
 */
const LIBELLES_COMMUNICATION: Record<string, string> = {
  demande_client: 'Message du client',
  demande_devis: 'Demande de devis envoyée',
  relance: 'Relance du fournisseur',
  reponse_precision: 'Précision envoyée au fournisseur',
  devis_recu: 'Devis reçu du fournisseur',
  demande_precision: 'Le fournisseur demande une précision',
  rebond: 'Rebond du fournisseur',
  automatique: 'Réponse automatique',
  offre_client: 'Offre envoyée au client',
  offre_consultee: 'Offre ouverte par le client',
  demande_modification: 'Demande de modification du client',
};

/**
 * Événements d'une affaire, du plus récent au plus ancien.
 *
 * Les lectures sont parallèles et chacune tolère l'échec : un historique
 * partiel vaut mieux qu'un écran vide, et une table indisponible ne doit pas
 * masquer les autres.
 *
 * Deux vagues sont nécessaires : `audit_events` ne porte pas de `demande_id`,
 * seulement le couple (entité, identifiant). Il faut donc connaître les enfants
 * de l'affaire avant de pouvoir demander ses actes.
 */
export async function lireStoryline(
  tenant: string,
  demandeId: number,
): Promise<EvenementAffaire[]> {
  const db = createAdminClient();

  const [demande, consultations, devis, offres, documents, tickets, feuilles, echanges] =
    await Promise.all([
      db
        .from('demandes')
        .select('code, titre, source, date_reception, date_envoi_rfq, date_decision, statut')
        .eq('id', demandeId)
        .eq('tenant_id', tenant)
        .maybeSingle(),
      db
        .from('consultations')
        .select('id, fournisseur_nom, marque, date_envoi_reelle, date_reponse, relances')
        .eq('demande_id', demandeId)
        .eq('tenant_id', tenant),
      db
        .from('devis_fournisseur')
        .select('id, numero_devis, source, created_at, consultation_id')
        .eq('demande_id', demandeId)
        .eq('tenant_id', tenant),
      db
        .from('offres')
        .select('id, numero, statut, date_envoi, date_consultation, date_approbation, date_refus')
        .eq('demande_id', demandeId)
        .eq('tenant_id', tenant),
      db
        .from('documents_financiers')
        .select('id, type, numero, total_ttc, devise, date_emission, date_reglement')
        .eq('demande_id', demandeId)
        .eq('tenant_id', tenant),
      db
        .from('tickets_sav')
        .select('id, numero, objet, statut, date_ouverture, date_traitement')
        .eq('demande_id', demandeId)
        .eq('tenant_id', tenant),
      // Les feuilles de costing ne produisent aucune date visible, mais elles
      // portent les actes les plus décisifs : marge, verrouillage, accord.
      db.from('cost_sheets').select('id').eq('demande_id', demandeId).eq('tenant_id', tenant),
      // Les huit sites d'écriture de `communications` renseignent tous
      // `demande_id` : ce seul filtre suffit, vérifié site par site.
      db
        .from('communications')
        .select(
          'id, consultation_id, offre_id, direction, type, canal, sujet, expediteur, destinataires, date_envoi, statut_envoi, erreur',
        )
        .eq('demande_id', demandeId)
        .eq('tenant_id', tenant),
    ]);

  const evenements: EvenementInterne[] = [];

  /**
   * Sept champs, dont cinq facultatifs : les nommer évite les suites de `null`
   * positionnels qu'on relit en comptant les virgules.
   */
  const ajouter = (e: {
    date: string | null;
    categorie: CategorieEvenement;
    titre: string;
    importance?: 'majeur' | 'courant';
    detail?: string | null;
    lien?: string | null;
    acteur?: string | null;
    cle?: string | null;
  }): void => {
    // Une date absente signifie que l'étape n'a pas eu lieu : elle n'a rien à
    // faire dans la chronologie.
    if (!e.date) return;

    evenements.push({
      date: e.date,
      categorie: e.categorie,
      titre: e.titre,
      importance: e.importance ?? 'courant',
      detail: e.detail ?? null,
      lien: e.lien ?? null,
      acteur: e.acteur ?? null,
      cle: e.cle ?? null,
    });
  };

  if (demande.data) {
    const d = demande.data;
    ajouter({
      date: d.date_reception,
      categorie: 'demande',
      titre: ORIGINES[d.source] ?? 'Demande créée',
      importance: 'majeur',
      detail: d.titre,
      lien: `/demandes/${demandeId}`,
      cle: `demandes:${demandeId}:recue`,
    });
    ajouter({
      date: d.date_envoi_rfq,
      categorie: 'consultation',
      titre: 'Consultations envoyées aux fournisseurs',
      lien: `/demandes/${demandeId}/consultations`,
    });
  }

  for (const c of consultations.data ?? []) {
    ajouter({
      date: c.date_envoi_reelle,
      categorie: 'consultation',
      titre: `Demande de devis — ${c.fournisseur_nom ?? 'fournisseur'}`,
      importance: 'majeur',
      detail: c.marque,
      lien: `/demandes/${demandeId}/consultations`,
      cle: `consultations:${c.id}:envoyee`,
    });
    // Un même fournisseur est consulté une fois par marque : sans elle, deux
    // réponses arrivées la même minute donnent deux lignes indiscernables.
    ajouter({
      date: c.date_reponse,
      categorie: 'devis',
      titre: `Réponse — ${c.fournisseur_nom ?? 'fournisseur'}`,
      importance: 'majeur',
      detail:
        [c.marque, c.relances > 0 ? `après ${c.relances} relance(s)` : null]
          .filter(Boolean)
          .join(' · ') || null,
      lien: `/demandes/${demandeId}/consultations`,
    });
  }

  for (const dv of devis.data ?? []) {
    ajouter({
      date: dv.created_at,
      categorie: 'devis',
      titre: `Devis enregistré ${dv.numero_devis ?? ''}`.trim(),
      importance: 'majeur',
      detail:
        dv.source === 'formulaire' ? 'saisi en ligne, sans extraction' : 'extrait du courriel',
      lien: `/demandes/${demandeId}/costing`,
      cle: `devis_fournisseur:${dv.id}:recu`,
    });
  }

  for (const o of offres.data ?? []) {
    const lien = `/offres/${o.id}/preview`;
    const socle = { categorie: 'offre', importance: 'majeur', lien } as const;

    ajouter({ ...socle, date: o.date_envoi, titre: `Offre ${o.numero} envoyée`, cle: `offres:${o.id}:envoyee` });
    ajouter({
      ...socle,
      date: o.date_consultation,
      titre: `Offre ${o.numero} consultée par le client`,
      cle: `offres:${o.id}:consultee`,
    });
    ajouter({ ...socle, date: o.date_approbation, titre: `Offre ${o.numero} approuvée`, cle: `offres:${o.id}:approuvee` });
    ajouter({ ...socle, date: o.date_refus, titre: `Offre ${o.numero} refusée`, cle: `offres:${o.id}:refusee` });
  }

  for (const doc of documents.data ?? []) {
    const montant = `${Number(doc.total_ttc).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
    })} ${doc.devise} TTC`;

    ajouter({
      date: doc.date_emission,
      categorie: 'document',
      titre: `${LIBELLES_DOCUMENT[doc.type] ?? doc.type} ${doc.numero}`,
      importance: 'majeur',
      detail: montant,
      cle: `documents_financiers:${doc.id}:emis`,
    });
    ajouter({
      date: doc.date_reglement,
      categorie: 'document',
      titre: `${doc.numero} réglée`,
      importance: 'majeur',
      detail: montant,
    });
  }

  for (const t of tickets.data ?? []) {
    ajouter({
      date: t.date_ouverture,
      categorie: 'support',
      titre: `Support ${t.numero}`,
      importance: 'majeur',
      detail: t.objet,
      lien: '/apres-vente',
      cle: `tickets_sav:${t.id}:ouvert`,
    });
    ajouter({
      date: t.date_traitement,
      categorie: 'support',
      titre: `Support ${t.numero} traité`,
      lien: '/apres-vente',
    });
  }

  /* --- Les échanges ------------------------------------------------------- */

  for (const c of echanges.data ?? []) {
    const entrant = c.direction === 'entrant';
    const partie = entrant
      ? (c.expediteur ?? 'expéditeur inconnu')
      : (c.destinataires?.join(', ') ?? 'destinataire inconnu');

    // Un courriel sortant qui exécute un acte tracé partage sa clé, et les deux
    // lignes n'en font plus qu'une.
    const appariement = SUFFIXE_COURRIEL[c.type];
    const porteur = appariement?.entite === 'offres' ? c.offre_id : c.consultation_id;

    const nonRemise = estNonRemise(c.expediteur, c.sujet);

    ajouter({
      date: c.date_envoi,
      categorie: 'echange',
      titre: nonRemise
        ? 'Avis de non-remise'
        : (LIBELLES_COMMUNICATION[c.type] ?? (entrant ? 'Message reçu' : 'Message envoyé')),
      // Un avis de non-remise explique un silence : c'est un fait majeur de
      // l'affaire, pas un incident technique à ranger avec les manœuvres.
      importance: nonRemise || COURRIELS_MAJEURS.has(c.type) ? 'majeur' : 'courant',
      // Le sujet seul suffit : l'interlocuteur est déjà porté par `acteur` à
      // l'entrée, et répéter l'adresse sur chaque ligne remplissait l'écran de
      // la même chaîne de trente caractères.
      detail: nonRemise ? null : nettoyerSujet(c.sujet),
      acteur: entrant ? partie : null,
      cle: appariement && porteur ? `${appariement.entite}:${porteur}:${appariement.suffixe}` : null,
    });

    // Un envoi en échec est un fait de l'affaire, pas un incident technique à
    // taire : c'est souvent l'explication d'un fournisseur qui « n'a pas
    // répondu ».
    if (c.statut_envoi === 'echec') {
      ajouter({
        date: c.date_envoi,
        categorie: 'echange',
        titre: 'Échec d’envoi',
        importance: 'majeur',
        detail: c.erreur ?? nettoyerSujet(c.sujet),
        acteur: ACTEURS.worker ?? null,
      });
    }
  }

  /* --- Les actes tracés --------------------------------------------------- */

  // `audit_events` ne porte pas `demande_id` : on le vise par le couple
  // (entité, identifiant), reconstitué depuis les enfants lus ci-dessus.
  const cibles: [string, (number | string)[]][] = [
    ['demandes', [demandeId]],
    ['consultations', (consultations.data ?? []).map((c) => c.id)],
    ['devis_fournisseur', (devis.data ?? []).map((d) => d.id)],
    ['offres', (offres.data ?? []).map((o) => o.id)],
    ['documents_financiers', (documents.data ?? []).map((d) => d.id)],
    ['tickets_sav', (tickets.data ?? []).map((t) => t.id)],
    ['cost_sheets', (feuilles.data ?? []).map((f) => f.id)],
  ];

  const filtre = cibles
    .filter(([, ids]) => ids.length > 0)
    .map(([entite, ids]) => `and(entite.eq.${entite},entite_id.in.(${ids.join(',')}))`)
    .join(',');

  if (filtre) {
    const { data: actes } = await db
      .from('audit_events')
      .select('entite, entite_id, action, acteur_type, details, created_at, users(prenom, nom)')
      .eq('tenant_id', tenant)
      .or(filtre);

    for (const a of actes ?? []) {
      const auteur = Array.isArray(a.users) ? a.users[0] : a.users;

      const acteur =
        [auteur?.prenom, auteur?.nom].filter(Boolean).join(' ').trim() ||
        ACTEURS[a.acteur_type] ||
        null;

      const suffixe = SUFFIXE_ACTE[a.action];

      ajouter({
        date: a.created_at,
        categorie: CATEGORIE_ENTITE[a.entite] ?? 'demande',
        titre: LIBELLES_ACTION[a.action] ?? a.action,
        importance: ACTIONS_MAJEURES.has(a.action) ? 'majeur' : 'courant',
        detail: motifDe(a.details),
        lien: lienEntite(a.entite, a.entite_id, demandeId),
        acteur,
        cle: suffixe ? `${a.entite}:${a.entite_id}:${suffixe}` : null,
      });
    }
  }

  /* --- Dédoublonnage et tri ----------------------------------------------- */

  // Aucune des trois sources n'est complète à elle seule : la date situe,
  // l'acte nomme l'auteur, le courriel porte le sujet et le destinataire. On ne
  // choisit donc pas — on fusionne champ par champ, en gardant le premier
  // renseigné et la date la plus ancienne, qui est celle où le fait a commencé.
  const parCle = new Map<string, EvenementInterne>();
  const sansCle: EvenementInterne[] = [];

  for (const e of evenements) {
    if (!e.cle) {
      sansCle.push(e);
      continue;
    }

    const dejaLa = parCle.get(e.cle);

    if (!dejaLa) {
      parCle.set(e.cle, { ...e });
      continue;
    }

    parCle.set(e.cle, {
      ...dejaLa,
      date: e.date < dejaLa.date ? e.date : dejaLa.date,
      // L'intitulé de l'acte est plus précis que celui de l'état déduit, mais
      // les deux disent la même chose : on garde le premier venu et on ne
      // fabrique pas un libellé composite illisible.
      detail: dejaLa.detail ?? e.detail,
      lien: dejaLa.lien ?? e.lien,
      acteur: dejaLa.acteur ?? e.acteur,
      // Le poids le plus fort l'emporte : si l'une des sources tient ce fait
      // pour décisif, le fusionné l'est aussi.
      importance:
        dejaLa.importance === 'majeur' || e.importance === 'majeur' ? 'majeur' : 'courant',
    });
  }

  return [...parCle.values(), ...sansCle]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map(({ cle: _cle, ...reste }) => reste);
}

/**
 * Avis de non-remise, reconnu à son émetteur ou à son objet.
 *
 * Ces messages arrivent typés `rebond` avec pour sujet « Delivery Status
 * Notification (Failure) » et pour expéditeur `mailer-daemon@…`. Affichés tels
 * quels, ils occupaient trois lignes identiques de jargon anglais au milieu
 * d'une chronologie en français — alors que le fait qu'ils portent est simple
 * et important : ce fournisseur n'a jamais reçu la demande.
 */
function estNonRemise(expediteur: string | null, sujet: string | null): boolean {
  if (expediteur && /(mailer-daemon|postmaster|no-?reply@.*mail)/i.test(expediteur)) return true;
  return Boolean(
    sujet && /(delivery status notification|undeliverable|mail delivery (failed|subsystem))/i.test(sujet),
  );
}

/** Sujet débarrassé de ses préfixes de fil et de ses espaces parasites. */
function nettoyerSujet(sujet: string | null): string | null {
  if (!sujet) return null;
  const propre = sujet
    .replace(/^\s*((re|ré|fw|fwd|tr)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return propre || null;
}

/** Motif ou commentaire porté par l'acte, quand il y en a un. */
function motifDe(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  for (const clef of ['motif', 'motif_refus', 'commentaire', 'raison']) {
    const v = d[clef];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** Écran où l'acte se relit, quand il en existe un. */
function lienEntite(entite: string, id: number | null, demandeId: number): string | null {
  switch (entite) {
    case 'offres':
      return id ? `/offres/${id}/preview` : null;
    case 'consultations':
      return `/demandes/${demandeId}/consultations`;
    case 'devis_fournisseur':
    case 'cost_sheets':
      return `/demandes/${demandeId}/costing`;
    case 'tickets_sav':
      return '/apres-vente';
    case 'demandes':
      return `/demandes/${demandeId}`;
    default:
      return null;
  }
}
