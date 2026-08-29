-- Deux ajouts sans rapport entre eux, groupés pour n'ouvrir qu'une fenêtre de
-- migration.

-- 1. Origine d'une demande ------------------------------------------------
--
-- Trois portes d'entrée coexistent — la boîte mail, un cahier des charges
-- déposé à la main, un projet ouvert en interne — et rien ne les distinguait
-- une fois la demande créée. On ne pouvait donc ni filtrer, ni mesurer la
-- répartition des entrées, ni adapter le traitement à la provenance.
--
-- `text` avec contrainte plutôt qu'un enum : ajouter une valeur à un enum
-- Postgres impose une migration, alors que les sources d'entrée sont
-- précisément ce qui peut évoluer (portail client, API partenaire).
--
-- Défaut `email` : c'est la seule source qui existait, donc la valeur juste
-- pour toutes les lignes déjà en base.

alter table public.demandes
  add column if not exists source text not null default 'email';

alter table public.demandes
  drop constraint if exists demandes_source_check;

alter table public.demandes
  add constraint demandes_source_check
  check (source in ('email', 'cps', 'interne'));

comment on column public.demandes.source is
  'Porte d''entrée : email (boîte relevée), cps (cahier des charges déposé), interne (projet ouvert par un administrateur).';

-- Rattrapage des lignes antérieures. Le défaut `email` est juste pour les
-- demandes issues de la boîte, faux pour celles créées à la main — or seule
-- une demande relevée porte un `message_id_client`, ce qui suffit à les
-- distinguer sans deviner.
--
-- Sur la base de développement les 8 lignes existantes venaient toutes du
-- courriel, donc cette requête n'y change rien ; elle rend la migration juste
-- partout ailleurs.
update public.demandes
   set source = 'interne'
 where message_id_client is null
   and source = 'email';

-- 2. Jeton de réponse fournisseur -----------------------------------------
--
-- Permet au fournisseur de répondre en remplissant un formulaire en ligne
-- plutôt qu'en rédigeant un courriel. Le devis arrive alors déjà structuré :
-- l'extraction par le modèle sort du chemin, et avec elle le risque qu'un prix
-- mal lu se propage jusqu'au costing.
--
-- Même principe que `offres.token_public` : le jeton EST l'autorisation, il est
-- long, aléatoire, et ne circule que dans la demande de devis envoyée au
-- fournisseur concerné.
--
-- Nullable : les consultations déjà envoyées n'en ont pas et n'en auront pas —
-- leur fournisseur a reçu un message sans lien, lui en fabriquer un a posteriori
-- ne servirait à rien.

alter table public.consultations
  add column if not exists token_public text;

-- Unicité indispensable : deux consultations partageant un jeton ouvriraient
-- le formulaire de l'une à l'autre. L'index partiel laisse coexister autant de
-- NULL que nécessaire.
create unique index if not exists consultations_token_public_key
  on public.consultations (token_public)
  where token_public is not null;

comment on column public.consultations.token_public is
  'Jeton du formulaire de réponse en ligne. NULL pour les consultations envoyées avant cette fonctionnalité.';
