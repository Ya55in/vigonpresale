import type { ProfilUtilisateur } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Indicateurs du tableau de bord, calculés selon le périmètre du rôle.
 *
 * Les indicateurs financiers ne sont JAMAIS calculés pour AFTER_SALES : la
 * spec lui interdit les prix d'achat et les marges, et ne pas les produire est
 * plus sûr que les produire puis les masquer à l'affichage.
 */

export type Kpi = {
  libelle: string;
  valeur: string;
  detail?: string;
  lien?: string;
  /** Met l'indicateur en évidence quand il demande une action. */
  alerte?: boolean;
};

const montant = (valeur: number, devise = 'MAD'): string =>
  `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${devise}`;

/** Statuts d'une demande encore en cours de traitement. */
const EN_COURS = [
  'nouvelle',
  'specs_extraites',
  'fournisseurs_identifies',
  'en_validation_rfq',
  'planifiee',
  'envoyee_fournisseurs',
  'devis_partiels',
  'devis_recus',
  'en_costing',
  'marge_validee',
  'offre_generee',
  'en_validation_offre',
  'offre_envoyee',
  'offre_consultee',
] as const;

export async function kpiPourRole(utilisateur: ProfilUtilisateur): Promise<Kpi[]> {
  const db = createAdminClient();
  const tenant = utilisateur.tenant_id;
  const role = utilisateur.role;

  // --- AFTER_SALES : uniquement les deals gagnés, sans aucun montant d'achat ---
  if (role === 'after_sales') {
    const { count: gagnees } = await db
      .from('demandes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant)
      .eq('statut', 'gagnee');

    const { count: approuvees } = await db
      .from('offres')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant)
      .eq('statut', 'approuvee');

    return [
      {
        libelle: 'Deals gagnés',
        valeur: String(gagnees ?? 0),
        detail: 'Dossiers à suivre en après-vente',
        lien: '/demandes',
      },
      {
        libelle: 'Offres approuvées',
        valeur: String(approuvees ?? 0),
        detail: 'Historique complet',
        lien: '/offres',
      },
    ];
  }

  const kpi: Kpi[] = [];

  // --- Commun PRESALE / FINANCE / ADMIN ---
  const [
    { count: enCours },
    { count: aTraiter },
    { count: bloquees },
    { count: gagnees },
    { count: perdues },
  ] = await Promise.all([
    db
      .from('demandes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant)
      .in('statut', EN_COURS),
    db
      .from('demandes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant)
      .in('statut', ['nouvelle', 'specs_extraites']),
    db
      .from('demandes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant)
      .eq('statut', 'bloquee'),
    db
      .from('demandes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant)
      .eq('statut', 'gagnee'),
    db
      .from('demandes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant)
      .eq('statut', 'perdue'),
  ]);

  kpi.push({
    libelle: 'Demandes en cours',
    valeur: String(enCours ?? 0),
    detail: 'Du besoin reçu à l’offre consultée',
    lien: '/demandes',
  });

  if (role === 'presale' || role === 'admin') {
    kpi.push({
      libelle: 'À traiter',
      valeur: String(aTraiter ?? 0),
      detail: 'Articles à relire et valider',
      lien: '/demandes?statut=specs_extraites',
      alerte: (aTraiter ?? 0) > 0,
    });

    const { count: sansReponse } = await db
      .from('consultations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant)
      .eq('statut', 'sans_reponse');

    kpi.push({
      libelle: 'Fournisseurs sans réponse',
      valeur: String(sansReponse ?? 0),
      detail: 'Relances épuisées, action manuelle',
      alerte: (sansReponse ?? 0) > 0,
    });
  }

  if (bloquees && bloquees > 0) {
    kpi.push({
      libelle: 'Demandes bloquées',
      valeur: String(bloquees),
      detail: 'Contenu inexploitable à compléter',
      lien: '/demandes?statut=bloquee',
      alerte: true,
    });
  }

  // --- FINANCE et ADMIN : validations et indicateurs financiers ---
  if (role === 'finance' || role === 'admin') {
    const { count: aValider } = await db
      .from('cost_sheets')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant)
      .eq('statut', 'soumis');

    kpi.push({
      libelle: 'Costings à valider',
      valeur: String(aValider ?? 0),
      detail: 'Escaladés hors seuils',
      lien: '/finance',
      alerte: (aValider ?? 0) > 0,
    });

    // Chiffre d'affaires signé : uniquement les offres approuvées.
    const { data: signees } = await db
      .from('offres')
      .select('cost_sheet_id')
      .eq('tenant_id', tenant)
      .eq('statut', 'approuvee');

    const idsFeuilles = (signees ?? [])
      .map((o) => o.cost_sheet_id)
      .filter((v): v is number => v !== null);

    let caSigne = 0;
    let margeSignee = 0;

    if (idsFeuilles.length > 0) {
      const { data: feuilles } = await db
        .from('cost_sheets')
        .select('total_ttc, marge_valeur')
        .in('id', idsFeuilles);

      for (const f of feuilles ?? []) {
        caSigne += Number(f.total_ttc ?? 0);
        margeSignee += Number(f.marge_valeur ?? 0);
      }
    }

    kpi.push({
      libelle: 'CA signé TTC',
      valeur: montant(caSigne),
      detail: `${gagnees ?? 0} deal(s) gagné(s)`,
      lien: '/finance/rapports',
    });

    kpi.push({
      libelle: 'Marge signée',
      valeur: montant(margeSignee),
      detail:
        caSigne > 0
          ? `${((margeSignee / caSigne) * 100).toFixed(1)} % du CA TTC`
          : 'Aucun deal signé',
      lien: '/finance/rapports',
    });
  }

  // --- Taux de réussite, commun à tous sauf après-vente ---
  const decides = (gagnees ?? 0) + (perdues ?? 0);
  kpi.push({
    libelle: 'Taux de réussite',
    valeur: decides > 0 ? `${Math.round(((gagnees ?? 0) / decides) * 100)} %` : '—',
    detail: `${gagnees ?? 0} gagnée(s), ${perdues ?? 0} perdue(s)`,
  });

  return kpi;
}
