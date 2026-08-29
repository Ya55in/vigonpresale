import { clientAdmin, lireParametres, tenantId, type ClientAdmin } from '@vigon/services';

/**
 * Alerte l'administration sur les offres parties sans être ouvertes.
 *
 * Distinct du job d'expiration, qui constate la perte une fois l'échéance
 * passée. Ici on intervient AVANT : une offre envoyée depuis plusieurs jours et
 * jamais ouverte signale le plus souvent un problème de délivrabilité — adresse
 * erronée, message en indésirables — qu'un rappel commercial ne résoudra pas.
 * Le signaler à temps laisse une chance de reprendre contact autrement.
 */

/** Une offre déjà consultée sort du périmètre : c'est l'ouverture qu'on surveille. */
const STATUTS_SURVEILLES = ['envoyee'] as const;

/** Trace du rappel déjà émis ; sert de garde d'idempotence. */
const ACTION_AUDIT = 'offre.rappel_non_consultee';

async function dejaRappelees(
  db: ClientAdmin,
  tenant: string,
  offreIds: number[],
): Promise<Set<number>> {
  const deja = new Set<number>();
  if (offreIds.length === 0) return deja;

  // Le rappel n'a pas de colonne dédiée au schéma : l'événement d'audit en est
  // la seule trace, et donc le seul moyen de ne pas alerter tous les jours.
  const { data, error } = await db
    .from('audit_events')
    .select('entite_id')
    .eq('tenant_id', tenant)
    .eq('entite', 'offres')
    .eq('action', ACTION_AUDIT)
    .in('entite_id', offreIds);

  if (error) {
    // Sans cette lecture on ne peut pas garantir l'unicité du rappel. Mieux vaut
    // ne rien envoyer que réveiller l'administration chaque matin sur le même
    // dossier : on considère tout le lot comme déjà traité.
    console.error(`[rappel-offres] lecture de l'audit impossible : ${error.message}`);
    for (const identifiant of offreIds) deja.add(identifiant);
    return deja;
  }

  for (const evenement of data ?? []) {
    if (evenement.entite_id !== null) deja.add(evenement.entite_id);
  }

  return deja;
}

/**
 * Rappelle les offres envoyées mais jamais ouvertes au-delà du délai.
 *
 * Le délai est la moitié de la validité de l'offre, plafonnée à 7 jours : sur
 * une offre valable 30 jours, alerter au bout de 15 laisse trop peu de marge
 * pour réagir, et sur une offre valable 4 jours, alerter au bout de 2 est le
 * bon moment.
 */
export async function rappelOffresNonConsultees(): Promise<number> {
  const db = clientAdmin();
  const tenant = await tenantId();
  const parametres = await lireParametres(tenant);

  const delaiJours = Math.max(
    1,
    Math.min(7, Math.floor(parametres.delaiExpirationOffreJours / 2)),
  );
  const seuil = new Date(Date.now() - delaiJours * 86_400_000);

  const { data: candidates, error } = await db
    .from('offres')
    .select('id, demande_id, numero, date_envoi, date_expiration, nb_consultations')
    .eq('tenant_id', tenant)
    .in('statut', STATUTS_SURVEILLES)
    .is('date_consultation', null)
    .not('date_envoi', 'is', null)
    .lt('date_envoi', seuil.toISOString());

  if (error) throw new Error(`Lecture des offres non consultées : ${error.message}`);
  if (!candidates || candidates.length === 0) return 0;

  const traitees = await dejaRappelees(
    db,
    tenant,
    candidates.map((o) => o.id),
  );

  const aRappeler = candidates.filter((o) => !traitees.has(o.id));
  if (aRappeler.length === 0) return 0;

  let rappels = 0;

  for (const offre of aRappeler) {
    const joursEcoules = offre.date_envoi
      ? Math.floor((Date.now() - new Date(offre.date_envoi).getTime()) / 86_400_000)
      : delaiJours;

    const expiration = offre.date_expiration
      ? new Date(offre.date_expiration).toLocaleDateString('fr-FR')
      : null;

    // ADMIN d'abord — c'est le destinataire demandé — et PRESALE qui suit le
    // dossier au quotidien.
    const { error: erreurNotif } = await db.from('notifications').insert(
      (['admin', 'presale'] as const).map((role) => ({
        tenant_id: tenant,
        role_cible: role,
        type: 'offre_non_consultee',
        severite: 'avertissement',
        titre: `Offre jamais ouverte — ${offre.numero}`,
        message:
          `Envoyée il y a ${joursEcoules} jour(s), l'offre n'a toujours pas été ouverte par le client. ` +
          `Vérifiez l'adresse du destinataire ou reprenez contact` +
          (expiration ? ` — elle expire le ${expiration}.` : '.'),
        lien: `/offres/${offre.id}/preview`,
        offre_id: offre.id,
        demande_id: offre.demande_id,
      })),
    );

    if (erreurNotif) {
      // Sans notification, écrire la trace d'audit ferait passer le rappel pour
      // émis et l'offre ne serait jamais signalée : on retente au prochain cycle.
      console.error(`[rappel-offres] notification impossible : ${erreurNotif.message}`);
      continue;
    }

    await db.from('audit_events').insert({
      tenant_id: tenant,
      entite: 'offres',
      entite_id: offre.id,
      action: ACTION_AUDIT,
      acteur_type: 'worker',
      details: {
        numero: offre.numero,
        jours_ecoules: joursEcoules,
        delai_jours: delaiJours,
        date_envoi: offre.date_envoi,
      },
    });

    rappels += 1;
    console.info(
      `[rappel-offres] ${offre.numero} non consultée depuis ${joursEcoules} jour(s).`,
    );
  }

  return rappels;
}
