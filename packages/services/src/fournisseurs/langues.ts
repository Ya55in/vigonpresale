import { estLangue, langueDepuisPays, type Langue } from '@vigon/shared';

import { clientAdmin } from '../supabase.js';

/**
 * Langue de correspondance de chaque fournisseur.
 *
 * La table `fournisseurs` ne porte pas de colonne `langue` et le schéma distant
 * ne se modifie pas depuis le dépôt. La langue choisie à la main est donc
 * stockée dans `parametres`, à raison d'une ligne par fournisseur — une ligne
 * par fournisseur plutôt qu'un objet JSON unique, pour que deux enregistrements
 * simultanés ne s'écrasent pas l'un l'autre.
 *
 * À défaut de choix explicite, la langue est déduite du pays. Le jour où une
 * colonne `langue` sera ajoutée au schéma, seules les deux fonctions d'accès de
 * ce fichier changent.
 */

const CATEGORIE = 'langue_fournisseur';

const cle = (fournisseurId: number): string => `fournisseur_langue_${fournisseurId}`;

/**
 * Langues explicitement choisies, par identifiant de fournisseur.
 *
 * Une seule requête pour tout le tenant : l'envoi des consultations en traite
 * plusieurs d'affilée, les interroger un par un multiplierait les allers-retours.
 */
export async function lireLanguesChoisies(tenant: string): Promise<Map<number, Langue>> {
  const choisies = new Map<number, Langue>();

  const { data, error } = await clientAdmin()
    .from('parametres')
    .select('cle, valeur')
    .eq('tenant_id', tenant)
    .eq('categorie', CATEGORIE);

  if (error) {
    // Un défaut de lecture ne doit pas empêcher l'envoi : on retombe sur le pays.
    console.error(`[langues] lecture impossible, repli sur le pays : ${error.message}`);
    return choisies;
  }

  for (const ligne of data ?? []) {
    const identifiant = Number(ligne.cle?.replace('fournisseur_langue_', ''));
    if (Number.isFinite(identifiant) && estLangue(ligne.valeur)) {
      choisies.set(identifiant, ligne.valeur);
    }
  }

  return choisies;
}

/** Langue en vigueur pour un fournisseur : choix explicite, sinon déduction du pays. */
export function langueEffective(
  fournisseur: { id: number; pays: string | null },
  choisies: Map<number, Langue>,
): Langue {
  return choisies.get(fournisseur.id) ?? langueDepuisPays(fournisseur.pays);
}

/**
 * Langue en vigueur de plusieurs fournisseurs, par identifiant.
 *
 * Destinée aux jobs qui traitent un lot et ne disposent que des identifiants —
 * les relances notamment, qui lisent des consultations et non des fournisseurs.
 * Les identifiants inconnus sont simplement absents du résultat, à l'appelant
 * de retomber sur la langue par défaut.
 */
export async function lireLanguesFournisseurs(
  tenant: string,
  identifiants: number[],
): Promise<Map<number, Langue>> {
  const resultat = new Map<number, Langue>();
  const uniques = [...new Set(identifiants)];
  if (uniques.length === 0) return resultat;

  const choisies = await lireLanguesChoisies(tenant);

  const { data, error } = await clientAdmin()
    .from('fournisseurs')
    .select('id, pays')
    .eq('tenant_id', tenant)
    .in('id', uniques);

  if (error) {
    console.error(`[langues] lecture des pays impossible : ${error.message}`);
    // Les choix explicites restent exploitables même sans les pays.
    for (const identifiant of uniques) {
      const choisie = choisies.get(identifiant);
      if (choisie) resultat.set(identifiant, choisie);
    }
    return resultat;
  }

  for (const fournisseur of data ?? []) {
    resultat.set(fournisseur.id, langueEffective(fournisseur, choisies));
  }

  return resultat;
}

/**
 * Enregistre la langue d'un fournisseur.
 *
 * Passer la langue déduite du pays supprime la ligne plutôt que de l'écrire :
 * le fournisseur suit alors son pays si celui-ci est corrigé plus tard.
 */
export async function definirLangueFournisseur(params: {
  tenant: string;
  fournisseurId: number;
  langue: Langue;
  pays: string | null;
}): Promise<void> {
  const db = clientAdmin();
  const cleLigne = cle(params.fournisseurId);

  const { data: existant } = await db
    .from('parametres')
    .select('id')
    .eq('tenant_id', params.tenant)
    .eq('cle', cleLigne)
    .maybeSingle();

  if (params.langue === langueDepuisPays(params.pays)) {
    if (existant) await db.from('parametres').delete().eq('id', existant.id);
    return;
  }

  if (existant) {
    const { error } = await db
      .from('parametres')
      .update({ valeur: params.langue, updated_at: new Date().toISOString() })
      .eq('id', existant.id);
    if (error) throw new Error(`Enregistrement de la langue : ${error.message}`);
    return;
  }

  const { error } = await db.from('parametres').insert({
    tenant_id: params.tenant,
    cle: cleLigne,
    valeur: params.langue,
    type_valeur: 'texte',
    categorie: CATEGORIE,
    description: `Langue de correspondance du fournisseur #${params.fournisseurId}`,
  });

  if (error) throw new Error(`Enregistrement de la langue : ${error.message}`);
}
