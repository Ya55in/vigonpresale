/**
 * Catalogue des prompts, sous forme de gabarits modifiables depuis /admin.
 *
 * Les prompts étaient auparavant des littéraux de gabarit TypeScript. Les rendre
 * modifiables impose de séparer le texte de sa substitution : le texte devient
 * une chaîne à variables `{{nom}}`, stockée en base quand l'administrateur l'a
 * retouchée, et le code ne fournit plus que les valeurs.
 *
 * Chaque gabarit déclare les variables qu'il DOIT contenir. Un prompt
 * d'extraction privé de `{{contenu}}` produirait une réponse plausible sur un
 * contenu vide — c'est-à-dire une invention. La vérification est donc faite à
 * l'enregistrement, avant que le job ne tourne dessus.
 */

export type CodeGabarit =
  | 'specifications'
  | 'rfq'
  | 'classification'
  | 'extraction_devis'
  | 'description_produit'
  | 'synthese_offre'
  | 'sourcing_fournisseur';

export type DefinitionGabarit = {
  code: CodeGabarit;
  libelle: string;
  /** Ce que ce prompt fait dans le flux, pour l'écran d'administration. */
  role: string;
  /** Variables obligatoires : leur absence casse le prompt, pas seulement son style. */
  variablesRequises: string[];
  /** Variables acceptées mais non obligatoires. */
  variablesOptionnelles: string[];
  defaut: string;
};

/* ------------------------------------------------------------------------- */
/* Gabarits par défaut                                                        */
/* ------------------------------------------------------------------------- */

const SPECIFICATIONS = `Tu es un ingénieur avant-vente IT. Analyse la demande client ci-dessous et extrais les articles demandés.

Réponds UNIQUEMENT avec un objet JSON de cette forme :
{
  "client": { "nom": string|null, "email": string|null, "contact": string|null },
  "titre_projet": string,
  "deadline_souhaitee": "YYYY-MM-DD"|null,
  "articles": [
    {
      "ligne_num": number,
      "designation": string,
      "reference": string|null,
      "marque": string,
      "fabricant": string|null,
      "quantite": number,
      "unite": string,
      "categorie": string|null,
      "specifications": string|null,
      "confiance": number
    }
  ]
}

RÈGLES D'EXTRACTION :
- Une ligne par produit distinct. Ne regroupe jamais deux produits différents.
- "marque" est le FABRICANT. Déduis-le de la référence s'il n'est pas explicite.
  Exemples : "C9200L" -> Cisco | "UniFi" -> Ubiquiti | "Smart-UPS" -> APC
             "P2723DE" -> Dell | "Rally Bar" -> Logitech
- Si plusieurs marques sont proposées en alternative, retiens la première citée.
- Si aucune marque n'est identifiable, écris exactement "Non specifie".
- "quantite" est un NOMBRE, jamais du texte. Si elle n'est pas précisée, mets 1.
- N'invente JAMAIS un produit absent de la demande.
- "confiance" est un nombre entre 0 et 1 traduisant ta certitude sur la ligne.

DEMANDE CLIENT :
"""
{{contenu}}
"""`;

const RFQ = `Tu rédiges une demande de devis professionnelle en {{langue}}, adressée au fournisseur « {{nomFournisseur}} » pour du matériel de marque {{marque}}.

Réponds UNIQUEMENT avec un objet JSON de cette forme :
{
  "sujet": string,
  "intro": string,
  "transition": string,
  "articles": [string],
  "questions_intro": string,
  "questions": [string],
  "cloture": string
}

LANGUE DE RÉDACTION — RÈGLE ABSOLUE :
- Tous les textes des champs ci-dessus sont rédigés en {{langue}}, y compris le sujet.
- Les désignations et références de produits restent inchangées, telles que fournies.

ANONYMISATION — RÈGLE ABSOLUE :
- Ne cite JAMAIS le nom du client final, même s'il apparaît ci-dessous.
- Ne reprends aucune signature ni coordonnée du message d'origine.
- Présente le projet comme « un projet pour l'un de nos clients ».

CONTENU :
- "articles" reprend chaque ligne sous forme lisible, quantité incluse.
- "questions" doit couvrir au minimum : prix unitaire HT par référence,
  délai de livraison, durée de validité de l'offre, conditions de paiement.
- Ton professionnel et concis. Pas de HTML, pas de Markdown, texte brut.

MATÉRIEL CONCERNÉ :
{{articles}}`;

