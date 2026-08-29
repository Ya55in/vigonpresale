/**
 * Adresse publique de l'application.
 *
 * Elle vivait en huit exemplaires sous la forme
 * `process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'`, dont la
 * génération des liens d'offre, de devis et de validation.
 *
 * Ce repli est sans danger en développement et redoutable en production : une
 * variable oubliée à la mise en ligne, et tous les liens envoyés aux clients et
 * aux fournisseurs pointent vers la machine du destinataire. Rien ne casse au
 * démarrage, rien n'apparaît dans les journaux — les messages partent, et
 * personne ne répond. C'est le pire mode de défaillance : silencieux et
 * irrattrapable, les courriels étant déjà partis.
 *
 * D'où la règle : en production, l'absence de la variable ARRÊTE le processus.
 * Un échec au démarrage se voit et se corrige en deux minutes.
 */

/** Vrai en production, quel que soit l'hôte : Next et le worker le renseignent. */
const enProduction = (): boolean => process.env.NODE_ENV === 'production';

/**
 * Normalise une valeur saisie à la main dans un tableau de bord d'hébergeur.
 *
 * Trois formes arrivent pour la même intention, et deux produisaient des liens
 * cassés que personne ne voyait avant qu'un client ne clique :
 *
 *   vigon-web.onrender.com          → sans schéma, `https://` est ajouté
 *   https://vigon-web.onrender.com/ → barre finale retirée
 *   http://vigon-web.onrender.com   → laissé tel quel, c'est un choix explicite
 *
 * Le schéma manquant est le cas le plus fréquent : un hébergeur affiche son
 * domaine sans schéma, et on recopie ce qu'on voit. Un lien
 * `vigon-web.onrender.com/offre/…` dans un courriel n'est pas une adresse, et
 * l'erreur n'apparaît qu'à l'ouverture, chez le client.
 */
function normaliser(brut: string): string {
  const sansBarre = brut.replace(/\/+$/, '');
  return /^https?:\/\//i.test(sansBarre) ? sansBarre : `https://${sansBarre}`;
}

export function urlApplication(): string {
  const brut = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (brut) return normaliser(brut);

  if (enProduction()) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL est absente. En production, elle est obligatoire : ' +
        'sans elle, les liens envoyés aux clients et aux fournisseurs pointeraient ' +
        'vers localhost.',
    );
  }

  return 'http://localhost:3000';
}
