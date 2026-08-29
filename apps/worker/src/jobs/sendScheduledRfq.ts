import { DEFAUTS_METIER } from '@vigon/shared';
import {
  clientAdmin,
  envoiConfigure,
  envoyer,
  lireContacts,
  marquerSuivi,
  resoudreDestinataires,
  nombreOptionnel,
  optionnel,
  tenantId,
  type ClientAdmin,
} from '@vigon/services';

/** Nombre d'envois par cycle : borne la casse si Gmail commence à limiter. */
const LOT_MAX = 10;

async function notifierPresale(
  db: ClientAdmin,
  tenant: string,
  demandeId: number | null,
  params: { type: string; severite: 'info' | 'avertissement'; titre: string; message: string },
): Promise<void> {
  const { error } = await db.from('notifications').insert({
    tenant_id: tenant,
    role_cible: 'presale',
    type: params.type,
    severite: params.severite,
    titre: params.titre,
    message: params.message,
    lien: demandeId ? `/demandes/${demandeId}/consultations` : null,
    demande_id: demandeId,
  });
  if (error) console.error(`[envoi-rfq] notification impossible : ${error.message}`);
}

/**
 * Fait passer la demande à « envoyee_fournisseurs » quand plus aucune
 * consultation n'attend son envoi.
 */
async function majStatutDemande(
  db: ClientAdmin,
  tenant: string,
  demandeId: number,
): Promise<void> {
  const { count } = await db
    .from('consultations')
    .select('id', { count: 'exact', head: true })
    .eq('demande_id', demandeId)
    .eq('tenant_id', tenant)
    .in('statut', ['en_validation', 'planifiee']);

  if ((count ?? 0) === 0) {
    await db
      .from('demandes')
      .update({ statut: 'envoyee_fournisseurs', date_envoi_rfq: new Date().toISOString() })
      .eq('id', demandeId)
      .eq('tenant_id', tenant)
      // Même garde qu'à la réception : un envoi tardif ne doit pas ramener en
      // arrière un dossier déjà en costing, gagné ou perdu.
      .in('statut', ['fournisseurs_identifies', 'en_validation_rfq', 'planifiee']);
  }
}

/**
 * Envoie les consultations dont l'heure est venue.
 *
 * Idempotence : le passage à « envoyee » est fait AVANT l'appel Gmail, sous
 * condition que la ligne soit encore « planifiee ». Deux cycles concurrents ne
 * peuvent donc pas envoyer deux fois le même message — au pire on marque un
 * envoi qui échoue ensuite, ce que le statut « abandonnee » et la notification
 * rendent visible, alors qu'un double envoi serait invisible et irrattrapable.
 */
