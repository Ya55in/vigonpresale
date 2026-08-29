import { redirect } from 'next/navigation';

import {
  ConditionsOffre,
  type ChampCondition,
} from '@/components/admin/ConditionsOffre';
import { EcranAdmin, type ParametreAdmin } from '@/components/admin/EcranAdmin';
import { GestionCles } from '@/components/admin/GestionCles';
import { GestionPrompts } from '@/components/admin/GestionPrompts';
import { requireUser } from '@/lib/auth/guards';
import { roleHasPermission } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';

/** Paramètres exposés, avec leur libellé et leur aide de lecture. */
const CATALOGUE: Omit<ParametreAdmin, 'valeur'>[] = [
  {
    cle: 'seuil_validation_finance_marge_min',
    libelle: 'Marge minimale avant escalade',
    unite: '%',
    aide: 'En dessous, l’avant-vente doit soumettre le costing à FINANCE.',
  },
  {
    cle: 'seuil_validation_finance_montant',
    libelle: 'Plafond avant escalade FINANCE',
    unite: 'MAD TTC',
    aide: 'Au-delà, la validation FINANCE devient obligatoire.',
  },
  {
    cle: 'marge_defaut_pct',
    libelle: 'Marge par défaut',
    unite: '%',
    aide: 'Proposée à la construction d’une feuille de coûts.',
  },
  {
    cle: 'tva_pct',
    libelle: 'TVA',
    unite: '%',
    aide: 'Appliquée aux nouvelles feuilles de coûts.',
  },
  {
    cle: 'delai_relance_heures',
    libelle: 'Délai entre relances',
    unite: 'heures',
    aide: 'Attente avant de relancer un fournisseur silencieux.',
  },
  {
    cle: 'max_relances',
    libelle: 'Nombre maximal de relances',
    unite: 'relances',
    aide: 'Au-delà, la consultation passe en « sans réponse ».',
  },
  {
    cle: 'delai_expiration_offre',
    libelle: 'Validité des offres',
    unite: 'jours',
    aide: 'Durée après laquelle une offre non décidée expire.',
  },
  {
    cle: 'delai_relance_client_jours',
    libelle: 'Relance du client avant échéance',
    unite: 'jours',
    aide: 'Le client est relancé ce nombre de jours avant expiration. 0 désactive la relance.',
  },
];

export default async function Page() {
  const utilisateur = await requireUser();

  // ADMIN gère tout ; FINANCE accède aux seuils, dont la spec lui confie la
  // définition. Les autres rôles n'ont rien à faire ici.
  const gereUtilisateurs = utilisateur.role === 'admin';
  const peutReglerSeuils = roleHasPermission(utilisateur.role, 'marge.definir_seuils');

  if (!gereUtilisateurs && !peutReglerSeuils) redirect('/403');

  const db = createAdminClient();

  const [{ data: utilisateurs }, { data: parametres }] = await Promise.all([
    db
      .from('users')
      .select('id, email, prenom, nom, role, actif, auth_user_id, telephone, telegram_chat_id, recoit_validations')
      .eq('tenant_id', utilisateur.tenant_id)
      .order('role', { ascending: true }),
    db
      .from('parametres')
      .select('cle, valeur')
      .eq('tenant_id', utilisateur.tenant_id)
      // Les secrets ont leur propre écran : les mêler aux paramètres métier
      // ferait passer une clé par Number() et la stockerait en NaN.
      .neq('categorie', 'secret'),
  ]);

  const {
    lireParametres,
    etatDesCles,
    chargerSecrets,
    lireConditionsOffre,
    lireTousGabarits,
    GABARITS,
  } = await import('@vigon/services');

  // Les clés en base priment : on les charge avant de lire l'état, sinon
  // l'écran afficherait la variable d'environnement comme source active.
  await chargerSecrets(utilisateur.tenant_id, { force: true });

  const { validationObligatoire: lireValidationObligatoire } = await import(
    '@/lib/validation/circuit'
  );
  const validationObligatoire = await lireValidationObligatoire(utilisateur.tenant_id);

  const [effectifs, cles, conditions, gabarits] = await Promise.all([
    lireParametres(utilisateur.tenant_id),
    gereUtilisateurs ? etatDesCles(utilisateur.tenant_id) : Promise.resolve([]),
    lireConditionsOffre(utilisateur.tenant_id),
    // Les prompts pilotent extraction et rédaction : réservés à ADMIN, comme
    // les clés. FINANCE règle les seuils, pas le comportement du modèle.
    gereUtilisateurs ? lireTousGabarits(utilisateur.tenant_id) : Promise.resolve([]),
  ]);

  const parEnBase = new Map(
    (parametres ?? []).map((p) => [p.cle, Number(p.valeur)]),
  );

  // Un paramètre absent de la base retombe sur la valeur effective (env ou
  // défaut du code) : le champ montre ainsi ce qui s'applique réellement,
  // et non un zéro trompeur.
  const EFFECTIFS: Record<string, number> = {
    seuil_validation_finance_marge_min: effectifs.seuilValidationFinanceMargeMin,
    seuil_validation_finance_montant: effectifs.seuilValidationFinanceMontant,
    marge_defaut_pct: effectifs.margeDefautPct,
    tva_pct: effectifs.tvaPct,
    delai_relance_heures: effectifs.delaiRelanceHeures,
    max_relances: effectifs.maxRelances,
    delai_expiration_offre: effectifs.delaiExpirationOffreJours,
    delai_relance_client_jours: effectifs.delaiRelanceClientJours,
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {gereUtilisateurs ? 'Administration' : 'Paramètres financiers'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Les valeurs affichées sont celles réellement appliquées : base de données
          d&apos;abord, puis variable d&apos;environnement, puis défaut du code.
        </p>
      </div>

      {/* Les clés ouvrent l'accès à des services facturés et à la boîte mail :
          réservées à ADMIN, jamais exposées à FINANCE. */}
      {gereUtilisateurs && <GestionCles cles={cles} />}

      <EcranAdmin
        validationObligatoire={validationObligatoire}
        utilisateurs={(utilisateurs ?? []).map((u) => ({
          id: u.id,
          email: u.email,
          nomComplet: [u.prenom, u.nom].filter(Boolean).join(' ') || u.email,
          role: u.role,
          actif: u.actif ?? false,
          // Un compte invité n'a pas encore de auth_user_id : il ne s'est
          // jamais connecté.
          rattache: u.auth_user_id !== null,
          telephone: u.telephone,
          telegramChatId: u.telegram_chat_id,
          recoitValidations: u.recoit_validations ?? false,
        }))}
        parametres={CATALOGUE.map((p) => ({
          ...p,
          valeur: parEnBase.get(p.cle) ?? EFFECTIFS[p.cle] ?? 0,
        }))}
        gereUtilisateurs={gereUtilisateurs}
        moiMeme={utilisateur.id}
      />

      <ConditionsOffre
        conditions={(['livraison', 'paiement', 'garantie'] as ChampCondition[]).map(
          (champ) => ({ champ, valeur: conditions[champ] }),
        )}
      />

      {gereUtilisateurs && (
        <GestionPrompts
          prompts={gabarits.map((g) => ({
            code: g.code,
            libelle: GABARITS[g.code].libelle,
            role: GABARITS[g.code].role,
            texte: g.texte,
            personnalise: g.personnalise,
            variablesRequises: GABARITS[g.code].variablesRequises,
            variablesOptionnelles: GABARITS[g.code].variablesOptionnelles,
          }))}
        />
      )}
    </div>
  );
}
