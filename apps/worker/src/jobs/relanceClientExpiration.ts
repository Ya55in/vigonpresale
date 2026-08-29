import {
  buildRelanceClientHtml,
  clientAdmin,
  envoyer,
  envoiConfigure,
  lireParametres,
  sujetRelanceClient,
  tenantId,
  type ClientAdmin,
} from '@vigon/services';

import { urlApplication } from '@vigon/shared';

/**
 * Relance le client dont l'offre approche de son échéance.
 *
 * Complète les deux jobs voisins sans les recouper : `rappel-offres` alerte
 * l'interne quand rien n'a été ouvert, `expiration` constate la perte une fois
 * la date passée. Ici on écrit au client pendant qu'il peut encore décider.
 *
 * Une offre qui expire sans réponse est presque toujours une offre oubliée,
 * pas une offre refusée — le refus, lui, arrive vite et explicitement.
 */

/** Offres encore en attente d'une décision : les autres n'ont rien à relancer. */
const STATUTS_RELANCABLES = ['envoyee', 'consultee'] as const;

/** Trace de la relance émise ; sert de garde d'idempotence. */
const ACTION_AUDIT = 'offre.relance_client';

/**
 * Alerte préalable exigée avant d'écrire à un client qui n'a jamais ouvert.
 *
 * Une offre jamais ouverte signale le plus souvent un problème de délivrabilité
 * — adresse erronée, message en indésirables. Relancer sur le même canal
 * échouerait pareillement, et écrire « votre offre expire » à quelqu'un qui n'a
 * jamais rien reçu est incompréhensible côté client. On laisse donc
 * l'administration reprendre contact d'abord.
 */
const ACTION_ALERTE_PREALABLE = 'offre.rappel_non_consultee';

async function actionsTracees(
  db: ClientAdmin,
  tenant: string,
  action: string,
  offreIds: number[],
): Promise<Set<number>> {
  const vues = new Set<number>();
  if (offreIds.length === 0) return vues;

  const { data, error } = await db
    .from('audit_events')
    .select('entite_id')
    .eq('tenant_id', tenant)
    .eq('entite', 'offres')
    .eq('action', action)
    .in('entite_id', offreIds);

  if (error) {
    // Sans cette lecture, l'unicité n'est plus garantie. Mieux vaut ne rien
    // envoyer que relancer le même client chaque matin : on considère tout le
    // lot comme déjà traité.
    console.error(`[relance-client] lecture de l'audit impossible : ${error.message}`);
    for (const identifiant of offreIds) vues.add(identifiant);
    return vues;
  }

  for (const evenement of data ?? []) {
    if (evenement.entite_id !== null) vues.add(evenement.entite_id);
  }

  return vues;
}

