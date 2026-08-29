import { headers } from 'next/headers';

import type { BoqAffiche } from '@/components/offres/RenduOffre';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Lecture d'une offre par son jeton public, pour la page sans authentification.
 *
 * Règle absolue n°7 : la page publique ne reçoit qu'une allowlist explicite de
 * champs, jamais la ligne complète. Le filtrage se fait ICI, avant tout rendu —
 * masquer après coup laisserait les données dans le flux envoyé au navigateur.
 */

export type OffrePublique = {
  /** Identifiant interne, jamais rendu : il sert aux actions serveur. */
  id: number;
  reference: string;
  statut: string;
  boq: BoqAffiche;
  /** Vrai quand le client a déjà approuvé : les boutons disparaissent. */
  decidee: boolean;
  expiree: boolean;
  dateExpiration: string | null;
  motifRefus: string | null;
};

/**
 * Statuts pour lesquels la page publique est légitimement consultable.
 *
 * `validee` en fait partie : un humain a validé l'offre et voulu l'envoyer. Si
 * le courriel échoue, PRESALE transmet le lien autrement — l'exclure rendrait
 * ce lien inutilisable. En amont de `validee`, l'offre est encore interne et le
 * jeton ne doit rien ouvrir.
 */
const STATUTS_PUBLICS = [
  'validee',
  'envoyee',
  'consultee',
  'approuvee',
  'refusee',
  'expiree',
];

/**
 * Le lien public s'ouvre-t-il déjà pour ce statut ?
 *
 * Exporté pour que l'écran de relecture cesse de proposer « Lien client » sur
 * une offre encore en `generee` : le bouton copiait une adresse que cette même
 * liste fait répondre 404, et le 404 est muet par construction — il ne
 * distingue pas un jeton inconnu d'une offre pas encore validée, pour ne rien
 * révéler à un inconnu. Résultat côté équipe : un lien « cassé » sans cause
 * visible.
 *
 * La liste reste UNIQUE et lue des deux côtés. Deux copies dériveraient, et
 * l'écran se remettrait à distribuer des liens morts.
 */
export function estStatutPublic(statut: string | null): boolean {
  return STATUTS_PUBLICS.includes(statut ?? '');
}

