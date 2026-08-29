import { createHash } from 'node:crypto';

import { firecrawlConfigure, rechercher } from '../firecrawl/index.js';
import { clientAdmin } from '../supabase.js';

const BUCKET = 'offres';

/**
 * Types d'image acceptés : ce que le rendu PDF sait décoder.
 *
 * WebP en est exclu, bien que tout navigateur l'affiche : `@react-pdf/renderer`
 * le refuse (« Not valid image extension ») et laisse simplement l'emplacement
 * vide. Le visuel était alors compté comme trouvé, et l'offre partait chez le
 * client avec un trou que rien ne signalait. Mieux vaut le déclarer manquant et
 * chercher une autre image.
 */
const TYPES_ACCEPTES = new Set(['image/jpeg', 'image/png']);

/** Au-delà, l'image alourdit le PDF sans gain visuel. */
const TAILLE_MAX_OCTETS = 4 * 1024 * 1024;

/** En dessous, c'est un pictogramme ou un pixel de suivi, pas une photo produit. */
const TAILLE_MIN_OCTETS = 3 * 1024;

export type PhotoProduit = {
  imageUrl: string | null;
  imageSource: string | null;
  /** Vrai quand aucune photo exploitable n'a été trouvée : validation manuelle. */
  placeholder: boolean;
  motif?: string;
};

/**
 * Domaines officiels de fabricants connus.
 *
 * La spec demande de privilégier les sites officiels : une photo prise chez un
 * revendeur porte souvent son filigrane, ce qui est inutilisable dans une offre.
 */
const DOMAINES_OFFICIELS: Record<string, string[]> = {
  cisco: ['cisco.com'],
  apc: ['apc.com', 'se.com', 'schneider-electric.com'],
  'schneider electric': ['se.com', 'schneider-electric.com'],
  ubiquiti: ['ui.com', 'ubnt.com'],
  dell: ['dell.com'],
  hp: ['hp.com'],
  hpe: ['hpe.com'],
  lenovo: ['lenovo.com'],
  logitech: ['logitech.com'],
  fortinet: ['fortinet.com'],
  aruba: ['arubanetworks.com'],
  eaton: ['eaton.com'],
};

/** Score de priorité : plus bas = plus fiable. */
function prioriteSource(url: string, marque: string): number {
  const hote = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  const officiels = DOMAINES_OFFICIELS[marque.toLowerCase().trim()] ?? [];
  if (officiels.some((d) => hote === d || hote.endsWith(`.${d}`))) return 0;

  // Un domaine contenant la marque est probablement officiel même hors table.
  const marqueSimple = marque.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (marqueSimple.length > 2 && hote.replace(/[^a-z0-9]/g, '').includes(marqueSimple)) {
    return 1;
  }

  return 2;
}

/** Extrait les URLs d'images d'un contenu markdown ou HTML. */
function extraireUrlsImages(contenu: string): string[] {
  const urls: string[] = [];

  // Markdown : ![alt](url)
  for (const m of contenu.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)) {
    if (m[1]) urls.push(m[1]);
  }
  // HTML : src="url"
  for (const m of contenu.matchAll(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi)) {
    if (m[1]) urls.push(m[1]);
  }
  // URLs nues se terminant par une extension d'image. WebP est écarté dès la
  // collecte : le téléchargement serait rejeté plus bas, autant ne pas le faire.
  for (const m of contenu.matchAll(/https?:\/\/[^\s"'<>)]+\.(?:jpe?g|png)(?:\?[^\s"'<>)]*)?/gi)) {
    urls.push(m[0]);
  }

  return [...new Set(urls)];
}

/** Écarte ce qui n'est visiblement pas une photo de produit. */
function urlPlausible(url: string): boolean {
  const bas = url.toLowerCase();
  const rejets = [
    'logo',
    'icon',
    'favicon',
    'sprite',
    'banner',
    'placeholder',
    'avatar',
    'pixel',
    'tracking',
    '1x1',
    'spacer',
    'flag',
    'badge',
  ];
  return !rejets.some((r) => bas.includes(r));
}

/** Télécharge et valide une image candidate. */
async function telecharger(
  url: string,
): Promise<{ contenu: Buffer; typeMime: string } | null> {
  try {
    const reponse = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'image/*' },
    });
    if (!reponse.ok) return null;

    const typeMime = (reponse.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!TYPES_ACCEPTES.has(typeMime)) return null;

    const taille = Number(reponse.headers.get('content-length') ?? 0);
    if (taille > TAILLE_MAX_OCTETS) return null;

    const contenu = Buffer.from(await reponse.arrayBuffer());
    if (contenu.byteLength < TAILLE_MIN_OCTETS || contenu.byteLength > TAILLE_MAX_OCTETS) {
      return null;
    }

    return { contenu, typeMime };
  } catch {
    return null;
  }
}

/** Doit rester aligné sur TYPES_ACCEPTES. */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/**
 * Cherche, télécharge et stocke une photo du produit.
 *
 * Ne lève jamais : une photo manquante ne doit pas interrompre la génération de
 * l'offre. Le drapeau `placeholder` signale à PRESALE qu'une image est à
 * fournir manuellement avant envoi au client.
 */
export async function recupererPhotoProduit(params: {
  tenant: string;
  offreId: number;
  marque: string;
  reference: string | null;
  designation: string;
}): Promise<PhotoProduit> {
  const { tenant, offreId, marque, reference, designation } = params;

  if (!firecrawlConfigure()) {
    return {
      imageUrl: null,
      imageSource: null,
      placeholder: true,
      motif: 'Sourcing web indisponible (FIRECRAWL_API_KEY absente).',
    };
  }

  const requete = reference
    ? `${marque} ${reference} product image`
    : `${marque} ${designation} product image`;

  let candidates: { url: string; source: string }[] = [];

  try {
    const resultats = await rechercher(requete, { limite: 4, scraper: true });

    for (const resultat of resultats) {
      const contenu = [resultat.contenu ?? '', resultat.description].join('\n');
      for (const url of extraireUrlsImages(contenu)) {
        if (urlPlausible(url)) candidates.push({ url, source: resultat.url });
      }
    }
  } catch (e) {
    return {
      imageUrl: null,
      imageSource: null,
      placeholder: true,
      motif: `Recherche d'image en échec : ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Sites officiels d'abord, conformément à la spec.
  candidates = candidates
    .map((c) => ({ ...c, priorite: prioriteSource(c.source, marque) }))
    .sort((a, b) => a.priorite - b.priorite)
    .slice(0, 8);

  const db = clientAdmin();

  for (const candidate of candidates) {
    const image = await telecharger(candidate.url);
    if (!image) continue;

    const hash = createHash('sha256').update(image.contenu).digest('hex');
    const extension = EXTENSIONS[image.typeMime] ?? 'jpg';
    const chemin = `${tenant}/${offreId}/produits/${hash.slice(0, 16)}.${extension}`;

    const { error } = await db.storage
      .from(BUCKET)
      .upload(chemin, image.contenu, { contentType: image.typeMime, upsert: true });

    if (error) continue;

    // URL signée longue : le bucket est privé, mais le PDF et la page publique
    // doivent afficher l'image sans authentifier le lecteur.
    const { data: signee } = await db.storage
      .from(BUCKET)
      .createSignedUrl(chemin, 60 * 60 * 24 * 365);

    return {
      imageUrl: signee?.signedUrl ?? null,
      imageSource: candidate.source,
      placeholder: false,
    };
  }

  return {
    imageUrl: null,
    imageSource: null,
    placeholder: true,
    motif: `Aucune image exploitable trouvée pour ${marque} ${reference ?? designation}.`,
  };
}
