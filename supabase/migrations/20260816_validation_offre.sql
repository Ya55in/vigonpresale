-- Circuit d'approbation avant génération de l'offre.
--
-- La spec le décrit via l'API WhatsApp. Le canal n'est qu'un transport : ce qui
-- compte est la demande de validation, son lien de consultation et la décision
-- explicite qui débloque la génération. Tout cela fonctionne sans WhatsApp, et
-- le jour où le compte Business existe, il devient un émetteur de plus à côté
-- du courriel.
--
-- OPTIONNEL PAR DÉFAUT. Rendre la validation obligatoire d'emblée bloquerait
-- toute génération d'offre tant que personne n'a approuvé — y compris sur les
-- dossiers en cours. Le paramètre `validation_offre_obligatoire` vit dans
-- `parametres` et vaut `false` : sans lui, le flux actuel est inchangé.

create table if not exists public.validations_offre (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,

  demande_id bigint not null references public.demandes (id) on delete cascade,
  -- La feuille verrouillée dont on demande l'accord : c'est elle qui porte les
  -- montants soumis, et une nouvelle version exige une nouvelle validation.
  cost_sheet_id bigint not null references public.cost_sheets (id) on delete cascade,

  -- Même construction que les jetons d'offre et de devis : 24 octets, base64url.
  -- Il EST l'autorisation du lien de consultation.
  token_public text not null,

  statut text not null default 'en_attente',

  -- Canal réellement emprunté, pour savoir par où la demande est partie quand
  -- plusieurs coexistent.
  canal text not null default 'email',

  demande_par uuid references public.users (id) on delete set null,
  decide_par uuid references public.users (id) on delete set null,

  -- Montants figés à la soumission : si la feuille bouge après coup, la
  -- décision doit rester lisible telle qu'elle a été prise.
  total_ht numeric(14, 2) not null default 0,
  total_ttc numeric(14, 2) not null default 0,
  marge_pct numeric(6, 2),
  devise text not null default 'MAD',

  motif_refus text,
  date_demande timestamptz not null default now(),
  date_decision timestamptz,
  -- Une demande sans réponse ne doit pas bloquer indéfiniment : passé cette
  -- date, l'écran la signale comme caduque.
  date_expiration timestamptz,

  created_at timestamptz not null default now()
);

alter table public.validations_offre
  drop constraint if exists validations_offre_statut_check;

alter table public.validations_offre
  add constraint validations_offre_statut_check
  check (statut in ('en_attente', 'approuvee', 'refusee', 'expiree'));

alter table public.validations_offre
  drop constraint if exists validations_offre_canal_check;

-- `whatsapp` est déclaré dès maintenant : la contrainte n'aura pas à changer le
-- jour du branchement, seul l'émetteur s'ajoutera.
alter table public.validations_offre
  add constraint validations_offre_canal_check
  check (canal in ('email', 'whatsapp', 'interne'));

create unique index if not exists validations_offre_token_key
  on public.validations_offre (token_public);

-- Une seule demande en attente par feuille : sans cette garde, deux clics
-- successifs enverraient deux liens dont un seul serait honoré.
create unique index if not exists validations_offre_une_en_attente
  on public.validations_offre (cost_sheet_id)
  where statut = 'en_attente';

create index if not exists validations_offre_suivi_idx
  on public.validations_offre (tenant_id, statut, date_demande desc);

-- RLS déclaré, sans politique : refus par défaut, comme les autres tables.
alter table public.validations_offre enable row level security;

comment on table public.validations_offre is
  'Demandes d''approbation avant génération d''offre. Le canal (courriel, WhatsApp) n''est qu''un transport.';
