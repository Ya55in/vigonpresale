/** Contrat commun aux fournisseurs d'inférence (Gemini, Groq). */

export class ErreurIA extends Error {
  constructor(
    message: string,
    readonly contexte: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ErreurIA';
  }
}

/**
 * Quota épuisé côté fournisseur.
 *
 * `permanent` distingue le throttling passager — on patiente et on réessaie —
 * du quota structurellement nul, où insister ne sert à rien : le problème est
 * dans la configuration du compte, pas dans l'appel.
 */
export class ErreurQuotaIA extends ErreurIA {
  constructor(
    message: string,
    readonly permanent: boolean,
    contexte: Record<string, unknown> = {},
  ) {
    super(message, contexte);
    this.name = 'ErreurQuotaIA';
  }
}

/** Diagnostic d'un échec d'appel, interprété par chaque fournisseur. */
export type DiagnosticErreur = {
  quota: boolean;
  permanent: boolean;
  delaiMs: number;
};

export type FournisseurIA = {
  /** Identifiant lisible, journalisé et affiché par le script de test. */
  readonly nom: string;
  /** Modèle effectivement utilisé, pour les logs et le script de test. */
  modeleUtilise(): string;
  estConfigure(): boolean;
  /** `json` force le mode sortie structurée quand le fournisseur le propose. */
  completer(prompt: string, options: { json: boolean }): Promise<string>;
  analyserErreur(e: unknown): DiagnosticErreur;
};
