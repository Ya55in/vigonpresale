import type { Enums } from '@/lib/supabase/types';

export type StatutDemande = Enums<'statut_demande'>;

type Apparence = 'default' | 'secondary' | 'succes' | 'attention' | 'info' | 'neutre';

/**
 * Libellé et teinte de chaque statut du flux.
 *
 * L'ordre de déclaration suit la progression métier : il sert aussi à ordonner
 * le filtre de la liste, pour que le menu se lise comme le cycle de vente.
 */
export const STATUTS: Record<
  StatutDemande,
  { libelle: string; apparence: Apparence }
> = {
  nouvelle: { libelle: 'Nouvelle', apparence: 'info' },
  specs_extraites: { libelle: 'Specs extraites', apparence: 'info' },
  fournisseurs_identifies: { libelle: 'Fournisseurs identifiés', apparence: 'info' },
  en_validation_rfq: { libelle: 'Validation RFQ', apparence: 'attention' },
  planifiee: { libelle: 'Envoi planifié', apparence: 'attention' },
  envoyee_fournisseurs: { libelle: 'Envoyée fournisseurs', apparence: 'neutre' },
  devis_partiels: { libelle: 'Devis partiels', apparence: 'neutre' },
  devis_recus: { libelle: 'Devis reçus', apparence: 'info' },
  en_costing: { libelle: 'En costing', apparence: 'attention' },
  marge_validee: { libelle: 'Marge validée', apparence: 'info' },
  offre_generee: { libelle: 'Offre générée', apparence: 'info' },
  en_validation_offre: { libelle: 'Validation offre', apparence: 'attention' },
  offre_envoyee: { libelle: 'Offre envoyée', apparence: 'neutre' },
  offre_consultee: { libelle: 'Offre consultée', apparence: 'info' },
  gagnee: { libelle: 'Gagnée', apparence: 'succes' },
  perdue: { libelle: 'Perdue', apparence: 'secondary' },
  bloquee: { libelle: 'Bloquée', apparence: 'attention' },
};

export const ORDRE_STATUTS = Object.keys(STATUTS) as StatutDemande[];

export function estStatutValide(valeur: string): valeur is StatutDemande {
  return valeur in STATUTS;
}

/** Formate une date ISO pour l'affichage ; tiret si absente. */
export function formaterDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Idem avec l'heure, pour les horodatages de réception. */
export function formaterDateHeure(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
