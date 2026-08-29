/** Services externes partagés entre l'application web et le worker. */
export * from './env.js';
export { clientAdmin, tenantId, genererCode, type ClientAdmin } from './supabase.js';
export {
  chargerSecrets,
  oublierSecrets,
  etatDesCles,
  estCleGeree,
  masquer,
  CLES_GEREES,
  CATEGORIE_SECRET,
  type EtatCle,
  type CleGeree,
} from './secrets.js';
export {
  lireParametres,
  lireDrapeau,
  lireConditionsOffre,
  invaliderCacheParametres,
  CONDITIONS_OFFRE_DEFAUT,
  CLES_CONDITIONS,
  type ParametresMetier,
  type ConditionsOffre,
} from './parametres.js';

export {
  genererJson,
  genererTexte,
  fournisseurActif,
  chaineFournisseurs,
  assurerChaine,
  descriptionIA,
  iaConfiguree,
  listerModelesGroq,
  creerFournisseurOpenAI,
  NOMS_FOURNISSEURS,
  ErreurIA,
  ErreurQuotaIA,
  type FournisseurIA,
  type ModeleGroq,
  type OptionsGeneration,
  type ReglagesOpenAI,
} from './ai/index.js';
export { fournisseurGemini } from './ai/gemini.js';
export { fournisseurAnthropic } from './ai/anthropic.js';
export {
  fournisseurCompatible,
  fournisseurOpenAI,
  fournisseurOpenRouter,
} from './ai/openaiCompatible.js';
export { fournisseurGroq } from './ai/groq.js';
export * from './ai/prompts.js';
export {
  GABARITS,
  CODES_GABARIT,
  appliquerGabarit,
  validerGabarit,
  estCodeGabarit,
  cleGabarit,
  type CodeGabarit,
  type DefinitionGabarit,
} from './ai/gabarits.js';
export {
  lireGabarit,
  lireTousGabarits,
  invaliderCacheGabarits,
} from './ai/gabaritsStockes.js';

export {
  buildRfqHtml,
  buildRfqTexte,
  buildRelanceHtml,
  type OptionsRfq,
  type ParamsRelance,
} from './email/rfqHtml.js';
export {
  buildRelanceClientHtml,
  sujetRelanceClient,
  type ParamsRelanceClient,
} from './email/relanceClientHtml.js';
export {
  buildValidationHtml,
  sujetValidation,
  texteValidation,
  type ParamsValidation,
} from './email/validationHtml.js';
export {
  resoudreFournisseurs,
  normaliserMarque,
  type FournisseurResolu,
  type ResultatResolution,
} from './fournisseurs/sourcing.js';
export {
  genererConsultations,
  type ArticleDemande,
  type ResultatGeneration,
} from './fournisseurs/consultations.js';
export {
  lireLanguesChoisies,
  lireLanguesFournisseurs,
  definirLangueFournisseur,
  langueEffective,
} from './fournisseurs/langues.js';
export {
  MODELE_EMBEDDING,
  embedder,
  embedderLot,
  embeddingsConfigures,
  texteLigneDevis,
  DIMENSIONS,
  ErreurEmbedding,
} from './ai/embeddings.js';
export {
  initialesSuggerees,
  lireContacts,
  resoudreDestinataires,
  type ContactFournisseur,
  type Destinataires,
} from './fournisseurs/contacts.js';
export {
  compterVecteursPerimes,
  indexerDevis,
  indexerHistorique,
  type ResultatIndexation,
} from './fournisseurs/indexation.js';
export {
  chercherFournisseurs,
  type ArticleRecherche,
  type CouvertureArticle,
  SEUIL_CERTAIN,
  type FiabiliteFournisseur,
  type FournisseurPropose,
  type ResultatRechercheFournisseurs,
} from './fournisseurs/rechercheSemantique.js';

export {
  recupererPhotoProduit,
  type PhotoProduit,
} from './offres/photos.js';
export {
  boqVersMarkdown,
  verifierAnonymisation,
  FuiteDonneesInternes,
  type Boq,
  type ProduitBoq,
} from './offres/boq.js';

export {
  rechercher,
  scraper,
  firecrawlConfigure,
  ErreurFirecrawl,
  type ResultatRecherche,
} from './firecrawl/index.js';

export {
  genererOffre,
  lancerGeneration,
  consulterGeneration,
  gammaConfigure,
  ErreurGamma,
  type OffreGeneree,
} from './gamma/index.js';

export {
  envoyerEmail,
  construireMime,
  modifierLabelSuivi,
  gmailConfigure,
  ErreurGmail,
  verifierAcces as verifierAccesGmail,
  type CompteGmail,
  type MessageEnvoye,
  type PieceJointeEnvoi,
} from './email/gmail.js';

export {
  envoyer,
  marquerSuivi,
  verifierEnvoi,
  envoiConfigure,
  transportActif,
  descriptionEnvoi,
  type Transport,
} from './email/envoi.js';
export {
  smtpConfigure,
  smtpAdresse,
  verifierAccesSmtp,
  ErreurSmtp,
} from './email/smtp.js';

export {
  relverMessagesNonLus,
  imapConfigure,
  ErreurImap,
  verifierAcces as verifierAccesImap,
  type MessageEntrant,
  type PieceJointeBrute,
} from './email/imap.js';

export { estRebond } from './email/rebond.js';
export {
  estCourrierAutomatique,
  type VerdictAutomatique,
} from './email/automatique.js';

/*
 * WhatsApp — émetteur du circuit de validation.
 *
 * Utilisable dès qu'une clé est saisie dans /admin : `whatsappConfigure()` est
 * la garde, et tant qu'elle rend `false` l'appelant retombe sur le courriel.
 */
export {
  whatsappConfigure,
  descriptionWhatsApp,
  normaliserNumero,
  envoyerWhatsApp,
  verifierAccesWhatsApp,
  ErreurWhatsApp,
  type MessageWhatsApp,
} from './whatsapp/envoi.js';

/*
 * Telegram — second émetteur du circuit de validation.
 *
 * Ajouté le 2026-08-20 pendant que WhatsApp restait bloqué côté Meta (compte
 * Business non vérifié, carte bancaire refusée). Même garde de configuration
 * que WhatsApp : `telegramConfigure()` retombe sur le courriel tant que la clé
 * est absente.
 */
export {
  telegramConfigure,
  descriptionTelegram,
  envoyerTelegram,
  verifierAccesTelegram,
  ErreurTelegram,
  type MessageTelegram,
} from './telegram/envoi.js';
