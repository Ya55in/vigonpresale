import type { Json } from '@vigon/database';
import {
  clientAdmin,
  estCourrierAutomatique,
  estRebond,
  genererCode,
  relverMessagesNonLus,
  tenantId,
  type ClientAdmin,
  type MessageEntrant,
} from '@vigon/services';

import { extraireSpecifications } from '../services/extractionSpecs.js';
import { traiterReponseFournisseur } from '../services/reponseFournisseur.js';
import { traiterPiecesJointes } from '../services/piecesJointes.js';

/**
 * Longueur minimale d'un contenu pour valoir un appel au modèle.
 *
 * En dessous, il ne reste en pratique qu'une signature ou un accusé de
 * réception : on bloque la demande plutôt que de dépenser un appel et de
 * risquer une extraction inventée.
 */
const LONGUEUR_MIN_EXPLOITABLE = 40;

/**
 * Assemble le contenu soumis au modèle : corps du mail puis textes extraits.
 *
 * L'ordre compte — le corps porte souvent le contexte (deadline, interlocuteur)
 * que les pièces jointes ne répètent pas.
 */
function consolider(sujet: string, corps: string, textePj: string): string {
  const morceaux = [`--- Sujet ---\n${sujet}`.trim()];

  if (corps.trim()) morceaux.push(`--- Corps du message ---\n${corps.trim()}`);
  if (textePj.trim()) morceaux.push(textePj.trim());

  return morceaux.join('\n\n');
}

/** Retrouve ou crée le client d'après l'adresse de l'expéditeur. */
async function resoudreClient(
  db: ClientAdmin,
  tenant: string,
  email: string,
  nomDevine: string | null,
): Promise<number | null> {
  if (!email) return null;

  const { data: existant } = await db
    .from('clients')
    .select('id')
    .eq('tenant_id', tenant)
    .ilike('email_principal', email)
    .maybeSingle();

  if (existant) return existant.id;

  // Sans nom exploitable, le domaine reste le meilleur identifiant provisoire ;
  // PRESALE le corrigera depuis l'écran demande.
  const nom = nomDevine?.trim() || (email.split('@')[1] ?? email);

  const { data: cree, error } = await db
    .from('clients')
    .insert({ tenant_id: tenant, nom, email_principal: email })
    .select('id')
    .single();

  if (error) {
    console.error(`[reception] création client impossible (${email}) : ${error.message}`);
    return null;
  }
  return cree.id;
}

/** Notifie PRESALE (et ADMIN via son accès total) d'un événement sur la demande. */
async function notifierPresale(
  db: ClientAdmin,
  tenant: string,
  params: {
    demandeId: number;
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
    lien: `/demandes/${params.demandeId}`,
    demande_id: params.demandeId,
  });

  if (error) {
    console.error(`[reception] notification impossible : ${error.message}`);
  }
}

async function auditer(
  db: ClientAdmin,
  tenant: string,
  demandeId: number,
  action: string,
  details: Json,
): Promise<void> {
  const { error } = await db.from('audit_events').insert({
    tenant_id: tenant,
    entite: 'demandes',
    entite_id: demandeId,
    action,
    acteur_type: 'worker',
    details,
  });

  if (error) {
    console.error(`[reception] audit impossible : ${error.message}`);
  }
}

/**
 * Traite un message entrant de bout en bout.
 *
 * Idempotence : un `message_id_client` déjà connu est ignoré. C'est la garde qui
 * évite de recréer une demande si le message est redélivré ou si le marquage
 * « lu » a échoué au cycle précédent.
 */
