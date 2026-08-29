import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

import { LIMITES_ARCHIVE } from '@vigon/shared';

export class ErreurExtraction extends Error {
  constructor(
    message: string,
    readonly fichier: string,
  ) {
    super(message);
    this.name = 'ErreurExtraction';
  }
}

export type FichierBrut = {
  nom: string;
  contenu: Buffer;
};

export type ResultatExtraction = {
  nom: string;
  /** Texte extrait, ou null si le format est illisible. */
  texte: string | null;
  /** Renseigné quand l'extraction a échoué : sert au flag « PJ illisible ». */
  erreur: string | null;
};

const extensionDe = (nom: string): string => {
  const i = nom.lastIndexOf('.');
  return i === -1 ? '' : nom.slice(i).toLowerCase();
};

/** PDF — import différé : pdf-parse lit un fichier de test au chargement. */
async function extrairePdf(contenu: Buffer): Promise<string> {
  const { default: pdfParse } = await import('pdf-parse');
  const resultat = await pdfParse(contenu);
  return resultat.text;
}

/** XLSX/XLS/CSV — chaque feuille est transcrite en CSV, séparée par son nom. */
function extraireTableur(contenu: Buffer): string {
  const classeur = XLSX.read(contenu, { type: 'buffer' });
  const morceaux: string[] = [];

  for (const nomFeuille of classeur.SheetNames) {
    const feuille = classeur.Sheets[nomFeuille];
    if (!feuille) continue;
    const csv = XLSX.utils.sheet_to_csv(feuille, { blankrows: false });
    if (csv.trim()) morceaux.push(`--- Feuille : ${nomFeuille} ---\n${csv}`);
  }

  return morceaux.join('\n\n');
}

async function extraireDocx(contenu: Buffer): Promise<string> {
  const resultat = await mammoth.extractRawText({ buffer: contenu });
  return resultat.value;
}

/**
 * Extrait le texte d'un fichier selon son extension.
 *
 * Ne lève jamais : un format illisible remonte via le champ `erreur` pour que
 * l'appelant puisse signaler la pièce jointe sans interrompre le traitement
 * des autres fichiers de la demande.
 */
export async function extraireFichier(
  fichier: FichierBrut,
): Promise<ResultatExtraction> {
  const extension = extensionDe(fichier.nom);

  try {
    switch (extension) {
      case '.pdf':
        return { nom: fichier.nom, texte: await extrairePdf(fichier.contenu), erreur: null };
      case '.xlsx':
      case '.xls':
      case '.csv':
        return { nom: fichier.nom, texte: extraireTableur(fichier.contenu), erreur: null };
      case '.docx':
        return { nom: fichier.nom, texte: await extraireDocx(fichier.contenu), erreur: null };
      case '.txt':
      case '.md':
        return { nom: fichier.nom, texte: fichier.contenu.toString('utf8'), erreur: null };
      default:
        return {
          nom: fichier.nom,
          texte: null,
          erreur: `Format non pris en charge (${extension || 'sans extension'})`,
        };
    }
  } catch (e) {
    return {
      nom: fichier.nom,
      texte: null,
      erreur: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Décompresse une archive, récursivement.
 *
 * Bornée à 2 niveaux et 50 fichiers (spec) : une archive imbriquée ou
 * volumineuse ne doit pas pouvoir saturer le worker.
 */
export function decompresser(
  contenu: Buffer,
  nomArchive: string,
  profondeur = 1,
  compteur = { total: 0 },
): FichierBrut[] {
  if (profondeur > LIMITES_ARCHIVE.profondeurMax) return [];

  let entrees: AdmZip.IZipEntry[];
  try {
    entrees = new AdmZip(contenu).getEntries();
  } catch (e) {
    throw new ErreurExtraction(
      `Archive illisible : ${e instanceof Error ? e.message : String(e)}`,
      nomArchive,
    );
  }

  const fichiers: FichierBrut[] = [];

  for (const entree of entrees) {
    if (compteur.total >= LIMITES_ARCHIVE.fichiersMax) break;
    if (entree.isDirectory) continue;
    // Ignore les métadonnées macOS présentes dans toute archive créée sur Mac.
    if (entree.entryName.startsWith('__MACOSX/')) continue;

    const donnees = entree.getData();
    const nom = `${nomArchive}/${entree.entryName}`;

    if (extensionDe(entree.entryName) === '.zip') {
      fichiers.push(...decompresser(donnees, nom, profondeur + 1, compteur));
      continue;
    }

    compteur.total += 1;
    fichiers.push({ nom, contenu: donnees });
  }

  return fichiers;
}

/**
 * Extrait tout le contenu exploitable d'un lot de pièces jointes, archives
 * comprises, et le concatène (flux étape 1, `contenu_consolide`).
 */
export async function extraireLot(fichiers: FichierBrut[]): Promise<{
  texte: string;
  resultats: ResultatExtraction[];
}> {
  const aPlat: FichierBrut[] = [];
  const resultats: ResultatExtraction[] = [];

  for (const fichier of fichiers) {
    if (extensionDe(fichier.nom) === '.zip') {
      try {
        aPlat.push(...decompresser(fichier.contenu, fichier.nom));
      } catch (e) {
        resultats.push({
          nom: fichier.nom,
          texte: null,
          erreur: e instanceof Error ? e.message : String(e),
        });
      }
      continue;
    }
    aPlat.push(fichier);
  }

  for (const fichier of aPlat) {
    resultats.push(await extraireFichier(fichier));
  }

  const texte = resultats
    .filter((r) => r.texte !== null && r.texte.trim() !== '')
    .map((r) => `--- ${r.nom} ---\n${r.texte!.trim()}`)
    .join('\n\n');

  return { texte, resultats };
}
