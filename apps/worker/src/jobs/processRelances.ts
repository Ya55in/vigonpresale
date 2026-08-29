import { LANGUE_DEFAUT } from '@vigon/shared';
import {
  buildRelanceHtml,
  clientAdmin,
  envoiConfigure,
  envoyer,
  lireLanguesFournisseurs,
  lireParametres,
  tenantId,
  type ClientAdmin,
} from '@vigon/services';

/**
 * Statuts encore dans le périmètre de relance.
 *
 * `precision_demandee` en fait partie : le fournisseur a répondu sans prix, la
 * relance reste donc pertinente. `devis_recu` en sort — le retrait du label
 * Gmail (flux étape 7) est ce qui interrompt les rappels.
 */
const STATUTS_RELANCABLES = ['envoyee', 'relancee', 'precision_demandee'] as const;

/** Borne par cycle : évite une rafale si beaucoup d'échéances tombent ensemble. */
const LOT_MAX = 20;

async function notifierPresale(
  db: ClientAdmin,
  tenant: string,
  demandeId: number | null,
  params: { type: string; titre: string; message: string },
): Promise<void> {
  const { error } = await db.from('notifications').insert({
    tenant_id: tenant,
    role_cible: 'presale',
    type: params.type,
    severite: 'avertissement',
    titre: params.titre,
    message: params.message,
    lien: demandeId ? `/demandes/${demandeId}/consultations` : null,
    demande_id: demandeId,
  });
  if (error) console.error(`[relances] notification impossible : ${error.message}`);
}

/**
 * Envoie les relances dues et clôt celles qui ont épuisé leurs rappels.
 *
 * La relance part EN RÉPONSE dans le fil d'origine (threadId + inReplyTo) :
 * le fournisseur retrouve le contexte, et la réponse reviendra dans le même
 * fil, ce dont dépend l'appariement au flux étape 7.
 */
