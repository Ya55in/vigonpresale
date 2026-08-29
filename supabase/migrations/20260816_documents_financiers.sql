-- Documents financiers : bons de commande, factures pro-forma et définitives.
--
-- UNE TABLE ET NON TROIS. Les trois documents partagent la même structure —
-- un en-tête client, des lignes, des totaux, une numérotation séquentielle — et
-- ne diffèrent que par leur intitulé et leur portée juridique. Trois tables
-- imposeraient de tripler chaque requête d'historique et chaque écran, pour
-- distinguer ce qu'une colonne suffit à porter.
--
-- Les lignes sont GELÉES DANS `contenu_json`, comme `offres.source_json`.
-- C'est le patron déjà retenu dans ce projet, et pour la même raison : une
-- facture émise ne doit jamais changer parce qu'un prix de la feuille de coûts
-- a été corrigé après coup. Un document financier est une photographie, pas une
-- vue.

create table if not exists public.documents_financiers (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,

  -- Rattachements : la demande porte l'affaire, l'offre la version acceptée.
  -- Les deux restent nullables — un avoir ou une facture de régularisation peut
  -- n'avoir aucune offre derrière.
  demande_id bigint references public.demandes (id) on delete set null,
  offre_id bigint references public.offres (id) on delete set null,
  client_id bigint references public.clients (id) on delete set null,

  type text not null,
  numero text not null,

  -- Lignes et totaux figés à l'émission. `jsonb` et non `json` : on veut
  -- pouvoir interroger un montant sans désérialiser tout le document.
  contenu_json jsonb not null,

  devise text not null default 'MAD',
  total_ht numeric(14, 2) not null default 0,
  total_tva numeric(14, 2) not null default 0,
  total_ttc numeric(14, 2) not null default 0,

  statut text not null default 'emis',

  -- Le PDF est produit à l'émission et conservé : le régénérer plus tard
  -- donnerait un document différent si le gabarit a changé entre-temps.
  pdf_url text,

  emis_par uuid references public.users (id) on delete set null,
  date_emission timestamptz not null default now(),
  date_echeance date,
  date_reglement timestamptz,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents_financiers
  drop constraint if exists documents_financiers_type_check;

alter table public.documents_financiers
  add constraint documents_financiers_type_check
  check (type in ('bon_commande', 'proforma', 'facture'));

-- `annule` plutôt qu'une suppression : une facture émise ne s'efface pas, elle
-- s'annule. La séquence de numérotation doit rester continue pour être
-- opposable.
alter table public.documents_financiers
  drop constraint if exists documents_financiers_statut_check;

alter table public.documents_financiers
  add constraint documents_financiers_statut_check
  check (statut in ('emis', 'regle', 'annule'));

-- Unicité par tenant : deux sociétés hébergées ont chacune leur BC-2026-0001.
create unique index if not exists documents_financiers_numero_key
  on public.documents_financiers (tenant_id, numero);

-- L'historique d'une affaire lit par demande ; la liste filtre par type et
-- date. Sans ces index, les deux balaieraient la table.
create index if not exists documents_financiers_demande_idx
  on public.documents_financiers (tenant_id, demande_id);

create index if not exists documents_financiers_liste_idx
  on public.documents_financiers (tenant_id, type, date_emission desc);

-- RLS déclaré explicitement, sans politique : refus par défaut. Toute la
-- plateforme lit par la clé service role et filtre `tenant_id` en application.
alter table public.documents_financiers enable row level security;

comment on table public.documents_financiers is
  'Bons de commande, factures pro-forma et définitives. Lignes gelées dans contenu_json à l''émission.';