export async function lireOffrePublique(token: string): Promise<OffrePublique | null> {
  // Un jeton court ou vide ne peut pas être valide : on évite la requête.
  if (!token || token.length < 20) return null;

  const { data, error } = await createAdminClient()
    .from('offres')
    .select('id, numero, statut, source_json, date_expiration, motif_refus')
    .eq('token_public', token)
    .maybeSingle();

  // Sans ce log, un jeton valide rejeté pour une raison technique donne le même
  // 404 qu'un jeton inconnu — indiagnosticable en production.
  if (error) {
    console.error('[offre publique] lecture impossible', {
      message: error.message,
      details: error.details,
    });
    return null;
  }

  if (!data) {
    console.info('[offre publique] jeton inconnu');
    return null;
  }
  if (!data.source_json) {
    console.error(`[offre publique] offre #${data.id} sans source_json`);
    return null;
  }

  // Une offre encore en interne ne doit pas fuiter par un jeton deviné ou
  // partagé trop tôt : le lien ne s'ouvre qu'à partir de la validation.
  if (!estStatutPublic(data.statut)) {
    console.info(
      `[offre publique] offre #${data.id} refusée : statut « ${data.statut} » non public`,
    );
    return null;
  }

  const expiree =
    data.statut === 'expiree' ||
    (data.date_expiration !== null && new Date(data.date_expiration) < new Date());

  const brut = data.source_json as Record<string, unknown>;

  // Reconstruction champ par champ : ce qui n'est pas listé ici ne peut pas
  // atteindre le navigateur, même si le BoQ stocké gagne des clés plus tard.
  const solution = (brut.solution ?? {}) as Record<string, unknown>;
  const totaux = (brut.totaux ?? {}) as Record<string, unknown>;
  const conditions = (brut.conditions ?? {}) as Record<string, unknown>;
  const client = (brut.client ?? {}) as Record<string, unknown>;

  const boq: BoqAffiche = {
    client: {
      nom: String(client.nom ?? 'Client'),
      contact: client.contact ? String(client.contact) : null,
    },
    referenceOffre: String(brut.referenceOffre ?? data.numero),
    date: String(brut.date ?? ''),
    validite: String(brut.validite ?? ''),
    solution: {
      titre: String(solution.titre ?? ''),
      resume: String(solution.resume ?? ''),
      tableauExplicatif: Array.isArray(solution.tableauExplicatif)
        ? solution.tableauExplicatif.map((l) => {
            const ligne = (l ?? {}) as Record<string, unknown>;
            return {
              besoin: String(ligne.besoin ?? ''),
              solutionProposee: String(ligne.solutionProposee ?? ''),
              benefice: String(ligne.benefice ?? ''),
            };
          })
        : [],
    },
    produits: Array.isArray(brut.produits)
      ? brut.produits.map((p) => {
          const produit = (p ?? {}) as Record<string, unknown>;
          return {
            designation: String(produit.designation ?? ''),
            reference: produit.reference ? String(produit.reference) : null,
            marque: String(produit.marque ?? ''),
            imageUrl: produit.imageUrl ? String(produit.imageUrl) : null,
            descriptionTechnique: produit.descriptionTechnique
              ? String(produit.descriptionTechnique)
              : null,
            pointsCles: Array.isArray(produit.pointsCles)
              ? produit.pointsCles.map(String)
              : [],
            quantite: Number(produit.quantite ?? 1),
            prixUnitaireHt: Number(produit.prixUnitaireHt ?? 0),
            totalHt: Number(produit.totalHt ?? 0),
          };
        })
      : [],
    totaux: {
      totalHt: Number(totaux.totalHt ?? 0),
      tvaPct: Number(totaux.tvaPct ?? 20),
      totalTva: Number(totaux.totalTva ?? 0),
      totalTtc: Number(totaux.totalTtc ?? 0),
      devise: String(totaux.devise ?? 'MAD'),
    },
    conditions: {
      livraison: String(conditions.livraison ?? ''),
      paiement: String(conditions.paiement ?? ''),
      garantie: String(conditions.garantie ?? ''),
    },
  };

  await raccourcirVisuels(boq.produits);

  return {
    id: data.id,
    reference: data.numero,
    statut: data.statut ?? 'envoyee',
    boq,
    decidee: data.statut === 'approuvee' || data.statut === 'refusee',
    expiree,
    dateExpiration: data.date_expiration,
    motifRefus: data.motif_refus,
  };
}

/** Le bucket des visuels, seul autorisé à être re-signé depuis cette page. */
const BUCKET_OFFRES = 'offres';

/** Une heure : le temps d'afficher la page, pas celui de la faire circuler. */
const VALIDITE_VISUEL_SECONDES = 60 * 60;

/**
 * Remplace les URL signées figées par des URL courtes, à l'affichage.
 *
 * Les visuels produits sont signés pour UN AN à la génération de l'offre, et
 * l'URL est gelée dans `source_json` — elle doit survivre à toute la vie de
 * l'offre, et la raccourcir à la source casserait les offres déjà émises.
 *
 * Mais une URL signée est un jeton porteur. Servie telle quelle au navigateur
 * du client, elle part avec chaque transfert de courriel, chaque historique de
 * navigation, chaque journal de proxy — et ouvre le fichier pendant douze mois.
 *
 * On re-signe donc ici, sur la seule surface exposée à l'extérieur. Le chemin
 * de l'objet se lit dans l'URL figée elle-même, ce qui évite d'avoir à migrer
 * les `source_json` existants.
 *
 * Échec silencieux et repli sur l'URL d'origine : un visuel manquant vaut mieux
 * qu'une offre qui ne s'affiche pas, et l'URL figée reste valide.
 */