const CLASSIFICATION = `Classe le message fournisseur ci-dessous.

Réponds UNIQUEMENT avec : {"nature": "..."} où nature vaut exactement l'une de :
- "DEVIS_RECU"        : des prix ou montants sont présents quelque part (corps ou pièce jointe).
- "DEMANDE_PRECISION" : un humain répond sans donner de prix, OU annonce une pièce jointe illisible.
- "AUTOMATIQUE"       : message d'absence, boîte pleine, accusé de réception, newsletter.

RÈGLE CRITIQUE : si le message annonce « voici le devis ci-joint » mais que la
pièce jointe est illisible ou absente du contenu fourni, réponds
"DEMANDE_PRECISION" — jamais "AUTOMATIQUE".

MESSAGE :
"""
{{contenu}}
"""`;

const EXTRACTION_DEVIS = `Extrais les informations du devis fournisseur ci-dessous.

Réponds UNIQUEMENT avec un objet JSON de cette forme :
{
  "numero_devis": string|null,
  "date_devis": "YYYY-MM-DD"|null,
  "devise": string,
  "validite": string|null,
  "delai_livraison": string|null,
  "conditions_paiement": string|null,
  "garantie": string|null,
  "lignes": [
    {
      "designation": string,
      "reference": string|null,
      "quantite": number,
      "prix_achat_ht": number|null,
      "remise_pct": number|null,
      "tva_pct": number|null,
      "disponibilite": string|null,
      "confiance": number
    }
  ]
}

RÈGLES :
- "prix_achat_ht" est le prix UNITAIRE hors taxes.
- Si seul un total de ligne est donné, DIVISE-le par la quantité.
- N'invente JAMAIS un prix manquant : mets null et baisse "confiance".
- "devise" par défaut "MAD" si rien n'est précisé.
- "confiance" est un nombre entre 0 et 1 par ligne.
- "garantie" : recopie la durée ET ses réserves telles qu'écrites (« 2 ans
  retour atelier »). null si le devis n'en mentionne aucune — ne déduis jamais
  une garantie de la seule marque du matériel.

DEVIS :
"""
{{contenu}}
"""`;

const DESCRIPTION_PRODUIT = `Rédige une description commerciale en français pour le produit ci-dessous, destinée à une offre client.

Réponds UNIQUEMENT avec un objet JSON de cette forme :
{ "description_technique": string, "points_cles": [string] }

RÈGLES :
- Parle BÉNÉFICES pour le client, pas jargon fournisseur.
- 2 à 4 phrases pour "description_technique".
- 3 à 5 entrées courtes dans "points_cles".
- N'invente aucune caractéristique absente des spécifications fournies.

PRODUIT :
- Désignation : {{designation}}
- Marque : {{marque}}
- Référence : {{reference}}
- Spécifications : {{specifications}}`;

const SYNTHESE_OFFRE = `Rédige la synthèse d'une offre commerciale en français pour le projet « {{titreProjet}} ».

Réponds UNIQUEMENT avec un objet JSON de cette forme :
{
  "titre": string,
  "resume": string,
  "tableau_explicatif": [ { "besoin": string, "solution_proposee": string, "benefice": string } ]
}

RÈGLES :
- "resume" fait 3 à 5 phrases, orienté valeur pour le client.
- "tableau_explicatif" contient 2 à 5 lignes reliant un besoin à la solution.
- Ne cite JAMAIS de fournisseur, de prix d'achat ni de taux de marge.

MATÉRIEL PROPOSÉ :
{{produits}}`;

const SOURCING_FOURNISSEUR = `À partir du contenu web ci-dessous, identifie le distributeur de la marque {{marque}} et son adresse e-mail de contact commercial.

Réponds UNIQUEMENT avec un objet JSON de cette forme :
{ "nom": string, "email": string, "site": string|null }

RÈGLES :
- "email" doit être une adresse de contact commercial réelle et complète.
- N'invente JAMAIS une adresse. Si aucune n'est trouvable, mets "" dans "email".
- Écarte les adresses techniques (noreply, no-reply, postmaster) et les noms de fichiers image.

CONTENU WEB :
"""
{{contenu}}
"""`;

/* ------------------------------------------------------------------------- */
/* Catalogue                                                                  */
/* ------------------------------------------------------------------------- */