async function traiterMessage(message: MessageEntrant): Promise<void> {
  const db = clientAdmin();
  const tenant = await tenantId();

  if (message.messageId) {
    const { data: deja } = await db
      .from('demandes')
      .select('id, code, statut, contenu_consolide')
      .eq('tenant_id', tenant)
      .eq('message_id_client', message.messageId)
      .maybeSingle();

    if (deja) {
      // Demande créée mais restée sans extraction (quota épuisé au cycle
      // précédent) : on reprend là où on s'était arrêté au lieu de l'abandonner.
      if (deja.statut === 'nouvelle' && deja.contenu_consolide) {
        console.info(`[reception] reprise de l'extraction pour ${deja.code}.`);
        await extraireSpecifications({
          demandeId: deja.id,
          tenant,
          code: deja.code,
          contenu: deja.contenu_consolide,
          piecesIllisibles: [],
        });
        return;
      }

      console.info(`[reception] message déjà traité (demande ${deja.code}), ignoré.`);
      return;
    }
  }

  const clientId = await resoudreClient(
    db,
    tenant,
    message.expediteur,
    message.expediteurBrut.replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || null,
  );

  const code = await genererCode('DM', 'seq_demande');

  const { data: demande, error: creation } = await db
    .from('demandes')
    .insert({
      tenant_id: tenant,
      client_id: clientId,
      code,
      titre: message.sujet,
      statut: 'nouvelle',
      source: 'email',
      email_client: message.expediteur,
      expediteur_brut: message.expediteurBrut,
      sujet_original: message.sujet,
      corps_original: message.corpsTexte,
      message_id_client: message.messageId,
      thread_id_client: message.inReplyTo ?? message.messageId,
      date_reception: message.date.toISOString(),
    })
    .select('id')
    .single();

  if (creation || !demande) {
    throw new Error(`Création de la demande impossible : ${creation?.message}`);
  }

  console.info(`[reception] demande ${code} (#${demande.id}) créée — ${message.sujet}`);

  // Trace le message reçu avant tout traitement : la demande reste explicable
  // même si l'extraction échoue ensuite.
  await db.from('communications').insert({
    tenant_id: tenant,
    demande_id: demande.id,
    direction: 'entrant',
    type: 'demande_client',
    thread_id: message.inReplyTo ?? message.messageId,
    message_id: message.messageId,
    expediteur: message.expediteur,
    sujet: message.sujet,
    corps_texte: message.corpsTexte,
    corps_html: message.corpsHtml,
    date_envoi: message.date.toISOString(),
  });

  const pj = await traiterPiecesJointes(demande.id, tenant, message.piecesJointes);

  const contenu = consolider(message.sujet, message.corpsTexte, pj.texte);

  await db
    .from('demandes')
    .update({ contenu_consolide: contenu })
    .eq('id', demande.id)
    .eq('tenant_id', tenant);

  await auditer(db, tenant, demande.id, 'demande.recue', {
    code,
    pieces_jointes: pj.stockes,
    illisibles: pj.illisibles,
    longueur_contenu: contenu.length,
  });

  // Rien d'exploitable : on bloque explicitement plutôt que d'appeler le modèle
  // sur du vide, ce qui produirait une extraction fantaisiste.
  if (contenu.trim().length < LONGUEUR_MIN_EXPLOITABLE) {
    const motif =
      pj.illisibles.length > 0
        ? `Aucun contenu exploitable. Pièces jointes en échec : ${pj.illisibles.join(' ; ')}`
        : 'Aucun contenu exploitable dans le message ni les pièces jointes.';

    await db
      .from('demandes')
      .update({ statut: 'bloquee', motif_blocage: motif })
      .eq('id', demande.id)
      .eq('tenant_id', tenant);

    await notifierPresale(db, tenant, {
      demandeId: demande.id,
      type: 'demande_bloquee',
      severite: 'avertissement',
      titre: `Demande ${code} à traiter manuellement`,
      message: motif,
    });

    console.warn(`[reception] demande ${code} bloquée : ${motif}`);
    return;
  }

  await extraireSpecifications({
    demandeId: demande.id,
    tenant,
    code,
    contenu,
    piecesIllisibles: pj.illisibles,
  });
}

/**
 * Relève la boîte et aiguille chaque message non lu.
 *
 * Une seule boîte sert aux deux flux : les demandes clients arrivent comme
 * messages neufs, les devis fournisseurs comme réponses à nos consultations.
 * L'aiguillage se fait sur `In-Reply-To` / `References` — sans lui, une réponse
 * de fournisseur créerait une demande client fantôme.
 *
 * Une erreur sur un message n'interrompt pas le cycle : il reste non lu et sera
 * rejoué au passage suivant, les autres continuent d'être traités.
 */
export async function pollClientMailbox(): Promise<number> {
  return relverMessagesNonLus(async (message) => {
    try {
      // Réponse à une consultation connue ? Alors c'est un devis, pas une demande.
      const estReponse = message.inReplyTo !== null || message.references.length > 0;

      if (estReponse) {
        const resultat = await traiterReponseFournisseur(message);
        if (resultat.traite) return;

        // Un avis de non-remise n'est jamais une demande client, même quand son
        // fil d'origine reste introuvable — cas d'un rebond de relance, dont
        // l'en-tête pointe un message que la table ne connaît pas. Sans ce
        // garde-fou, chaque rebond créait une demande fantôme aussitôt bloquée
        // faute d'articles, et la liste se remplissait de MAILER-DAEMON.
        if (estRebond(message)) {
          console.info(
            `[reception] avis de non-remise sans fil connu (${resultat.motif}) — ignoré.`,
          );
          return;
        }

        console.info(
          `[reception] « ${message.sujet} » : ${resultat.motif} — traité comme demande client.`,
        );
      }

      // Notification de service, infolettre, envoi de masse : jamais une
      // consultation. Écarté ICI, après l'aiguillage fournisseur — un accusé de
      // réception automatique dans un fil connu reste une information utile sur
      // cette consultation, et doit continuer d'y être rattaché.
      //
      // Contrôlé avant `traiterMessage` : plus loin, la demande existerait déjà
      // et il faudrait la défaire. C'est ce qui a rempli la liste de « Welcome
      // to Facebook » aussitôt bloquées.
      const automatique = estCourrierAutomatique(message);
      if (automatique.automatique) {
        console.info(
          `[reception] courrier automatique écarté (${automatique.motif}) — ` +
            `${message.expediteur} : « ${message.sujet} »`,
        );
        return;
      }

      await traiterMessage(message);
    } catch (e) {
      console.error(
        `[reception] échec sur « ${message.sujet} » : ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  });
}
