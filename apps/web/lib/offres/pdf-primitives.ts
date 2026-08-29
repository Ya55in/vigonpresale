import {
  Document as DocumentPdf,
  Image as ImagePdf,
  Page as PagePdf,
  Text as TextPdf,
  View as ViewPdf,
} from '@react-pdf/renderer';

/**
 * Primitives PDF retypées pour React 19.
 *
 * `@react-pdf/renderer` 4.6.1 annonce React 19 dans ses `peerDependencies`, et
 * il fonctionne bien à l'exécution — c'est vérifié par la génération d'offre.
 * Mais ses définitions passent encore par `@react-pdf/types`, écrit pour le
 * JSX de React 18 : React 19 a retiré la compatibilité `JSX.ElementClass`, d'où
 * 242 erreurs TS2786 et TS2607 sur un seul fichier, le gabarit d'offre.
 *
 * Aucune de ces erreurs ne décrit un défaut réel. Plutôt que de parsemer le
 * gabarit de 242 `@ts-expect-error` — qu'il faudrait retirer un par un le jour
 * où l'amont corrige ses types — le compromis est **rassemblé ici**, sur cinq
 * lignes qu'on supprimera d'un bloc.
 *
 * Ce que ça coûte : les props des primitives PDF ne sont plus vérifiées dans le
 * gabarit. Ce que ça préserve : tout le reste du fichier, et le typage strict
 * partout ailleurs.
 */

/**
 * `Record<string, unknown>` plutôt que `any` : les props ne sont plus
 * vérifiées, mais l'élargissement reste borné et ne contamine pas les valeurs
 * qui traversent le gabarit.
 */
type PrimitivePdf = React.ComponentType<Record<string, unknown>>;

export const Document = DocumentPdf as unknown as PrimitivePdf;
export const Image = ImagePdf as unknown as PrimitivePdf;
export const Page = PagePdf as unknown as PrimitivePdf;
export const Text = TextPdf as unknown as PrimitivePdf;
export const View = ViewPdf as unknown as PrimitivePdf;

export { StyleSheet } from '@react-pdf/renderer';
