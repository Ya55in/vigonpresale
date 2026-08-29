import { clientAdmin, tenantId, type ClientAdmin } from '@vigon/services';

/**
 * Statuts d'offre encore en attente d'une décision client.
 *
 * `validee` en fait partie : le lien a pu être transmis à la main quand l'envoi
 * automatique a échoué, et l'offre expire alors comme les autres.
 */
const STATUTS_EN_ATTENTE = ['validee', 'envoyee', 'consultee'] as const;

async function notifierPresale(
  db: ClientAdmin,
  tenant: string,
  params: { offreId: number; demandeId: number | null; numero: string; consultee: boolean },
): Promise<void> {
  const { error } = await db.from('notifications').insert({
    tenant_id: tenant,
    role_cible: 'presale',
    type: 'offre_expiree',
    severite: 'avertissement',
    titre: `Offre expirée — ${params.numero}`,
    message: params.consultee
      ? "Le client a consulté l'offre mais n'a pas décidé avant l'échéance."
      : "L'offre n'a jamais été consultée avant son échéance.",
    lien: `/offres/${params.offreId}/preview`,
    offre_id: params.offreId,
    demande_id: params.demandeId,
  });

  if (error) console.error(`[expiration] notification impossible : ${error.message}`);
}

/**
 * Clôt les offres dont la date d'expiration est dépassée (flux étape 12).
 *
 * Le motif de perte distingue les deux cas : offre jamais ouverte — ce qui
 * interroge la délivrabilité du courriel — et offre consultée sans décision,
 * qui relève d'une relance commerciale. Les confondre priverait PRESALE de
 * l'information la plus utile.
 */
export async function expireOffres(): Promise<number> {
  const db = clientAdmin();
  const tenant = await tenantId();

  const { data: echues, error } = await db
    .from('offres')
    .select('id, demande_id, numero, statut, date_expiration, date_consultation')
    .eq('tenant_id', tenant)
    .in('statut', STATUTS_EN_ATTENTE)
    .not('date_expiration', 'is', null)
    .lt('date_expiration', new Date().toISOString());

  if (error) throw new Error(`Lecture des offres échues : ${error.message}`);
  if (!echues || echues.length === 0) return 0;

  let closes = 0;

  for (const offre of echues) {
    const consultee = offre.date_consultation !== null;

    // Verrou optimiste : si le client approuve entre la lecture et l'écriture,
    // sa décision l'emporte et l'offre n'est pas expirée.
    const { data: expiree } = await db
      .from('offres')
      .update({ statut: 'expiree' })
      .eq('id', offre.id)
      .in('statut', STATUTS_EN_ATTENTE)
      .select('id');

    if (!expiree || expiree.length === 0) continue;

    const motif = consultee
      ? 'Offre consultée mais sans décision avant expiration'
      : 'Offre non consultée';

    if (offre.demande_id) {
      await db
        .from('demandes')
        .update({
          statut: 'perdue',
          motif_perte: motif,
          date_decision: new Date().toISOString(),
        })
        .eq('id', offre.demande_id)
        .eq('tenant_id', tenant);

      const { data: demande } = await db
        .from('demandes')
        .select('opportunite_id')
        .eq('id', offre.demande_id)
        .maybeSingle();

      if (demande?.opportunite_id) {
        await db
          .from('opportunites')
          .update({ statut: 'perdue' })
          .eq('id', demande.opportunite_id)
          .eq('tenant_id', tenant);
      }
    }

    await notifierPresale(db, tenant, {
      offreId: offre.id,
      demandeId: offre.demande_id,
      numero: offre.numero,
      consultee,
    });

    await db.from('audit_events').insert({
      tenant_id: tenant,
      entite: 'offres',
      entite_id: offre.id,
      action: 'offre.expiree',
      acteur_type: 'worker',
      details: {
        numero: offre.numero,
        motif,
        consultee,
        date_expiration: offre.date_expiration,
      },
    });

    closes += 1;
    console.info(`[expiration] ${offre.numero} expirée — ${motif}`);
  }

  return closes;
}
