import { clientAdmin, tenantId } from '@vigon/services';

import { extraireSpecifications } from '../services/extractionSpecs.js';

/**
 * Reprend les demandes restées sans extraction.
 *
 * POURQUOI CE JOB EXISTE
 *
 * `extractionSpecs` annonçait déjà, sur quota épuisé : « La demande sera reprise
 * automatiquement. » C'était faux. La seule reprise écrite vivait dans
 * `pollClientMailbox`, sur le chemin d'un message re-relevé — or le message est
 * marqué lu dès que `traiterMessage` rend la main, y compris après un report
 * pour quota. Il n'était donc jamais relu, et la demande restait `nouvelle`
 * indéfiniment, sans que rien ne le signale.
 *
 * Ce job est aussi ce qui rend `bloquee` réversible. L'écran de la demande se
 * contente de la remettre en `nouvelle` : l'extraction reste ici, dans le
 * worker, qui porte déjà la garde anti-chevauchement et le budget d'appels au
 * modèle. Une extraction lancée depuis l'application pendant qu'un cycle du
 * worker traite la même demande insérerait les articles en double.
 *
 * @see apps/web/app/(dashboard)/demandes/[id]/actions.ts — `relancerExtraction`
 */

/**
 * Âge minimal avant reprise.
 *
 * `traiterMessage` crée la demande en `nouvelle`, pose `contenu_consolide`, puis
 * appelle l'extraction — qui dure. Sans ce délai, un cycle de reprise tombant
 * dans cette fenêtre lancerait une SECONDE extraction sur la même demande, et
 * les deux insertions d'articles réussiraient.
 *
 * Dix minutes : très au-delà d'une extraction, très en deçà de l'attente qu'un
 * humain juge anormale.
 */
const AGE_MIN_MINUTES = 10;

/**
 * Petit lot : chaque reprise est un appel au modèle. Un arriéré se résorbe en
 * quelques cycles plutôt que d'épuiser le quota en une fois — c'est justement
 * un quota épuisé qui remplit cette file.
 */
const LOT_MAX = 3;

/** Trace laissée par `relancerExtraction` côté application. */
const ACTION_DEBLOCAGE = 'demande.debloquee';

/**
 * Demandes remises en `nouvelle` par un humain, donc reprenables SANS DÉLAI.
 *
 * Le délai ci-dessus protège d'une extraction encore en vol, née de la
 * réception. Un déblocage n'a rien en vol : la demande était `bloquee`, état
 * terminal, et aucune extraction ne tourne. Lui appliquer la temporisation
 * ferait attendre dix minutes devant un bouton qui vient d'annoncer « relancé »,
 * ce qui se lit comme une panne.
 *
 * L'événement d'audit sert de marqueur : il existe déjà, il est écrit dans la
 * même opération que la remise en `nouvelle`, et il évite d'ajouter une colonne
 * pour porter une information que la table d'audit détient.
 */
async function deblocagesRecents(
  db: ReturnType<typeof clientAdmin>,
  tenant: string,
): Promise<Set<number>> {
  const { data } = await db
    .from('audit_events')
    .select('entite_id')
    .eq('tenant_id', tenant)
    .eq('entite', 'demandes')
    .eq('action', ACTION_DEBLOCAGE)
    // Fenêtre large : un déblocage suivi d'un quota épuisé doit rester
    // reprenable aux cycles suivants, pas seulement au premier.
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString());

  return new Set((data ?? []).map((e) => e.entite_id).filter((v): v is number => v !== null));
}

export async function reprendreExtractions(): Promise<number> {
  const db = clientAdmin();
  const tenant = await tenantId();

  const seuil = new Date(Date.now() - AGE_MIN_MINUTES * 60_000).toISOString();

  // Borne large, mais borne : le filtre se fait en mémoire (deux règles
  // d'éligibilité, dont l'une vient de l'audit), et une requête sans limite
  // ramènerait tout le `contenu_consolide` d'un arriéré à chaque cycle — soit
  // toutes les deux minutes, indéfiniment.
  //
  // Trente suffit largement devant LOT_MAX : au-delà, l'arriéré se résorbe de
  // toute façon lot par lot, cycle après cycle.
  const { data: toutes, error } = await db
    .from('demandes')
    .select('id, code, contenu_consolide, updated_at')
    .eq('tenant_id', tenant)
    .eq('statut', 'nouvelle')
    .not('contenu_consolide', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(30);

  if (error) throw new Error(`Lecture des demandes à reprendre : ${error.message}`);
  if (!toutes || toutes.length === 0) return 0;

  const debloquees = await deblocagesRecents(db, tenant);

  const candidates = toutes
    .filter((d) => debloquees.has(d.id) || d.updated_at < seuil)
    .slice(0, LOT_MAX);

  if (candidates.length === 0) return 0;

  let reprises = 0;

  for (const demande of candidates) {
    // Deuxième garde, indépendante du délai : des articles déjà présents
    // signent une extraction aboutie dont seul le statut n'a pas suivi. Les
    // réinsérer produirait un doublon silencieux, invisible jusqu'au chiffrage.
    const { count } = await db
      .from('demande_items')
      .select('id', { count: 'exact', head: true })
      .eq('demande_id', demande.id);

    if ((count ?? 0) > 0) {
      console.warn(
        `[reprise] ${demande.code} porte déjà ${count} article(s) : extraction non rejouée.`,
      );
      continue;
    }

    console.info(`[reprise] extraction de ${demande.code}`);

    await extraireSpecifications({
      demandeId: demande.id,
      tenant,
      code: demande.code,
      contenu: demande.contenu_consolide!,
      // Les pièces jointes illisibles ont été signalées à la réception ; les
      // répéter ici ferait une seconde alerte pour un fait déjà connu.
      piecesIllisibles: [],
    });

    reprises += 1;
  }

  return reprises;
}