export async function relanceClientExpiration(): Promise<number> {
  const db = clientAdmin();
  const tenant = await tenantId();
  const parametres = await lireParametres(tenant);

  const delaiJours = parametres.delaiRelanceClientJours;

  // 0 désactive la relance : le paramétrage doit pouvoir la couper sans
  // déployer, notamment si l'équipe préfère reprendre contact à la main.
  if (delaiJours <= 0) return 0;

  if (!envoiConfigure('principal')) {
    console.warn('[relance-client] aucun transport configuré : relances ignorées.');
    return 0;
  }

  const maintenant = Date.now();
  const seuil = new Date(maintenant + delaiJours * 86_400_000);

  const { data: candidates, error } = await db
    .from('offres')
    .select(
      'id, demande_id, numero, titre, token_public, date_expiration, date_consultation',
    )
    .eq('tenant_id', tenant)
    .in('statut', STATUTS_RELANCABLES)
    .not('date_expiration', 'is', null)
    // Fenêtre fermée des deux côtés : au-delà du seuil c'est trop tôt, en deçà
    // de maintenant l'offre est expirée et relance du job `expiration`.
    .lte('date_expiration', seuil.toISOString())
    .gt('date_expiration', new Date(maintenant).toISOString());

  if (error) throw new Error(`Lecture des offres à relancer : ${error.message}`);
  if (!candidates || candidates.length === 0) return 0;

  const identifiants = candidates.map((o) => o.id);

  const [dejaRelancees, dejaAlertees] = await Promise.all([
    actionsTracees(db, tenant, ACTION_AUDIT, identifiants),
    actionsTracees(db, tenant, ACTION_ALERTE_PREALABLE, identifiants),
  ]);

  let envois = 0;

  for (const offre of candidates) {
    if (dejaRelancees.has(offre.id)) continue;

    const jamaisConsultee = offre.date_consultation === null;

    // La règle demandée : pas de relance directe tant que l'administration
    // n'a pas été prévenue. `rappel-offres` tourne chaque matin à 8 h, la
    // relance suivra donc d'un jour au plus.
    if (jamaisConsultee && !dejaAlertees.has(offre.id)) {
      console.info(
        `[relance-client] ${offre.numero} jamais consultée et admin pas encore alertée : relance différée.`,
      );
      continue;
    }

    const destinataire = await adresseClient(db, tenant, offre.demande_id);

    if (!destinataire) {
      console.warn(`[relance-client] ${offre.numero} sans adresse client : ignorée.`);
      continue;
    }

    const expiration = new Date(offre.date_expiration!);
    const joursRestants = Math.ceil((expiration.getTime() - maintenant) / 86_400_000);

    const appUrl = urlApplication();

    try {
      await envoyer('principal', {
        a: destinataire,
        sujet: sujetRelanceClient({ reference: offre.numero, joursRestants }),
        html: buildRelanceClientHtml({
          titreOffre: offre.titre ?? offre.numero,
          reference: offre.numero,
          lienPublic: `${appUrl}/offre/${offre.token_public}`,
          joursRestants,
          dateExpiration: expiration.toLocaleDateString('fr-FR'),
          jamaisConsultee,
        }),
      });
    } catch (e) {
      // L'audit n'est pas écrit : la relance sera retentée au prochain cycle,
      // tant que l'offre n'a pas expiré.
      console.error(
        `[relance-client] envoi impossible pour ${offre.numero} : ${e instanceof Error ? e.message : e}`,
      );

      await db.from('notifications').insert({
        tenant_id: tenant,
        role_cible: 'presale',
        type: 'relance_echouee',
        severite: 'avertissement',
        titre: `Relance client impossible — ${offre.numero}`,
        message: `L'offre expire le ${expiration.toLocaleDateString('fr-FR')} et la relance n'a pas pu partir. Reprenez contact directement.`,
        lien: `/offres/${offre.id}/preview`,
        offre_id: offre.id,
        demande_id: offre.demande_id,
      });

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
        jours_restants: joursRestants,
        destinataire,
        jamais_consultee: jamaisConsultee,
      },
    });

    // L'interne doit savoir qu'un message est parti en son nom, sinon un
    // rappel téléphonique ferait doublon le même jour.
    await db.from('notifications').insert(
      (['presale', 'admin'] as const).map((role) => ({
        tenant_id: tenant,
        role_cible: role,
        type: 'relance',
        severite: 'info',
        titre: `Client relancé — ${offre.numero}`,
        message: `Offre à échéance dans ${joursRestants} jour(s) : relance envoyée à ${destinataire}.`,
        lien: `/offres/${offre.id}/preview`,
        offre_id: offre.id,
        demande_id: offre.demande_id,
      })),
    );

    envois += 1;
    console.info(
      `[relance-client] ${offre.numero} relancée (${joursRestants} jour(s) avant échéance).`,
    );
  }

  return envois;
}

/** Adresse saisie sur la demande, sinon celle du client rattaché. */
async function adresseClient(
  db: ClientAdmin,
  tenant: string,
  demandeId: number | null,
): Promise<string | null> {
  if (demandeId === null) return null;

  const { data } = await db
    .from('demandes')
    .select('email_client, clients(email_principal)')
    .eq('id', demandeId)
    .eq('tenant_id', tenant)
    .maybeSingle();

  if (!data) return null;

  const client = Array.isArray(data.clients) ? data.clients[0] : data.clients;
  return data.email_client ?? client?.email_principal ?? null;
}