async function raccourcirVisuels(produits: { imageUrl: string | null }[]): Promise<void> {
  const chemins = new Map<string, string>();

  for (const produit of produits) {
    if (!produit.imageUrl) continue;

    try {
      const { pathname } = new URL(produit.imageUrl);
      const marqueur = `/storage/v1/object/sign/${BUCKET_OFFRES}/`;
      const debut = pathname.indexOf(marqueur);
      // Une URL qui ne vise pas ce bucket n'est pas des nôtres : on n'y touche
      // pas plutôt que de deviner.
      if (debut === -1) continue;

      chemins.set(produit.imageUrl, decodeURIComponent(pathname.slice(debut + marqueur.length)));
    } catch {
      // URL illisible : on la laisse telle quelle.
    }
  }

  if (chemins.size === 0) return;

  const { data, error } = await createAdminClient()
    .storage.from(BUCKET_OFFRES)
    .createSignedUrls([...chemins.values()], VALIDITE_VISUEL_SECONDES);

  if (error || !data) {
    console.error('[offre publique] re-signature des visuels impossible', error?.message);
    return;
  }

  const fraiches = new Map(data.map((r) => [r.path, r.signedUrl]));

  for (const produit of produits) {
    const chemin = produit.imageUrl ? chemins.get(produit.imageUrl) : null;
    const fraiche = chemin ? fraiches.get(chemin) : null;
    if (fraiche) produit.imageUrl = fraiche;
  }
}

/**
 * Enregistre la consultation et notifie PRESALE à la première ouverture.
 *
 * L'IP vient des en-têtes de proxy : elle sert uniquement de trace de
 * consultation, jamais d'identification. Une consultation non enregistrée ne
 * doit pas empêcher l'affichage de l'offre.
 */
export async function tracerConsultation(offreId: number): Promise<void> {
  try {
    const db = createAdminClient();
    const entetes = await headers();

    const ip =
      entetes.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      entetes.get('x-real-ip') ??
      null;

    const { data: offre } = await db
      .from('offres')
      .select('id, tenant_id, demande_id, numero, statut, nb_consultations')
      .eq('id', offreId)
      .single();

    if (!offre) return;

    await db.from('offre_consultations').insert({
      offre_id: offreId,
      ip,
      user_agent: entetes.get('user-agent'),
      referer: entetes.get('referer'),
    });

    // Première ouverture : depuis `envoyee` comme depuis `validee`, ce dernier
    // cas correspondant à un lien transmis à la main.
    const premiere = offre.statut === 'envoyee' || offre.statut === 'validee';

    await db
      .from('offres')
      .update({
        // Le passage à « consultee » n'écrase pas une décision déjà prise.
        ...(premiere
          ? { statut: 'consultee', date_consultation: new Date().toISOString() }
          : {}),
        nb_consultations: (offre.nb_consultations ?? 0) + 1,
        derniere_consultation: new Date().toISOString(),
      })
      .eq('id', offreId);

    if (!premiere) return;

    await db
      .from('demandes')
      .update({ statut: 'offre_consultee', date_consultation: new Date().toISOString() })
      .eq('id', offre.demande_id!)
      .eq('tenant_id', offre.tenant_id);

    // ADMIN comme PRESALE : c'est ADMIN qui reçoit le rappel de non-consultation,
    // il doit voir l'ouverture qui rend ce rappel sans objet.
    await db.from('notifications').insert(
      (['presale', 'admin'] as const).map((role) => ({
        tenant_id: offre.tenant_id,
        role_cible: role,
        type: 'offre_consultee',
        severite: 'info',
        titre: `Le client a consulté l'offre ${offre.numero}`,
        message: "L'offre vient d'être ouverte pour la première fois.",
        lien: `/offres/${offreId}/preview`,
        offre_id: offreId,
        demande_id: offre.demande_id,
      })),
    );

    await db.from('audit_events').insert({
      tenant_id: offre.tenant_id,
      entite: 'offres',
      entite_id: offreId,
      action: 'offre.consultee',
      acteur_type: 'client',
      ip,
      user_agent: entetes.get('user-agent'),
      details: { numero: offre.numero },
    });
  } catch (e) {
    console.error('[offre publique] traçage impossible', e);
  }
}
