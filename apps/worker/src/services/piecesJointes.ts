import { createHash } from 'node:crypto';

import { extraireFichier, decompresser, type FichierBrut } from '@vigon/extraction';
import { clientAdmin, type ClientAdmin } from '@vigon/services';
import type { PieceJointeBrute } from '@vigon/services';

const BUCKET = 'pieces-jointes';

/** Fichier prêt à être persisté, aplati depuis les archives. */
type FichierAPersister = FichierBrut & {
  typeMime: string;
  /** Renseigné pour les fichiers issus d'une archive. */
  estIssuArchive: boolean;
};

export type ResultatPiecesJointes = {
  /** Texte concaténé de toutes les pièces exploitables. */
  texte: string;
  /** Nombre de fichiers effectivement stockés. */
  stockes: number;
  /** Fichiers dont l'extraction a échoué — sert au flag « PJ illisible ». */
  illisibles: string[];
};

const extensionDe = (nom: string): string => {
  const i = nom.lastIndexOf('.');
  return i === -1 ? '' : nom.slice(i).toLowerCase();
};

/** Devine le type MIME d'un fichier extrait d'archive, où il est inconnu. */
function mimeDepuisExtension(nom: string): string {
  const table: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.zip': 'application/zip',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return table[extensionDe(nom)] ?? 'application/octet-stream';
}

/**
 * Nettoie un nom de fichier pour Supabase Storage.
 *
 * Les noms issus d'archives contiennent des « / » (chemin dans le ZIP) et
 * parfois des accents, que l'API Storage refuse dans une clé d'objet.
 */
function assainir(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120);
}

/**
 * Aplatit les pièces jointes : les archives sont décompressées, le reste passe
 * tel quel. Les archives elles-mêmes sont conservées pour traçabilité.
 */
function aplatir(pieces: PieceJointeBrute[]): {
  fichiers: FichierAPersister[];
  archivesIllisibles: string[];
} {
  const fichiers: FichierAPersister[] = [];
  const archivesIllisibles: string[] = [];

  for (const pj of pieces) {
    if (extensionDe(pj.nom) !== '.zip') {
      fichiers.push({
        nom: pj.nom,
        contenu: pj.contenu,
        typeMime: pj.typeMime,
        estIssuArchive: false,
      });
      continue;
    }

    // L'archive est stockée telle quelle, puis son contenu est aplati.
    fichiers.push({
      nom: pj.nom,
      contenu: pj.contenu,
      typeMime: 'application/zip',
      estIssuArchive: false,
    });

    try {
      for (const extrait of decompresser(pj.contenu, pj.nom)) {
        fichiers.push({
          nom: extrait.nom,
          contenu: extrait.contenu,
          typeMime: mimeDepuisExtension(extrait.nom),
          estIssuArchive: true,
        });
      }
    } catch (e) {
      archivesIllisibles.push(
        `${pj.nom} : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return { fichiers, archivesIllisibles };
}

/**
 * Stocke les pièces jointes d'une demande et en extrait le texte.
 *
 * Idempotent par (demande_id, hash_sha256) : un même fichier rejoué — relance
 * du job, message redélivré — n'est ni réuploadé ni réinséré.
 */
export async function traiterPiecesJointes(
  demandeId: number,
  tenant: string,
  pieces: PieceJointeBrute[],
): Promise<ResultatPiecesJointes> {
  const db: ClientAdmin = clientAdmin();
  const { fichiers, archivesIllisibles } = aplatir(pieces);

  const morceaux: string[] = [];
  const illisibles = [...archivesIllisibles];
  let stockes = 0;

  // Index des archives déjà insérées, pour rattacher leur contenu (parent_archive_id).
  const idsParNom = new Map<string, number>();

  for (const fichier of fichiers) {
    const hash = createHash('sha256').update(fichier.contenu).digest('hex');

    const { data: existant } = await db
      .from('pieces_jointes')
      .select('id')
      .eq('demande_id', demandeId)
      .eq('hash_sha256', hash)
      .maybeSingle();

    if (existant) {
      idsParNom.set(fichier.nom, existant.id);
      continue;
    }

    const estArchive = extensionDe(fichier.nom) === '.zip';
    const chemin = `${tenant}/${demandeId}/${hash.slice(0, 12)}-${assainir(fichier.nom)}`;

    const { error: upload } = await db.storage
      .from(BUCKET)
      .upload(chemin, fichier.contenu, {
        contentType: fichier.typeMime,
        upsert: true,
      });

    if (upload) {
      illisibles.push(`${fichier.nom} : stockage impossible (${upload.message})`);
      continue;
    }

    // Le texte n'est extrait que du contenu réel : une archive n'en a pas.
    const extraction = estArchive
      ? { texte: null, erreur: null }
      : await extraireFichier({ nom: fichier.nom, contenu: fichier.contenu });

    if (extraction.texte?.trim()) {
      morceaux.push(`--- ${fichier.nom} ---\n${extraction.texte.trim()}`);
    }
    if (extraction.erreur) {
      illisibles.push(`${fichier.nom} : ${extraction.erreur}`);
    }

    // Le parent est l'archive dont ce fichier provient (préfixe du nom aplati).
    const parent = fichier.estIssuArchive
      ? (idsParNom.get(fichier.nom.split('/')[0] ?? '') ?? null)
      : null;

    const { data: insere, error: insertion } = await db
      .from('pieces_jointes')
      .insert({
        tenant_id: tenant,
        demande_id: demandeId,
        nom_fichier: fichier.nom,
        mime_type: fichier.typeMime,
        taille_octets: fichier.contenu.byteLength,
        hash_sha256: hash,
        storage_path: chemin,
        est_archive: estArchive,
        parent_archive_id: parent,
        texte_extrait: extraction.texte,
        statut_extraction: extraction.erreur
          ? 'echec'
          : extraction.texte
            ? 'ok'
            : 'sans_texte',
        erreur_extraction: extraction.erreur,
      })
      .select('id')
      .single();

    if (insertion) {
      illisibles.push(`${fichier.nom} : enregistrement impossible (${insertion.message})`);
      continue;
    }

    idsParNom.set(fichier.nom, insere.id);
    stockes += 1;
  }

  return { texte: morceaux.join('\n\n'), stockes, illisibles };
}