export async function sendScheduledRfq(): Promise<number> {
  if (!envoiConfigure('fournisseur')) return 0;

  const db = clientAdmin();
  const tenant = await tenantId();

  const { data: dues, error } = await db
    .from('consultations')
    .select(
      'id, demande_id, fournisseur_id, fournisseur_email, fournisseur_nom, marque, sujet, corps_html',
    )
    .eq('tenant_id', tenant)
    .eq('statut', 'planifiee')
    .lte('date_envoi_prevue', new Date().toISOString())
    .order('date_envoi_prevue', { ascending: true })
    .limit(LOT_MAX);

  if (error) throw new Error(`Lecture des consultations dues : ${error.message}`);
  if (!dues || dues.length === 0) return 0;

  const label = optionnel('GMAIL_LABEL_SUIVI', '');
  const delaiRelance = nombreOptionnel(
    'DELAI_RELANCE_HEURES',
    DEFAUTS_METIER.delaiRelanceHeures,
  );

  // Contacts lus en une fois pour tout le lot. Un fournisseur sans contact
  // déclaré n'apparaît pas dans cette table : son message part exactement où il
  // partait avant, à l'adresse de la fiche.
  const contactsParFournisseur = await lireContacts(
    dues.map((c) => c.fournisseur_id).filter((v): v is number => v !== null),
  );

  let envoyees = 0;
  const demandesTouchees = new Set<number>();

  for (const consultation of dues) {
    if (!consultation.fournisseur_email || !consultation.sujet || !consultation.corps_html) {
      await db
        .from('consultations')
        .update({ statut: 'abandonnee' })
        .eq('id', consultation.id);

      await notifierPresale(db, tenant, consultation.demande_id, {
        type: 'consultation_incomplete',
        severite: 'avertissement',
        titre: `Consultation ${consultation.marque ?? ''} incomplète`,
        message: 'Destinataire ou contenu manquant : envoi abandonné.',
      });
      continue;
    }

    // Verrou optimiste : seul le cycle qui fait passer planifiee -> envoyee
    // obtient la ligne et procède à l'envoi.
    const { data: verrou } = await db
      .from('consultations')
      .update({ statut: 'envoyee', date_envoi_reelle: new Date().toISOString() })
      .eq('id', consultation.id)
      .eq('statut', 'planifiee')
      .select('id');

    if (!verrou || verrou.length === 0) continue;

    // Aucun contact déclaré : `a` reste l'adresse de la fiche et `cc` est vide,
    // donc le message est identique à celui d'avant cette fonctionnalité.
    const destinataires = resoudreDestinataires(
      consultation.fournisseur_email,
      (consultation.fournisseur_id === null
        ? undefined
        : contactsParFournisseur.get(consultation.fournisseur_id)) ?? [],
    );

    try {
      const message = await envoyer('fournisseur', {
        a: destinataires.a,
        cc: destinataires.cc,
        sujet: consultation.sujet,
        html: consultation.corps_html,
      });

      // Le label n'existe qu'avec l'API Gmail. En SMTP il est simplement absent,
      // ce qui ne change rien au flux : le périmètre de relance est déterminé
      // par le statut de la consultation, pas par le label.
      let labelPose = false;
      if (label) {
        try {
          labelPose = await marquerSuivi('fournisseur', message.messageId, 'ajouter');
        } catch (e) {
          console.error(
            `[envoi-rfq] label non posé sur ${message.messageId} : ${e instanceof Error ? e.message : e}`,
          );
        }
      }

      const prochaine = new Date(Date.now() + delaiRelance * 3_600_000);

      await db
        .from('consultations')
        .update({
          thread_id: message.threadId,
          message_id: message.messageId,
          label_suivi: labelPose ? label : null,
          prochaine_relance: prochaine.toISOString(),
        })
        .eq('id', consultation.id);

      await db.from('communications').insert({
        tenant_id: tenant,
        demande_id: consultation.demande_id,
        consultation_id: consultation.id,
        direction: 'sortant',
        type: 'demande_devis',
        thread_id: message.threadId,
        message_id: message.messageId,
        destinataires: [destinataires.a, ...destinataires.cc],
        sujet: consultation.sujet,
        corps_html: consultation.corps_html,
      });

      await db.from('audit_events').insert({
        tenant_id: tenant,
        entite: 'consultations',
        entite_id: consultation.id,
        action: 'consultation.envoyee',
        acteur_type: 'worker',
        details: {
          marque: consultation.marque,
          destinataire: consultation.fournisseur_email,
          thread_id: message.threadId,
          transport: message.transport,
        },
      });

      if (consultation.demande_id) demandesTouchees.add(consultation.demande_id);
      envoyees += 1;

      console.info(
        `[envoi-rfq] ${consultation.marque} -> ${consultation.fournisseur_email} (thread ${message.threadId})`,
      );
    } catch (e) {
      const motif = e instanceof Error ? e.message : String(e);

      // L'envoi a échoué après le verrou : on sort la consultation du flux et
      // on alerte, plutôt que de la remettre en file et risquer un doublon.
      await db
        .from('consultations')
        .update({ statut: 'abandonnee', date_envoi_reelle: null })
        .eq('id', consultation.id);

      await notifierPresale(db, tenant, consultation.demande_id, {
        type: 'envoi_echoue',
        severite: 'avertissement',
        titre: `Envoi échoué — ${consultation.marque ?? ''}`,
        message: `${consultation.fournisseur_email} : ${motif}. Consultation à renvoyer manuellement.`,
      });

      console.error(`[envoi-rfq] échec ${consultation.id} : ${motif}`);
    }
  }

  for (const demandeId of demandesTouchees) {
    await majStatutDemande(db, tenant, demandeId);
  }

  return envoyees;
}
