import { randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';

import { urlApplication } from '@vigon/shared';

/**
 * Circuit d'approbation avant génération de l'offre.
 *
 * La spec le décrit via WhatsApp. Le canal n'est qu'un transport : ce qui
 * compte est la demande de validation, son lien de consultation et la décision
 * explicite qui débloque la génération. Tout cela fonctionne dès aujourd'hui
 * par courriel ; WhatsApp deviendra un émetteur de plus le jour où le compte
 * Business API existera.
 *
 * OPTIONNEL. Le drapeau `validation_offre_obligatoire` vaut `false` par défaut :
 * sans lui, la génération d'offre est inchangée. Le rendre obligatoire d'emblée
 * aurait bloqué tous les dossiers en cours.
 */

export const CLE_VALIDATION_OBLIGATOIRE = 'validation_offre_obligatoire';

/** Au-delà, la demande est caduque : une validation qui traîne n'engage plus. */
const DELAI_EXPIRATION_JOURS = 7;

/** Même construction que les jetons d'offre et de devis : 192 bits. */
const genererToken = (): string => randomBytes(24).toString('base64url');

export type ValidationEnAttente = {
  id: number;
  token: string;
  demandeId: number;
  costSheetId: number;
  totalHt: number;
  totalTtc: number;
  margePct: number | null;
  devise: string;
  dateDemande: string;
  dateExpiration: string | null;
  expiree: boolean;
};

/** La validation est-elle exigée sur ce tenant ? */
export async function validationObligatoire(tenant: string): Promise<boolean> {
  const { lireDrapeau } = await import('@vigon/services');
  return lireDrapeau(tenant, CLE_VALIDATION_OBLIGATOIRE, false);
}

/**
 * Décision en cours ou rendue sur une feuille.
 *
 * Sert deux appelants : l'écran, qui affiche l'état, et la génération, qui
 * refuse tant que l'accord n'est pas donné.
 */
export async function lireValidation(
  tenant: string,
  costSheetId: number,
): Promise<{
  statut: 'aucune' | 'en_attente' | 'approuvee' | 'refusee' | 'expiree';
  validation: ValidationEnAttente | null;
  motifRefus: string | null;
}> {
  const { data } = await createAdminClient()
    .from('validations_offre')
    .select(
      'id, token_public, demande_id, cost_sheet_id, statut, total_ht, total_ttc, marge_pct, devise, date_demande, date_expiration, motif_refus',
    )
    .eq('tenant_id', tenant)
    .eq('cost_sheet_id', costSheetId)
    .order('date_demande', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { statut: 'aucune', validation: null, motifRefus: null };

  const expiree =
    data.statut === 'en_attente' &&
    data.date_expiration !== null &&
    new Date(data.date_expiration) < new Date();

  return {
    // L'expiration est calculée à la lecture plutôt qu'écrite par un job : une
    // seule vérité, et pas de statut qui dépende du passage d'un worker.
    statut: expiree ? 'expiree' : (data.statut as 'en_attente' | 'approuvee' | 'refusee'),
    validation: {
      id: data.id,
      token: data.token_public,
      demandeId: data.demande_id,
      costSheetId: data.cost_sheet_id,
      totalHt: Number(data.total_ht),
      totalTtc: Number(data.total_ttc),
      margePct: data.marge_pct === null ? null : Number(data.marge_pct),
      devise: data.devise,
      dateDemande: data.date_demande,
      dateExpiration: data.date_expiration,
      expiree,
    },
    motifRefus: data.motif_refus,
  };
}

export type Approbateur = {
  id: string;
  email: string;
  nom: string | null;
  telegramChatId: string | null;
  telephone: string | null;
  /** Vrai quand la personne peut être jointe autrement que par courriel. */
  joignable: boolean;
};

/**
 * L'accord se donne-t-il sur place, sans escalade ?
 *
 * L'escalade n'a de sens que vers quelqu'un d'AUTRE. Un administrateur qui
 * travaille lui-même la feuille est déjà l'approbateur : lui envoyer un lien
 * par Telegram serait un aller-retour hors plateforme pour une décision qu'il
 * peut prendre à l'écran, devant les montants.
 *
 * La règle vit ici et nulle part ailleurs : l'écran s'en sert pour choisir le
 * bouton, l'action serveur pour autoriser la décision.
 */
export function peutApprouverSurPlace(role: string): boolean {
  return role === 'admin';
}

/**
 * À qui adresser une demande d'approbation.
 *
 * L'ACCORD REVIENT À L'ADMINISTRATEUR. Jusqu'ici l'action lisait une adresse
 * saisie dans un formulaire : l'avant-vente désignait donc son propre
 * approbateur, ce qui vide la garde de son sens.
 *
 * Les autres comptes autorisés ne servent qu'en SECOURS — quand aucun
 * administrateur n'a de canal instantané lié, et qu'attendre le courriel
 * retarderait la génération. C'est l'arbitrage retenu le 2026-08-21 : une
 * responsabilité portée, pas diluée.
 *
 * `exclure` écarte le demandeur de sa propre demande : sans lui, un admin qui
 * clique « demander l'accord » recevrait son propre lien sur son Telegram.
 *
 * Rend TOUJOURS une liste, même sans canal instantané : le courriel reste le
 * dernier recours, et une demande qui ne part pas bloquerait la génération.
 */
export async function resoudreApprobateurs(
  tenant: string,
  exclure?: string,
): Promise<{
  destinataires: Approbateur[];
  /** Vrai quand on est descendu sur les comptes autorisés faute d'admin joignable. */
  parSecours: boolean;
}> {
  const db = createAdminClient();

  const { data } = await db
    .from('users')
    .select('id, email, prenom, nom, role, telegram_chat_id, telephone, recoit_validations')
    .eq('tenant_id', tenant)
    .eq('actif', true);

  const versApprobateur = (u: {
    id: string;
    email: string;
    prenom: string | null;
    nom: string | null;
    telegram_chat_id: string | null;
    telephone: string | null;
  }): Approbateur => ({
    id: u.id,
    email: u.email,
    nom: [u.prenom, u.nom].filter(Boolean).join(' ') || null,
    telegramChatId: u.telegram_chat_id,
    telephone: u.telephone,
    joignable: Boolean(u.telegram_chat_id || u.telephone),
  });

  const comptes = (data ?? []).filter((u) => u.id !== exclure);

  const admins = comptes.filter((u) => u.role === 'admin').map(versApprobateur);
  const autorises = comptes
    .filter((u) => u.role !== 'admin' && u.recoit_validations)
    .map(versApprobateur);

  // Un administrateur joignable clôt la question : c'est lui, et lui seul.
  if (admins.some((a) => a.joignable)) {
    return { destinataires: admins.filter((a) => a.joignable), parSecours: false };
  }

  // Aucun admin joignable : les autorisés prennent le relais, s'il en existe.
  const secours = autorises.filter((a) => a.joignable);
  if (secours.length > 0) return { destinataires: secours, parSecours: true };

  // Personne n'a de canal instantané : le courriel à l'administrateur.
  return { destinataires: admins, parSecours: false };
}

export type ResultatDemande =
  | { ok: true; token: string; lien: string }
  | { ok: false; message: string };

/**
 * Soumet une feuille verrouillée à l'approbation de l'administrateur.
 *
 * Les montants sont figés ici : si la feuille bouge après coup, la décision
 * doit rester lisible telle qu'elle a été prise. Une nouvelle version de
 * feuille exige donc une nouvelle demande.
 */
export async function demanderValidation(params: {
  tenant: string;
  utilisateurId: string;
  costSheetId: number;
  canal?: 'email' | 'whatsapp' | 'interne';
}): Promise<ResultatDemande> {
  const db = createAdminClient();

  const { data: feuille } = await db
    .from('cost_sheets')
    .select('id, demande_id, statut, devise, total_vente_ht, total_ttc, marge_globale_pct')
    .eq('id', params.costSheetId)
    .eq('tenant_id', params.tenant)
    .maybeSingle();

  if (!feuille) return { ok: false, message: 'Feuille de coûts introuvable.' };

  // Soumettre une feuille encore modifiable n'aurait pas de sens : les montants
  // approuvés changeraient après la décision.
  if (feuille.statut !== 'verrouille') {
    return { ok: false, message: 'Le costing doit être validé et verrouillé.' };
  }

  const existante = await lireValidation(params.tenant, params.costSheetId);

  if (existante.statut === 'en_attente') {
    return { ok: false, message: 'Une demande est déjà en attente de décision.' };
  }
  if (existante.statut === 'approuvee') {
    return { ok: false, message: 'Cette feuille est déjà approuvée.' };
  }

  const token = genererToken();
  const expiration = new Date(Date.now() + DELAI_EXPIRATION_JOURS * 86_400_000);

  const { error } = await db.from('validations_offre').insert({
    tenant_id: params.tenant,
    demande_id: feuille.demande_id,
    cost_sheet_id: feuille.id,
    token_public: token,
    statut: 'en_attente',
    canal: params.canal ?? 'email',
    demande_par: params.utilisateurId,
    total_ht: Number(feuille.total_vente_ht ?? 0),
    total_ttc: Number(feuille.total_ttc ?? 0),
    marge_pct: feuille.marge_globale_pct,
    devise: feuille.devise ?? 'MAD',
    date_expiration: expiration.toISOString(),
  });

  if (error) {
    // L'index partiel garantit une seule demande en attente par feuille : deux
    // clics successifs tombent ici plutôt que d'envoyer deux liens.
    console.error('[validation] demande impossible', error.message);
    return { ok: false, message: 'Demande impossible. Une décision est peut-être déjà en cours.' };
  }

  await db.from('audit_events').insert({
    tenant_id: params.tenant,
    user_id: params.utilisateurId,
    entite: 'cost_sheets',
    entite_id: feuille.id,
    action: 'validation.demandee',
    details: { canal: params.canal ?? 'email', total_ttc: Number(feuille.total_ttc ?? 0) },
  });

  const appUrl = urlApplication();

  return { ok: true, token, lien: `${appUrl}/validation/${token}` };
}

/**
 * Accord donné sur place par un administrateur connecté.
 *
 * DEUX CHEMINS, UNE SEULE TRACE. Que la décision vienne de Telegram, du lien
 * public ou d'ici, elle s'écrit dans `validations_offre` — c'est cette ligne,
 * et elle seule, que la génération d'offre interroge. L'écran ne « débloque »
 * donc rien de particulier : il prend la même décision par un autre chemin.
 *
 * Deux cas, distingués par ce qui existait déjà :
 *
 * - une demande EN ATTENTE : quelqu'un l'a soumise et attend. On la tranche
 *   sans en créer une seconde, et l'avant-vente est notifiée.
 * - AUCUNE demande : l'administrateur travaille sa propre feuille. La ligne est
 *   créée directement approuvée, canal `interne`. Personne n'attend, donc rien
 *   à notifier — la notification irait à celui qui vient de cliquer.
 */
export async function approuverSurPlace(params: {
  tenant: string;
  utilisateurId: string;
  costSheetId: number;
}): Promise<{ ok: boolean; message: string; demandeId?: number }> {
  const db = createAdminClient();

  const { data: feuille } = await db
    .from('cost_sheets')
    .select('id, demande_id, statut, devise, total_vente_ht, total_ttc, marge_globale_pct')
    .eq('id', params.costSheetId)
    .eq('tenant_id', params.tenant)
    .maybeSingle();

  if (!feuille) return { ok: false, message: 'Feuille de coûts introuvable.' };

  // Même exigence que pour l'escalade : approuver une feuille encore modifiable
  // approuverait des montants qui peuvent changer juste après.
  if (feuille.statut !== 'verrouille') {
    return { ok: false, message: 'Le costing doit être validé et verrouillé.' };
  }

  const existante = await lireValidation(params.tenant, params.costSheetId);

  if (existante.statut === 'approuvee') {
    return { ok: false, message: 'Cette feuille est déjà approuvée.' };
  }

  const maintenant = new Date().toISOString();
  const enAttente = existante.statut === 'en_attente' && existante.validation !== null;

  if (enAttente) {
    const { data, error } = await db
      .from('validations_offre')
      .update({
        statut: 'approuvee',
        decide_par: params.utilisateurId,
        date_decision: maintenant,
      })
      .eq('id', existante.validation!.id)
      // Même garde d'idempotence que la page publique : si l'approbateur vient
      // de trancher depuis Telegram, la seconde écriture ne passe pas.
      .eq('statut', 'en_attente')
      .select('id')
      .maybeSingle();

    if (error || !data) {
      return { ok: false, message: 'Une décision a déjà été prise sur cette demande.' };
    }

    await db.from('notifications').insert(
      (['presale', 'finance'] as const).map((role) => ({
        tenant_id: params.tenant,
        role_cible: role,
        type: 'costing_a_valider',
        severite: 'info',
        titre: 'Génération de l’offre approuvée',
        message: 'L’administrateur a donné son accord : l’offre peut être générée.',
        lien: `/demandes/${feuille.demande_id}/costing`,
        demande_id: feuille.demande_id,
      })),
    );
  } else {
    const { error } = await db.from('validations_offre').insert({
      tenant_id: params.tenant,
      demande_id: feuille.demande_id,
      cost_sheet_id: feuille.id,
      token_public: genererToken(),
      statut: 'approuvee',
      canal: 'interne',
      demande_par: params.utilisateurId,
      decide_par: params.utilisateurId,
      total_ht: Number(feuille.total_vente_ht ?? 0),
      total_ttc: Number(feuille.total_ttc ?? 0),
      marge_pct: feuille.marge_globale_pct,
      devise: feuille.devise ?? 'MAD',
      // Pas d'expiration : une décision prise n'expire pas. Seule une demande
      // en attente devient caduque.
      date_decision: maintenant,
    });

    if (error) {
      console.error('[validation] accord sur place impossible', error.message);
      return { ok: false, message: 'Accord non enregistré. Réessayez.' };
    }
  }

  await db.from('audit_events').insert({
    tenant_id: params.tenant,
    user_id: params.utilisateurId,
    entite: 'cost_sheets',
    entite_id: feuille.id,
    action: 'validation.approuvee',
    details: { sur_place: true, demande_resolue: enAttente },
  });

  return {
    ok: true,
    demandeId: feuille.demande_id,
    message: enAttente
      ? 'Accord enregistré — la demande en attente est close. L’offre peut être générée.'
      : 'Accord enregistré. L’offre peut être générée.',
  };
}

/**
 * Lecture publique d'une demande, par son jeton.
 *
 * Allowlist explicite, comme la page offre : le lien circule hors de la
 * plateforme, et rien d'interne — prix d'achat, nom de fournisseur — n'a à y
 * figurer. Seuls les montants soumis à décision sont montrés.
 */
export async function lireValidationPublique(token: string): Promise<{
  id: number;
  demandeCode: string | null;
  clientNom: string | null;
  objet: string | null;
  totalHt: number;
  totalTtc: number;
  margePct: number | null;
  devise: string;
  statut: string;
  expiree: boolean;
  decidable: boolean;
} | null> {
  if (!token || token.length < 20) return null;

  const db = createAdminClient();

  const { data } = await db
    .from('validations_offre')
    .select(
      'id, statut, total_ht, total_ttc, marge_pct, devise, date_expiration, demande_id',
    )
    .eq('token_public', token)
    .maybeSingle();

  if (!data) return null;

  const { data: demande } = await db
    .from('demandes')
    .select('code, titre, clients(nom)')
    .eq('id', data.demande_id)
    .maybeSingle();

  const client = Array.isArray(demande?.clients) ? demande.clients[0] : demande?.clients;

  const expiree =
    data.statut === 'en_attente' &&
    data.date_expiration !== null &&
    new Date(data.date_expiration) < new Date();

  return {
    id: data.id,
    demandeCode: demande?.code ?? null,
    clientNom: client?.nom ?? null,
    objet: demande?.titre ?? null,
    totalHt: Number(data.total_ht),
    totalTtc: Number(data.total_ttc),
    margePct: data.marge_pct === null ? null : Number(data.marge_pct),
    devise: data.devise,
    statut: expiree ? 'expiree' : data.statut,
    expiree,
    decidable: data.statut === 'en_attente' && !expiree,
  };
}