export const GABARITS: Record<CodeGabarit, DefinitionGabarit> = {
  specifications: {
    code: 'specifications',
    libelle: 'Extraction des besoins client',
    role: "Lit le courriel du client et ses pièces jointes, et en tire la liste des articles demandés.",
    variablesRequises: ['contenu'],
    variablesOptionnelles: [],
    defaut: SPECIFICATIONS,
  },
  rfq: {
    code: 'rfq',
    libelle: 'Rédaction des demandes de devis',
    role: "Rédige la demande envoyée au fournisseur, dans sa langue de correspondance.",
    variablesRequises: ['articles', 'langue'],
    variablesOptionnelles: ['marque', 'nomFournisseur'],
    defaut: RFQ,
  },
  classification: {
    code: 'classification',
    libelle: 'Classement des réponses fournisseurs',
    role: "Décide si un message entrant contient un devis, demande une précision, ou est automatique.",
    variablesRequises: ['contenu'],
    variablesOptionnelles: [],
    defaut: CLASSIFICATION,
  },
  extraction_devis: {
    code: 'extraction_devis',
    libelle: 'Extraction des lignes de devis',
    role: "Tire les prix, remises et délais du devis reçu, pour alimenter le comparatif.",
    variablesRequises: ['contenu'],
    variablesOptionnelles: [],
    defaut: EXTRACTION_DEVIS,
  },
  description_produit: {
    code: 'description_produit',
    libelle: "Descriptions produits de l'offre",
    role: "Rédige la description commerciale de chaque produit présenté au client.",
    variablesRequises: ['designation'],
    variablesOptionnelles: ['marque', 'reference', 'specifications'],
    defaut: DESCRIPTION_PRODUIT,
  },
  synthese_offre: {
    code: 'synthese_offre',
    libelle: "Synthèse de l'offre",
    role: "Rédige le résumé et le tableau besoin/solution en tête de l'offre.",
    variablesRequises: ['produits'],
    variablesOptionnelles: ['titreProjet'],
    defaut: SYNTHESE_OFFRE,
  },
  sourcing_fournisseur: {
    code: 'sourcing_fournisseur',
    libelle: 'Sourcing des fournisseurs',
    role: "Identifie le distributeur d'une marque et son adresse commerciale depuis une page web.",
    variablesRequises: ['contenu'],
    variablesOptionnelles: ['marque'],
    defaut: SOURCING_FOURNISSEUR,
  },
};

export const CODES_GABARIT = Object.keys(GABARITS) as CodeGabarit[];

export function estCodeGabarit(valeur: unknown): valeur is CodeGabarit {
  return typeof valeur === 'string' && valeur in GABARITS;
}

/** Clé de stockage dans la table `parametres`. */
export function cleGabarit(code: CodeGabarit): string {
  return `prompt_${code}`;
}

/* ------------------------------------------------------------------------- */
/* Substitution                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Remplace les `{{variables}}` par leurs valeurs.
 *
 * Une variable inconnue au gabarit est ignorée sans bruit ; une variable du
 * gabarit sans valeur fournie devient une chaîne vide plutôt que de laisser
 * `{{contenu}}` partir tel quel chez le modèle, ce qui l'inviterait à broder.
 */
export function appliquerGabarit(
  gabarit: string,
  variables: Record<string, string | number | null | undefined>,
): string {
  return gabarit.replace(/\{\{(\w+)\}\}/g, (_correspondance, nom: string) => {
    const valeur = variables[nom];
    return valeur === null || valeur === undefined ? '' : String(valeur);
  });
}

/**
 * Vérifie qu'un gabarit retouché reste utilisable.
 *
 * Appelé à l'enregistrement depuis /admin : mieux vaut refuser la sauvegarde
 * que découvrir en production qu'un job extrait des données d'un contenu vide.
 */
export function validerGabarit(
  code: CodeGabarit,
  texte: string,
): { ok: true } | { ok: false; motif: string } {
  const definition = GABARITS[code];
  const nettoye = texte.trim();

  if (nettoye.length < 30) {
    return { ok: false, motif: 'Le prompt est trop court pour être exploitable.' };
  }
  if (nettoye.length > 20_000) {
    return { ok: false, motif: 'Le prompt dépasse 20 000 caractères.' };
  }

  const presentes = new Set<string>(
    [...nettoye.matchAll(/\{\{(\w+)\}\}/g)]
      .map((correspondance) => correspondance[1])
      .filter((nom): nom is string => nom !== undefined),
  );

  const manquantes = definition.variablesRequises.filter((v) => !presentes.has(v));
  if (manquantes.length > 0) {
    return {
      ok: false,
      motif: `Variable(s) obligatoire(s) absente(s) : ${manquantes
        .map((v) => `{{${v}}}`)
        .join(', ')}.`,
    };
  }

  const connues = new Set([
    ...definition.variablesRequises,
    ...definition.variablesOptionnelles,
  ]);
  const inconnues = [...presentes].filter((v) => !connues.has(v));
  if (inconnues.length > 0) {
    return {
      ok: false,
      motif: `Variable(s) inconnue(s) : ${inconnues
        .map((v) => `{{${v}}}`)
        .join(', ')}. Elles resteraient vides à l'exécution.`,
    };
  }

  return { ok: true };
}
