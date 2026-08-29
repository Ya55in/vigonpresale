import { createHash } from 'node:crypto';

import { extraireFichier } from '@vigon/extraction';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Dépôt d'un document dans le stockage privé, avec extraction de son texte.
 *
 * Noyau commun au cahier des charges déposé par l'avant-vente et au devis
 * téléversé par le fournisseur. Ces deux chemins partagent la même validation —
 * dont la liste blanche d'extensions et la déduction du type MIME — et la
 * dupliquer ferait courir le risque qu'une copie s'assouplisse sans que l'autre
 * le signale.
 */

const BUCKET = 'pieces-jointes';

/** 15 Mo : au-delà, c'est un dossier complet qu'on transmet autrement. */
const TAILLE_MAX_OCTETS = 15 * 1024 * 1024;

/**
 * Formats dont on sait extraire le texte.
 *
 * Refusés à l'entrée plutôt que stockés sans être lisibles : un document qu'on
 * ne saura jamais rouvrir donne l'illusion d'une pièce au dossier.
 */
export const EXTENSIONS_ACCEPTEES = ['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.txt'];

/**
 * Type MIME déduit de l'extension, jamais repris du navigateur.
 *
 * `File.type` est renseigné par le client : un fichier nommé `devis.pdf` peut
 * s'annoncer `text/html`, et le stockage le resservirait tel quel. Le bucket est
 * privé et l'accès passe par une URL signée, mais cette URL s'ouvre dans le
 * navigateur — un HTML servi comme tel y exécuterait son script sur le domaine
 * du stockage.
 *
 * L'extension, elle, est contrainte par la liste blanche ci-dessus.
 */
const MIME_PAR_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
};

export type ResultatDepot = {
  ok: boolean;
  /** Renseigné en cas de refus ; l'appelant décide s'il bloque ou signale. */
  motif?: string;
  /** Texte extrait, quand le format s'y prête et que l'extraction a réussi. */
  texte?: string | null;
};

/** Nom de fichier assaini : le `/` ferait sortir du dossier du locataire. */
const assainir = (nom: string): string =>
  nom.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);

const extensionDe = (nom: string): string => {
  const point = nom.lastIndexOf('.');
  return point === -1 ? '' : nom.slice(point).toLowerCase();
};

/** Refus de forme, avant toute écriture. */
export function validerFichier(fichier: File): { ok: true } | { ok: false; motif: string } {
  if (fichier.size === 0) return { ok: false, motif: 'Fichier vide.' };

  if (fichier.size > TAILLE_MAX_OCTETS) {
    return {
      ok: false,
      motif: `Fichier trop volumineux (${Math.round(fichier.size / 1024 / 1024)} Mo, maximum 15 Mo).`,
    };
  }

  const extension = extensionDe(fichier.name);

  if (!EXTENSIONS_ACCEPTEES.includes(extension)) {
    return {
      ok: false,
      motif: `Format non lisible (${extension || 'sans extension'}). Acceptés : ${EXTENSIONS_ACCEPTEES.join(', ')}.`,
    };
  }

  return { ok: true };
}

/**
 * Stocke le fichier et crée sa ligne `pieces_jointes`.
 *
 * `rattachement` décide à quoi la pièce est liée : une demande pour un cahier
 * des charges, un devis pour une réponse fournisseur. Les deux colonnes
 * existent au schéma, seule l'une est renseignée à la fois.
 */
export async function deposerFichier(params: {
  fichier: File;
  tenant: string;
  /** Sous-dossier de stockage, pour que les chemins restent lisibles. */
  dossier: string;
  rattachement: { demandeId: number } | { devisId: number };
  /** Préfixe des journaux, pour distinguer les deux chemins d'appel. */
  contexte: string;
}): Promise<ResultatDepot> {
  const { fichier, tenant, dossier, rattachement, contexte } = params;

  const valide = validerFichier(fichier);
  if (!valide.ok) return { ok: false, motif: valide.motif };

  const contenu = Buffer.from(await fichier.arrayBuffer());
  const hash = createHash('sha256').update(contenu).digest('hex');

  // Le hash préfixe le nom : deux fichiers homonymes ne s'écrasent pas, et le
  // chemin reste dans le dossier du locataire quoi qu'annonce le nom d'origine.
  const chemin = `${tenant}/${dossier}/${hash.slice(0, 12)}-${assainir(fichier.name)}`;

  const db = createAdminClient();
  const typeMime = MIME_PAR_EXTENSION[extensionDe(fichier.name)] ?? 'application/octet-stream';

  const { error: erreurDepot } = await db.storage
    .from(BUCKET)
    .upload(chemin, contenu, { contentType: typeMime, upsert: true });

  if (erreurDepot) {
    console.error(`[${contexte}] dépôt impossible`, erreurDepot.message);
    return { ok: false, motif: 'Dépôt du fichier impossible.' };
  }

  // Une extraction en échec ne perd pas le document : il reste consultable et
  // le statut le signale, comme pour une pièce jointe illisible reçue par mail.
  const extraction = await extraireFichier({ nom: fichier.name, contenu });

  const { error: erreurLigne } = await db.from('pieces_jointes').insert({
    tenant_id: tenant,
    ...('demandeId' in rattachement
      ? { demande_id: rattachement.demandeId }
      : { devis_id: rattachement.devisId }),
    nom_fichier: fichier.name,
    // Le type déduit, pas celui annoncé : la base ne doit pas conserver une
    // valeur que le navigateur a choisie.
    mime_type: typeMime,
    taille_octets: contenu.byteLength,
    hash_sha256: hash,
    storage_path: chemin,
    est_archive: false,
    texte_extrait: extraction.texte,
    statut_extraction: extraction.erreur ? 'echec' : extraction.texte ? 'ok' : 'vide',
    erreur_extraction: extraction.erreur,
  });

  if (erreurLigne) {
    console.error(`[${contexte}] enregistrement impossible`, erreurLigne.message);
    return { ok: false, motif: 'Enregistrement du document impossible.' };
  }

  return { ok: true, texte: extraction.texte };
}