export async function processRelances(): Promise<number> {
  const db = clientAdmin();
  const tenant = await tenantId();
  const parametres = await lireParametres(tenant);

  const { data: dues, error } = await db
    .from('consultations')
    .select(
      'id, demande_id, fournisseur_id, fournisseur_email, fournisseur_nom, marque, sujet, thread_id, message_id, relances, max_relances, statut',
    )
    .eq('tenant_id', tenant)
    .in('statut', STATUTS_RELANCABLES)
    .not('prochaine_relance', 'is', null)
    .lte('prochaine_relance', new Date().toISOString())
    .order('prochaine_relance', { ascending: true })
    .limit(LOT_MAX);

  if (error) throw new Error(`Lecture des relances dues : ${error.message}`);
  if (!dues || dues.length === 0) return 0;

  // Une seule lecture pour tout le lot : la relance part dans la langue du
  // fournisseur, comme la demande d'origine.
  const langues = await lireLanguesFournisseurs(
    tenant,
    dues.map((c) => c.fournisseur_id).filter((id): id is number => id !== null),
  );

  let traitees = 0;

  for (const consultation of dues) {
    // Le plafond par consultation prime sur le paramètre du tenant : il permet
    // d'insister davantage sur un fournisseur clé sans changer la règle globale.
    const plafond = consultation.max_relances ?? parametres.maxRelances;
    const dejaFaites = consultation.relances ?? 0;

    // --- Plafond atteint : on sort la consultation du périmètre ---
    if (dejaFaites >= plafond) {
      const { data: cloture } = await db
        .from('consultations')
        .update({ statut: 'sans_reponse', prochaine_relance: null })
        .eq('id', consultation.id)
        .in('statut', STATUTS_RELANCABLES)
        .select('id');

      if (!cloture || cloture.length === 0) continue;

      await notifierPresale(db, tenant, consultation.demande_id, {
        type: 'consultation_sans_reponse',
        titre: `Sans réponse — ${consultation.marque ?? ''}`,
        message: `${consultation.fournisseur_nom ?? consultation.fournisseur_email} n'a pas répondu après ${dejaFaites} relance(s). Action manuelle nécessaire.`,
      });

      await db.from('audit_events').insert({
        tenant_id: tenant,
        entite: 'consultations',
        entite_id: consultation.id,
        action: 'consultation.sans_reponse',
        acteur_type: 'worker',
        details: { marque: consultation.marque, relances: dejaFaites },
      });

      console.info(
        `[relances] ${consultation.marque} sans réponse après ${dejaFaites} relance(s).`,
      );
      traitees += 1;
      continue;
    }

    // --- Relance à envoyer ---
    if (!envoiConfigure('fournisseur')) {
      console.error(
        '[relances] aucun transport d’envoi configuré : relance différée, échéance conservée.',
      );
      continue;
    }

    if (!consultation.fournisseur_email || !consultation.thread_id) {
      // Sans fil d'origine on ne peut pas répondre dedans ; relancer hors fil
      // casserait l'appariement des réponses.
      await db
        .from('consultations')
        .update({ statut: 'sans_reponse', prochaine_relance: null })
        .eq('id', consultation.id);

      await notifierPresale(db, tenant, consultation.demande_id, {
        type: 'relance_impossible',
        titre: `Relance impossible — ${consultation.marque ?? ''}`,
        message: 'Fil de discussion d’origine introuvable : à relancer manuellement.',
      });
      continue;
    }

    const numero = dejaFaites + 1;
    const prochaine = new Date(Date.now() + parametres.delaiRelanceHeures * 3_600_000);

    // Verrou optimiste sur le compteur : deux cycles concurrents ne peuvent pas
    // envoyer la même relance, car seul le premier voit encore `dejaFaites`.
    const { data: verrou } = await db
      .from('consultations')
      .update({
        relances: numero,
        statut: 'relancee',
        derniere_relance: new Date().toISOString(),
        prochaine_relance: prochaine.toISOString(),
      })
      .eq('id', consultation.id)
      .eq('relances', dejaFaites)
      .select('id');

    if (!verrou || verrou.length === 0) continue;

    try {
      const message = await envoyer('fournisseur', {
        a: consultation.fournisseur_email,
        sujet: `Relance : ${consultation.sujet ?? 'demande de devis'}`,
        html: buildRelanceHtml({
          numero,
          sujetOrigine: consultation.sujet ?? 'notre demande de devis',
          langue:
            (consultation.fournisseur_id === null
              ? undefined
              : langues.get(consultation.fournisseur_id)) ?? LANGUE_DEFAUT,
        }),
        threadId: consultation.thread_id,
        inReplyTo: consultation.message_id ?? undefined,
        references: consultation.message_id ?? undefined,
      });

      await db.from('communications').insert({
        tenant_id: tenant,
        demande_id: consultation.demande_id,
        consultation_id: consultation.id,
        direction: 'sortant',
        type: 'relance',
        thread_id: message.threadId,
        message_id: message.messageId,
        in_reply_to: consultation.message_id,
        destinataires: [consultation.fournisseur_email],
        sujet: `Relance : ${consultation.sujet ?? ''}`,
      });

      await db.from('audit_events').insert({
        tenant_id: tenant,
        entite: 'consultations',
        entite_id: consultation.id,
        action: 'consultation.relancee',
        acteur_type: 'worker',
        details: {
          marque: consultation.marque,
          numero,
          prochaine_relance: prochaine.toISOString(),
        },
      });

      traitees += 1;
      console.info(
        `[relances] relance ${numero}/${plafond} — ${consultation.marque} -> ${consultation.fournisseur_email}`,
      );
    } catch (e) {
      const motif = e instanceof Error ? e.message : String(e);

      // Le compteur est déjà incrémenté : on ne revient pas dessus, sinon un
      // échec répété relancerait en boucle. On réessaiera à l'échéance suivante.
      console.error(`[relances] échec sur ${consultation.id} : ${motif}`);

      await notifierPresale(db, tenant, consultation.demande_id, {
        type: 'relance_echouee',
        titre: `Relance échouée — ${consultation.marque ?? ''}`,
        message: `${consultation.fournisseur_email} : ${motif}`,
      });
    }
  }

  return traitees;
}
