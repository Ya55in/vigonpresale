import { clientAdmin } from '@vigon/services';

/**
 * Relève l'état de quelques lignes de `parametres` et sait le restituer.
 *
 * POURQUOI CE MODULE EXISTE
 *
 * La règle du projet — « les scripts qui écrivent en base nettoient derrière
 * eux » — avait été implémentée dans trois harnais comme un `delete` sur le nom
 * de la clé. C'est correct sur une table vide, et destructeur sur une table
 * garnie : le 2026-08-20, `essai:whatsapp` a effacé le jeton et l'identifiant de
 * numéro que l'utilisateur venait de saisir dans `/admin`.
 *
 * Nettoyer, ce n'est pas supprimer : c'est **rendre l'état trouvé**. Une ligne
 * absente au départ doit disparaître ; une ligne présente doit retrouver sa
 * valeur, à l'octet près.
 *
 * Une seule implémentation, appelée par les trois harnais. La règle avait déjà
 * dérivé une fois en étant recopiée — c'est exactement ce que
 * `packages/shared/src/html.ts` a résolu pour l'échappement.
 *
 * Ne couvre PAS la catégorie : deux lignes de même clé et de catégories
 * différentes ne coexistent pas, la contrainte d'unicité portant sur
 * (tenant_id, cle). Filtrer dessus ferait manquer une ligne à restituer.
 */

export type Restitution = () => Promise<void>;

/**
 * Relève les lignes visées et rend la fonction qui remet tout en place.
 *
 * À appeler AVANT la première écriture, et à invoquer dans un `finally` — sans
 * quoi un échec en cours de route laisse les valeurs du harnais en base, ce qui
 * est la moitié du défaut d'origine.
 */
export async function preserverParametres(
  tenant: string,
  cles: string[],
): Promise<Restitution> {
  const db = clientAdmin();

  // La ligne ENTIÈRE, pas seulement sa valeur.
  //
  // Un harnais peut supprimer la ligne en cours de route — `essai:gabarits`
  // éprouve précisément la transition « retouche -> défaut du code ». Restituer
  // par `update` ne retrouverait alors plus rien, et la valeur d'origine serait
  // perdue en silence. Il faut de quoi la RECRÉER : catégorie, type, libellé.
  const { data, error } = await db
    .from('parametres')
    .select('*')
    .eq('tenant_id', tenant)
    .in('cle', cles);

  // Relevé impossible = on ne sait pas ce qu'on écraserait. Refuser est la
  // seule issue sûre : continuer reviendrait à écrire à l'aveugle sur des
  // valeurs qu'on ne saura pas rendre.
  if (error) {
    throw new Error(`Relevé des paramètres impossible : ${error.message}`);
  }

  const avant = new Map<string, Record<string, unknown>>();
  for (const ligne of data ?? []) {
    if (ligne.cle) avant.set(ligne.cle, ligne as unknown as Record<string, unknown>);
  }

  if (avant.size > 0) {
    console.log(
      `        ${avant.size} valeur(s) déjà en base : relevée(s), elles seront restituées.`,
    );
  }

  return async () => {
    for (const cle of cles) {
      const origine = avant.get(cle);

      // Table rase d'abord, dans les deux cas : c'est la seule façon de rendre
      // l'état exact sans avoir à savoir si le harnais a modifié, supprimé ou
      // laissé la ligne en place.
      await db.from('parametres').delete().eq('tenant_id', tenant).eq('cle', cle);

      if (!origine) continue;

      // `id` et `created_at` sont réattribués : la ligne restituée porte la
      // même valeur, pas la même identité. Rien ne référence `parametres.id`.
      const { id: _id, created_at: _cree, updated_at: _maj, ...champs } = origine;

      const { error: erreurInsert } = await db
        .from('parametres')
        .insert(champs as never);

      if (erreurInsert) {
        // Bruyant, et volontairement : une restitution ratée laisse la
        // configuration de l'utilisateur amputée, ce qui est exactement le
        // défaut qu'on cherche à ne plus reproduire.
        console.error(
          `\n⚠ RESTITUTION MANQUÉE pour ${cle} : ${erreurInsert.message}\n` +
            `  Valeur d'origine : ${JSON.stringify(origine.valeur)}\n`,
        );
      }
    }
  };
}

/**
 * Contrôle que la restitution a bien eu lieu.
 *
 * Séparé de la restitution elle-même pour que chaque harnais l'affiche avec sa
 * propre fonction `verifier` — et parce qu'une restitution qu'on ne vérifie pas
 * est une promesse, pas une garantie.
 */
export async function etatRestitue(
  tenant: string,
  cles: string[],
): Promise<Map<string, string | null>> {
  const { data } = await clientAdmin()
    .from('parametres')
    .select('cle, valeur')
    .eq('tenant_id', tenant)
    .in('cle', cles);

  return new Map((data ?? []).map((l) => [l.cle as string, l.valeur]));
}
