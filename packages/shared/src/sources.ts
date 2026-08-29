/**
 * Portes d'entrée d'une demande.
 *
 * Trois chemins mènent à une demande, et ils ne se traitent pas pareil : une
 * demande reçue par courriel arrive avec un fil à conserver, un cahier des
 * charges arrive en pièce jointe volumineuse, un projet interne n'a ni l'un ni
 * l'autre. Sans cette colonne, les trois étaient indiscernables une fois
 * créées — impossible de filtrer ni de mesurer la répartition des entrées.
 */

export const SOURCES_DEMANDE = ['email', 'cps', 'interne'] as const;

export type SourceDemande = (typeof SOURCES_DEMANDE)[number];

export const SOURCE_DEMANDE_DEFAUT: SourceDemande = 'email';

/** Libellé affiché, au singulier et sans jargon. */
export const LIBELLES_SOURCE: Record<SourceDemande, string> = {
  email: 'Courriel',
  cps: 'Cahier des charges',
  interne: 'Projet interne',
};

/** Explication de la provenance, pour l'infobulle et les écrans de détail. */
export const AIDES_SOURCE: Record<SourceDemande, string> = {
  email: 'Reçue dans la boîte relevée par le worker.',
  cps: "Cahier des charges ou appel d'offres déposé sur la plateforme.",
  interne: 'Projet ouvert directement par un administrateur.',
};

export function estSourceDemande(valeur: unknown): valeur is SourceDemande {
  return (
    typeof valeur === 'string' && (SOURCES_DEMANDE as readonly string[]).includes(valeur)
  );
}

/** Ramène n'importe quelle valeur en base à une source connue. */
export function sourceOuDefaut(valeur: unknown): SourceDemande {
  return estSourceDemande(valeur) ? valeur : SOURCE_DEMANDE_DEFAUT;
}
