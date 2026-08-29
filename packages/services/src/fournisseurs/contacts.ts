import { clientAdmin } from '../supabase.js';

// Réexportée depuis `shared` : le formulaire de saisie en a besoin côté
// navigateur, où `services` ne peut pas être chargé.
export { initialesSuggerees } from '@vigon/shared';

/**
 * Contacts d'un fournisseur.
 *
 * `fournisseurs.email` reste l'adresse de référence : c'est elle qui a servi à
 * toutes les consultations envoyées jusqu'ici, et la déplacer casserait
 * l'appariement des réponses déjà en base. Les contacts s'ajoutent à côté —
 * un correspondant technique, un commercial, un service devis — et partent en
 * copie de la demande.
 *
 * Aucun envoi ne dépend de cette table : un fournisseur sans contact déclaré
 * reçoit exactement le message d'avant, à la même adresse.
 */

export type ContactFournisseur = {
  id: number;
  fournisseurId: number;
  nom: string | null;
  email: string;
  telephone: string | null;
  fonction: string | null;
  /** Le contact principal remplace l'adresse de la fiche comme destinataire. */
  principal: boolean;
};

/** Contacts d'un ou plusieurs fournisseurs, groupés par identifiant de fiche. */
export async function lireContacts(
  fournisseurIds: number[],
): Promise<Map<number, ContactFournisseur[]>> {
  const parFournisseur = new Map<number, ContactFournisseur[]>();
  if (fournisseurIds.length === 0) return parFournisseur;

  const { data, error } = await clientAdmin()
    .from('fournisseur_contacts')
    .select('id, fournisseur_id, nom, email, telephone, fonction, principal')
    .in('fournisseur_id', fournisseurIds)
    // Le principal en tête : c'est lui que la résolution retient comme
    // destinataire, et l'ordre évite d'avoir à retrier côté appelant.
    .order('principal', { ascending: false })
    .order('id', { ascending: true });

  if (error) {
    // Un contact illisible ne doit pas empêcher une consultation de partir :
    // l'appelant retombera sur l'adresse de la fiche.
    console.error(`[contacts] lecture impossible : ${error.message}`);
    return parFournisseur;
  }

  for (const c of data ?? []) {
    const liste = parFournisseur.get(c.fournisseur_id) ?? [];
    liste.push({
      id: c.id,
      fournisseurId: c.fournisseur_id,
      nom: c.nom,
      email: c.email,
      telephone: c.telephone,
      fonction: c.fonction,
      principal: c.principal,
    });
    parFournisseur.set(c.fournisseur_id, liste);
  }

  return parFournisseur;
}

export type Destinataires = {
  /** Adresse principale du message. */
  a: string;
  /** Autres contacts, en copie visible. Vide si aucun contact supplémentaire. */
  cc: string[];
};

/**
 * Destinataires d'une consultation, contacts compris.
 *
 * Règle : le contact marqué principal l'emporte sur l'adresse de la fiche ;
 * à défaut, l'adresse de la fiche reste le destinataire. Les autres contacts
 * passent en copie.
 *
 * L'adresse de la fiche n'est jamais perdue : si elle ne figure pas déjà parmi
 * les contacts, elle reste en copie. Un fournisseur dont on a saisi le contact
 * technique ne doit pas cesser de recevoir les demandes sur son adresse
 * générale, qui est souvent la seule relevée.
 */
export function resoudreDestinataires(
  emailFiche: string,
  contacts: ContactFournisseur[],
): Destinataires {
  const normaliser = (e: string) => e.trim().toLowerCase();

  if (contacts.length === 0) return { a: emailFiche, cc: [] };

  const principal = contacts.find((c) => c.principal);
  const a = principal ? principal.email : emailFiche;

  const dejaVu = new Set([normaliser(a)]);
  const cc: string[] = [];

  for (const c of contacts) {
    const cle = normaliser(c.email);
    if (dejaVu.has(cle)) continue;
    dejaVu.add(cle);
    cc.push(c.email);
  }

  // L'adresse de la fiche, si un contact principal l'a supplantée.
  if (!dejaVu.has(normaliser(emailFiche))) cc.push(emailFiche);

  return { a, cc };
}

