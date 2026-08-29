import { emailCommercialValide, fournisseurSourceSchema } from '@vigon/shared';

import { genererJson } from '../ai/index.js';
import { promptSourcingFournisseur } from '../ai/prompts.js';
import { firecrawlConfigure, rechercher } from '../firecrawl/index.js';
import { clientAdmin } from '../supabase.js';

/**
 * Normalise une marque comme le fait la colonne générée `marque_norm`
 * (lower + unaccent). Les deux doivent rester alignées, sinon la recherche
 * en base rate des fournisseurs pourtant enregistrés.
 */
export function normaliserMarque(marque: string): string {
  return marque
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export type FournisseurResolu = {
  id: number;
  nom: string;
  email: string;
  marque: string;
  source: string;
  /** Sert à déduire la langue de correspondance faute de choix explicite. */
  pays: string | null;
};

export type ResultatResolution = {
  resolus: FournisseurResolu[];
  /** Marques pour lesquelles aucun contact exploitable n'a été trouvé. */
  nonResolues: { marque: string; motif: string }[];
};

/** Cherche un fournisseur actif déjà enregistré pour cette marque. */
async function chercherEnBase(
  tenant: string,
  marque: string,
): Promise<FournisseurResolu | null> {
  const { data, error } = await clientAdmin()
    .from('fournisseurs')
    .select('id, nom, email, marque, source, pays')
    .eq('tenant_id', tenant)
    .eq('marque_norm', normaliserMarque(marque))
    .eq('actif', true)
    // Le mieux noté d'abord : plusieurs distributeurs peuvent exister
    // pour une même marque.
    .order('score_fiabilite', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.email) return null;
  return data as FournisseurResolu;
}

/**
 * Sourcing web via Firecrawl, puis extraction du contact par le modèle.
 *
 * L'adresse est revalidée en TypeScript après extraction : le modèle peut
 * renvoyer une adresse plausible mais inexploitable (noreply, nom de fichier).
 */
async function sourcerSurLeWeb(
  tenant: string,
  marque: string,
): Promise<{ fournisseur: FournisseurResolu | null; motif: string }> {
  if (!firecrawlConfigure()) {
    return { fournisseur: null, motif: 'Sourcing web indisponible (FIRECRAWL_API_KEY absente).' };
  }

  let contenu: string;
  try {
    const resultats = await rechercher(
      `distributeur officiel ${marque} Maroc contact commercial email`,
      { limite: 3, scraper: true },
    );

    contenu = resultats
      .map((r) => [r.url, r.titre, r.description, r.contenu ?? ''].join('\n'))
      .join('\n\n---\n\n')
      .slice(0, 20_000);

    if (!contenu.trim()) {
      return { fournisseur: null, motif: 'Aucun résultat web exploitable.' };
    }
  } catch (e) {
    return {
      fournisseur: null,
      motif: `Recherche web en échec : ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  let extrait;
  try {
    extrait = await genererJson(
      await promptSourcingFournisseur(tenant, { marque, contenuWeb: contenu }),
      fournisseurSourceSchema,
      { tentatives: 2, contexte: { marque } },
    );
  } catch (e) {
    return {
      fournisseur: null,
      motif: `Extraction du contact en échec : ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!extrait.email || !emailCommercialValide(extrait.email)) {
    // La piste trouvée est CONSERVÉE dans le motif, au lieu d'être perdue.
    //
    // Le cas est fréquent et n'est pas une panne : les sites de constructeurs
    // ne publient plus d'adresse, ils publient un formulaire. Le modèle a
    // pourtant identifié le distributeur et son site — refuser d'inventer une
    // adresse est le comportement voulu, jeter ce qui a été trouvé ne l'est pas.
    //
    // PRESALE repart de là au lieu de repartir de zéro : c'est la différence
    // entre « rien trouvé » et « voici qui contacter, l'adresse est à chercher ».
    const piste = [extrait.nom, extrait.site].filter(Boolean).join(' — ');

    return {
      fournisseur: null,
      motif: extrait.email
        ? `Adresse rejetée : « ${extrait.email} »${piste ? `. Piste : ${piste}` : ''}`
        : piste
          ? `Aucune adresse publiée. Piste trouvée : ${piste}`
          : 'Aucune adresse de contact trouvée.',
    };
  }

  // Une même adresse ne doit pas être enregistrée deux fois pour la marque.
  const db = clientAdmin();
  const { data: deja } = await db
    .from('fournisseurs')
    .select('id, nom, email, marque, source, pays')
    .eq('tenant_id', tenant)
    .eq('marque_norm', normaliserMarque(marque))
    .ilike('email', extrait.email)
    .maybeSingle();

  if (deja) return { fournisseur: deja as FournisseurResolu, motif: '' };

  const { data: cree, error } = await db
    .from('fournisseurs')
    .insert({
      tenant_id: tenant,
      marque,
      nom: extrait.nom || `Distributeur ${marque}`,
      email: extrait.email.toLowerCase(),
      site_web: extrait.site,
      source: 'web',
    })
    .select('id, nom, email, marque, source, pays')
    .single();

  if (error) {
    return { fournisseur: null, motif: `Enregistrement impossible : ${error.message}` };
  }

  return { fournisseur: cree as FournisseurResolu, motif: '' };
}

/**
 * Résout un fournisseur par marque : base d'abord, sourcing web ensuite.
 *
 * Les marques non résolues sont renvoyées avec leur motif plutôt que levées :
 * l'appelant doit pouvoir traiter les autres et signaler celles-ci à PRESALE.
 */
export async function resoudreFournisseurs(
  tenant: string,
  marques: string[],
): Promise<ResultatResolution> {
  const resolus: FournisseurResolu[] = [];
  const nonResolues: { marque: string; motif: string }[] = [];

  for (const marque of marques) {
    if (!marque.trim() || normaliserMarque(marque) === 'non specifie') {
      nonResolues.push({
        marque: marque || '(vide)',
        motif: "Marque non identifiée à l'extraction — à compléter manuellement.",
      });
      continue;
    }

    const enBase = await chercherEnBase(tenant, marque);
    if (enBase) {
      resolus.push(enBase);
      continue;
    }

    const { fournisseur, motif } = await sourcerSurLeWeb(tenant, marque);
    if (fournisseur) resolus.push(fournisseur);
    else nonResolues.push({ marque, motif });
  }

  return { resolus, nonResolues };
}
