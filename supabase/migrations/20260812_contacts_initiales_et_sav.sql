-- Deux ajouts indépendants, groupés pour n'ouvrir qu'une fenêtre de migration.

-- 1. Initiales du fournisseur ---------------------------------------------
--
-- Réclamées par la spec au même titre que le nom. Elles servent d'étiquette
-- courte là où le nom complet ne tient pas — en-tête de colonne du comparatif,
-- badge d'une consultation — et évitent d'abréger « Atlas Distribution » en
-- « Atlas Dist… » différemment à chaque écran.
--
-- Nullable : les 9 fiches existantes n'en ont pas, et en fabriquer
-- automatiquement à partir du nom produirait des collisions silencieuses
-- (« Medina Networks » et « Maroc Numérique » donnent tous deux « MN »).
-- L'interface propose une suggestion, un humain tranche.

alter table public.fournisseurs
  add column if not exists initiales text;

alter table public.fournisseurs
  drop constraint if exists fournisseurs_initiales_check;

-- Bornée à 6 caractères : au-delà ce n'est plus une initiale mais une
-- abréviation, et la contrainte d'affichage qui justifiait le champ disparaît.
alter table public.fournisseurs
  add constraint fournisseurs_initiales_check
  check (initiales is null or char_length(trim(initiales)) between 1 and 6);

comment on column public.fournisseurs.initiales is
  'Étiquette courte du fournisseur, 1 à 6 caractères. NULL si non renseignée.';

-- 2. Tickets du service après-vente ---------------------------------------
--
-- L'écran après-vente listait les affaires gagnées : une lecture, pas un suivi.
-- La spec demande un espace de suivi des demandes de support avec un état
-- d'avancement, ce qui suppose une entité propre.
--
-- Rattaché à `demandes` plutôt qu'à `offres` : un client rappelle pour un
-- projet, pas pour un numéro d'offre, et une affaire peut avoir plusieurs
-- versions d'offre dont une seule a été signée.
--
-- `client_id` est dupliqué depuis la demande volontairement : un ticket doit
-- rester lisible même si la demande est un jour archivée, et c'est le client
-- qu'on filtre à l'écran.

create table if not exists public.tickets_sav (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  demande_id bigint references public.demandes (id) on delete set null,
  client_id bigint references public.clients (id) on delete set null,

  numero text not null,
  objet text not null,
  description text,

  -- Trois états, pas plus : la spec en cite deux et un ticket rouvert doit se
  -- distinguer d'un ticket neuf, sinon le délai de traitement devient faux.
  statut text not null default 'en_cours',

  -- Priorité libre côté métier, bornée pour rester triable.
  priorite text not null default 'normale',

  ouvert_par uuid references public.users (id) on delete set null,
  assigne_a uuid references public.users (id) on delete set null,

  date_ouverture timestamptz not null default now(),
  date_traitement timestamptz,
  resolution text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tickets_sav
  drop constraint if exists tickets_sav_statut_check;

alter table public.tickets_sav
  add constraint tickets_sav_statut_check
  check (statut in ('en_cours', 'traite', 'rouvert'));

alter table public.tickets_sav
  drop constraint if exists tickets_sav_priorite_check;

alter table public.tickets_sav
  add constraint tickets_sav_priorite_check
  check (priorite in ('basse', 'normale', 'haute', 'critique'));

-- Un numéro unique par tenant, pas globalement : deux sociétés hébergées
-- peuvent légitimement avoir chacune leur SAV-0001.
create unique index if not exists tickets_sav_numero_key
  on public.tickets_sav (tenant_id, numero);

-- L'écran liste par client et par état ; sans cet index il balaierait la table
-- à chaque affichage.
create index if not exists tickets_sav_suivi_idx
  on public.tickets_sav (tenant_id, statut, date_ouverture desc);

-- RLS déclaré explicitement, et non laissé au défaut de la plateforme : la
-- leçon de `fournisseur_embeddings`, où la protection tenait à un comportement
-- Supabase qu'une autre installation n'aurait pas forcément.
--
-- Aucune politique : toute la plateforme lit par la clé service role, qui
-- contourne le RLS, et filtre `tenant_id` en application. RLS actif sans
-- politique = refus par défaut, la posture des autres tables.
alter table public.tickets_sav enable row level security;

comment on table public.tickets_sav is
  'Demandes de support après-vente, rattachées à une affaire gagnée.';
