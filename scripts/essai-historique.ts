/**
 * Éprouve l'historique d'affaire reconstruit par `lireStoryline`.
 *
 * Le point délicat n'est pas la lecture — c'est le recouvrement entre deux
 * natures de fait. Une colonne de date dit un état (« l'offre est partie le
 * 12 »), une ligne d'`audit_events` dit un acte (« Sophie a envoyé l'offre le
 * 12 »). Les deux décrivent le même instant et s'afficheraient en double.
 *
 * Ce harnais vérifie donc surtout que le dédoublonnage tient, que l'acte tracé
 * — celui qui porte l'auteur — l'emporte sur l'état déduit, et qu'un locataire
 * ne voit pas l'historique d'un autre.
 *
 * LECTURE SEULE : rien n'est écrit, rien n'est à nettoyer.
 *
 * Usage : npm run essai:historique
 */
import { lireStoryline } from '../apps/web/lib/documents/storyline.js';

import { chargerEnv } from './charger-env.js';

let echecs = 0;

function verifier(intitule: string, condition: boolean, detail = ''): void {
  console.log(`${condition ? '  ok  ' : ' ÉCHEC'}  ${intitule}${detail ? ` — ${detail}` : ''}`);
  if (!condition) echecs += 1;
}

async function rest<T>(chemin: string): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${url}/rest/v1/${chemin}`, {
    headers: { apikey: service!, Authorization: `Bearer ${service}` },
  });
  return (await r.json()) as T;
}

async function main(): Promise<void> {
  chargerEnv();

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('\n✗ Variables Supabase absentes.\n');
    process.exit(1);
  }

  const demandes = await rest<{ id: number; code: string; tenant_id: string }[]>(
    'demandes?select=id,code,tenant_id&order=id.desc&limit=40',
  );

  if (demandes.length === 0) {
    console.error('\n✗ Aucune demande en base : rien à éprouver.\n');
    process.exit(1);
  }

  const tenant = demandes[0]!.tenant_id;

  /* --- 1. L'affaire la plus fournie sert de cas d'essai -------------------- */

  console.log('\n=== Reconstruction ===');

  const historiques = await Promise.all(
    demandes.map(async (d) => ({ demande: d, evenements: await lireStoryline(tenant, d.id) })),
  );

  historiques.sort((a, b) => b.evenements.length - a.evenements.length);

  const cas = historiques[0]!;
  const { demande, evenements } = cas;

  console.log(`  affaire retenue : ${demande.code} (${evenements.length} événements)`);
  console.log(
    `  ${historiques.filter((h) => h.evenements.length > 0).length} affaires sur ${demandes.length} ont un historique non vide`,
  );

  verifier('l’affaire la plus fournie a un historique', evenements.length > 0);

  /* --- 2. Invariants de forme --------------------------------------------- */

  console.log('\n=== Forme ===');

  const datesInvalides = evenements.filter((e) => Number.isNaN(new Date(e.date).getTime()));
  verifier('toutes les dates sont lisibles', datesInvalides.length === 0, `${datesInvalides.length} invalide(s)`);

  const titresVides = evenements.filter((e) => !e.titre || !e.titre.trim());
  verifier('aucun intitulé vide', titresVides.length === 0, `${titresVides.length} vide(s)`);

  // Un événement sans date n'a pas eu lieu : il ne doit pas être inventé avec
  // la date du jour, ce qui le placerait faussement en tête.
  const dansLeFutur = evenements.filter((e) => new Date(e.date).getTime() > Date.now() + 60_000);
  verifier('aucun événement daté du futur', dansLeFutur.length === 0, `${dansLeFutur.length} en avance`);

  /* --- 3. Tri ------------------------------------------------------------- */

  console.log('\n=== Tri ===');

  let desordre = 0;
  for (let i = 1; i < evenements.length; i += 1) {
    const avant = new Date(evenements[i - 1]!.date).getTime();
    const apres = new Date(evenements[i]!.date).getTime();
    if (apres > avant) desordre += 1;
  }

  verifier('du plus récent au plus ancien', desordre === 0, `${desordre} inversion(s)`);

  /* --- 4. Dédoublonnage --------------------------------------------------- */

  console.log('\n=== Dédoublonnage acte / état ===');

  // Deux lignes de même intitulé au même instant, c'est l'acte et l'état non
  // fusionnés : exactement ce que la clé doit empêcher.
  const empreintes = new Map<string, number>();
  for (const e of evenements) {
    const cle = `${e.categorie}|${e.titre}|${e.date}`;
    empreintes.set(cle, (empreintes.get(cle) ?? 0) + 1);
  }

  const doublons = [...empreintes.entries()].filter(([, n]) => n > 1);
  verifier(
    'aucun doublon exact',
    doublons.length === 0,
    doublons.map(([c, n]) => `${c} ×${n}`).join(' ; '),
  );

  // Le cas qui a motivé la clé : l'envoi d'une demande de devis produit TROIS
  // écritures — la date sur la consultation, l'acte dans `audit_events`, le
  // courriel dans `communications`. Une seule ligne doit sortir, et elle doit
  // porter à la fois le fournisseur (de la date), l'auteur (de l'acte) et le
  // lien de relecture.
  const consultations = await rest<{ id: number }[]>(
    `consultations?select=id&demande_id=eq.${demande.id}&date_envoi_reelle=not.is.null`,
  );

  const actesEnvoi = await rest<{ entite_id: number }[]>(
    `audit_events?select=entite_id&entite=eq.consultations&action=eq.consultation.envoyee&entite_id=in.(${
      consultations.map((c) => c.id).join(',') || '0'
    })`,
  );

  const courrielsEnvoi = await rest<{ id: number }[]>(
    `communications?select=id&demande_id=eq.${demande.id}&type=eq.demande_devis`,
  );

  if (actesEnvoi.length > 0 || courrielsEnvoi.length > 0) {
    // L'intitulé retenu est celui de l'état déduit, seul à nommer le
    // fournisseur. Les deux autres formulations ne doivent plus apparaître.
    const fusionnees = evenements.filter((e) => e.titre.startsWith('Demande de devis — '));
    const survivants = evenements.filter(
      (e) => e.titre === 'Demande de devis envoyée' || e.titre === 'Demande de devis au fournisseur',
    );

    console.log(
      `  ${consultations.length} consultation(s) datée(s), ${actesEnvoi.length} acte(s), ${courrielsEnvoi.length} courriel(s)`,
    );

    verifier(
      'une seule ligne par envoi',
      fusionnees.length === consultations.length,
      `${fusionnees.length} ligne(s) pour ${consultations.length} consultation(s)`,
    );

    verifier(
      'aucune formulation concurrente ne subsiste',
      survivants.length === 0,
      `${survivants.length} ligne(s) non fusionnée(s)`,
    );

    const orphelines = fusionnees.filter((e) => !e.acteur);
    verifier(
      'chaque envoi fusionné a repris l’auteur de l’acte',
      actesEnvoi.length === 0 || orphelines.length === 0,
      `${orphelines.length} sans auteur`,
    );
  } else {
    console.log('  ~~    aucun envoi de demande de devis sur cette affaire');
  }

  /* --- 5. Sources effectivement branchées --------------------------------- */

  console.log('\n=== Sources ===');

  const familles = new Set(evenements.map((e) => e.categorie));
  console.log(`  familles présentes : ${[...familles].sort().join(', ') || '—'}`);

  const echanges = await rest<{ id: number }[]>(
    `communications?select=id&demande_id=eq.${demande.id}`,
  );

  verifier(
    'les échanges remontent',
    echanges.length === 0 || familles.has('echange'),
    `${echanges.length} en base`,
  );

  // L'auteur est ce que `audit_events` apporte et que les colonnes de date
  // n'ont pas : sans lui, la jointure sur `users` est muette.
  const avecActeur = evenements.filter((e) => e.acteur);
  const actesEnBase = await rest<{ id: number }[]>(
    `audit_events?select=id&entite=eq.demandes&entite_id=eq.${demande.id}&limit=1`,
  );

  verifier(
    'les actes tracés nomment leur auteur',
    actesEnBase.length === 0 || avecActeur.length > 0,
    `${avecActeur.length} événement(s) attribué(s)`,
  );

  /* --- 6. Lisibilité ------------------------------------------------------ */

  console.log('\n=== Lisibilité ===');

  // Sans hiérarchie, l'écran affiche trente-quatre lignes du même poids et
  // l'œil n'a aucune prise. Le partage doit rester déséquilibré : si presque
  // tout devenait majeur, il ne hiérarchiserait plus rien.
  const majeurs = evenements.filter((e) => e.importance === 'majeur');
  const courants = evenements.filter((e) => e.importance === 'courant');

  verifier(
    'les deux poids sont représentés',
    majeurs.length > 0 && courants.length > 0,
    `${majeurs.length} majeur(s), ${courants.length} courant(s)`,
  );

  // Le seuil est haut à dessein : une affaire menée sans accroc est FAITE de
  // faits décisifs, et il serait faux d'exiger une majorité de manœuvres. Ce
  // qu'on refuse, c'est la dérive où tout redevient majeur et où la hiérarchie
  // ne distingue plus rien.
  verifier(
    'la hiérarchie distingue encore quelque chose',
    majeurs.length <= evenements.length * 0.75,
    `${Math.round((majeurs.length / evenements.length) * 100)} % de majeurs`,
  );

  // Les avis de non-remise arrivaient en anglais, typés comme un rebond
  // ordinaire. Ils expliquent un silence : ils doivent être nommés et pesés.
  const daemons = await rest<{ id: number }[]>(
    `communications?select=id&demande_id=eq.${demande.id}&expediteur=ilike.*mailer-daemon*`,
  );

  if (daemons.length > 0) {
    const avis = evenements.filter((e) => e.titre === 'Avis de non-remise');

    verifier(
      `${daemons.length} avis de non-remise nommé(s) en français`,
      avis.length > 0,
      `${avis.length} reconnu(s)`,
    );

    verifier(
      'un avis de non-remise est un fait majeur',
      avis.every((e) => e.importance === 'majeur'),
    );

    const jargon = evenements.filter((e) =>
      /delivery status notification|mailer-daemon/i.test(e.detail ?? ''),
    );
    verifier('aucun jargon de serveur en détail', jargon.length === 0, `${jargon.length} ligne(s)`);
  }

  // Le sujet servait de détail avec ses préfixes de fil et l'adresse recollée
  // derrière : la même chaîne de trente caractères sur chaque ligne.
  const prefixes = evenements.filter((e) => /^\s*(re|ré|fwd?|tr)\s*:/i.test(e.detail ?? ''));
  verifier('aucun préfixe « Re: » résiduel', prefixes.length === 0, `${prefixes.length} ligne(s)`);

  const adresses = evenements.filter((e) => (e.detail ?? '').includes('@'));
  verifier(
    'aucune adresse recopiée dans le détail',
    adresses.length === 0,
    adresses.map((e) => e.titre).join(', '),
  );

  /* --- 7. Cloisonnement --------------------------------------------------- */

  console.log('\n=== Cloisonnement ===');

  const autreTenant = await lireStoryline(
    '00000000-0000-0000-0000-000000000000',
    demande.id,
  );

  verifier(
    'un autre locataire ne voit rien de cette affaire',
    autreTenant.length === 0,
    `${autreTenant.length} événement(s) fuité(s)`,
  );

  const inexistante = await lireStoryline(tenant, 999_999_999);
  verifier('une affaire inexistante rend un historique vide', inexistante.length === 0);

  /* --- Bilan -------------------------------------------------------------- */

  console.log(
    `\n${echecs === 0 ? `✓ Historique cohérent sur ${demande.code}.` : `✗ ${echecs} ÉCHEC(S).`}\n`,
  );

  if (echecs > 0) process.exit(1);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
