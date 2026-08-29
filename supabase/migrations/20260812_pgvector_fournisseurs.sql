-- Recherche sémantique de fournisseurs (RAG).
--
-- Ce qu'on vectorise n'est PAS la fiche fournisseur : `fournisseurs` ne porte
-- que nom, marque et pays, et une comparaison exacte sur `marque_norm` fait
-- déjà ce travail. Vectoriser cela n'apporterait rien.
--
-- Le signal est dans l'historique : ce que chaque fournisseur a réellement
-- chiffré. Un fournisseur qui a coté quarante équipements réseau EST un
-- fournisseur réseau, quoi qu'en dise sa colonne `marque`. C'est ce qui permet
-- de retrouver UBSM sur « point d'accès WiFi 6 » sans que le mot « WiFi »
-- figure nulle part dans sa fiche.

create extension if not exists vector;

-- 1536 et non 3072 (défaut de gemini-embedding-001) : ivfflat et hnsw plafonnent
-- à 2000 dimensions, un vecteur plus large ne serait pas indexable et chaque
-- recherche deviendrait un balayage complet. Gemini accepte
-- `outputDimensionality` — la troncature Matryoshka conserve l'essentiel du
-- signal, mesuré à 0,76 entre deux bornes WiFi contre 0,58 entre une borne et
-- un onduleur.
create table if not exists public.fournisseur_embeddings (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenants (id) on delete cascade,

  -- Une ligne de devis = un vecteur. C'est l'unité naturelle : chaque ligne
  -- porte une désignation produit rédigée par le fournisseur lui-même.
  ligne_devis_id bigint not null references public.lignes_devis (id) on delete cascade,

  -- Dénormalisés volontairement. Remonter à `fournisseurs` demanderait trois
  -- jointures (lignes_devis → devis_fournisseur → consultations), à refaire
  -- pour chaque résultat d'une recherche qui doit rester rapide.
  -- `fournisseur_id` est nullable : certaines consultations n'ont qu'un nom,
  -- le fournisseur n'ayant jamais été créé en fiche.
  fournisseur_id   bigint references public.fournisseurs (id) on delete cascade,
  fournisseur_nom  text not null,

  -- Texte réellement soumis au modèle, conservé pour deux raisons : justifier
  -- un résultat à l'écran (« a déjà chiffré : … ») et permettre de recalculer
  -- les vecteurs après un changement de modèle sans relire toute la chaîne.
  texte      text not null,
  embedding  vector(1536) not null,
  modele     text not null default 'gemini-embedding-001',
  created_at timestamptz not null default now()
);

-- Une ligne de devis ne doit avoir qu'un vecteur : sans cela, un rattrapage
-- rejoué doublerait le poids de ces lignes dans le classement.
create unique index if not exists fournisseur_embeddings_ligne_key
  on public.fournisseur_embeddings (ligne_devis_id);

create index if not exists fournisseur_embeddings_tenant_idx
  on public.fournisseur_embeddings (tenant_id);

-- Index cosinus. `lists` = 100 convient jusqu'à quelques dizaines de milliers
-- de lignes ; en deçà de ~1000 vecteurs Postgres préfère de toute façon le
-- balayage, qui reste instantané à cette taille.
create index if not exists fournisseur_embeddings_vecteur_idx
  on public.fournisseur_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

comment on table public.fournisseur_embeddings is
  'Vecteurs des lignes de devis historiques, pour la recherche sémantique de fournisseurs.';

-- RLS déclaré explicitement.
--
-- Supabase l'active par défaut sur les tables créées depuis son éditeur, et
-- c'était bien le cas ici — vérifié, une écriture avec la clé publique est
-- refusée. Mais dépendre d'un défaut de plateforme n'est pas une garantie :
-- rejouée ailleurs, cette migration pourrait produire une table ouverte en
-- lecture à la clé anonyme, qui est publiée dans le navigateur.
--
-- Aucune politique n'est créée, et c'est délibéré : toute la plateforme lit
-- par la clé service role, qui contourne le RLS, et filtre `tenant_id` en
-- application. RLS actif sans politique = refus par défaut pour `anon` et
-- `authenticated`, ce qui est exactement la posture des autres tables.
alter table public.fournisseur_embeddings enable row level security;

/* ------------------------------------------------------------------------- */
/* Recherche                                                                  */
/* ------------------------------------------------------------------------- */

-- Fonction plutôt que requête assemblée côté application : PostgREST ne sait
-- pas exprimer l'opérateur `<=>`, et construire le vecteur dans une chaîne SQL
-- depuis TypeScript rouvrirait une voie d'injection que le reste du projet
-- s'interdit.
--
-- Retourne les lignes historiques les plus proches d'un vecteur donné.
-- L'agrégation par fournisseur est faite côté application, où la couverture par
-- article et la justification se composent plus lisiblement.
create or replace function public.chercher_fournisseurs_similaires(
  requete      vector(1536),
  tenant       uuid,
  seuil        double precision default 0.55,
  limite       integer default 20
)
returns table (
  fournisseur_id  bigint,
  fournisseur_nom text,
  texte           text,
  similarite      double precision
)
language sql
stable
as $$
  select
    e.fournisseur_id,
    e.fournisseur_nom,
    e.texte,
    1 - (e.embedding <=> requete) as similarite
  from public.fournisseur_embeddings e
  where e.tenant_id = tenant
    and 1 - (e.embedding <=> requete) >= seuil
  order by e.embedding <=> requete
  limit limite;
$$;

comment on function public.chercher_fournisseurs_similaires is
  'Lignes de devis historiques les plus proches d''un besoin vectorisé. Le seuil écarte le bruit : en deçà de 0,55 les résultats ne partagent plus de domaine technique.';
