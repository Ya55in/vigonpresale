-- Remplace l'index ivfflat par un HNSW.
--
-- PROBLÈME DE JUSTESSE, PAS DE PERFORMANCE.
--
-- `ivfflat` partitionne les vecteurs en `lists` cellules et n'en sonde qu'une
-- par défaut (`ivfflat.probes = 1`). Avec 100 listes pour 33 vecteurs, chaque
-- cellule en contient moins d'un : la recherche sonderait une cellule sur cent
-- et manquerait presque tout. Aujourd'hui le planificateur préfère encore le
-- balayage complet — la table est minuscule, les résultats sont donc justes —
-- mais le jour où il choisirait l'index, le rappel s'effondrerait sans qu'aucune
-- erreur ne le signale. Un mauvais classement est silencieux.
--
-- `hnsw` n'a pas ce défaut : pas de paramètre à dimensionner sur la taille de la
-- table, et un rappel élevé dès le premier vecteur. Sa construction est plus
-- lente, ce qui est sans objet ici — l'indexation se fait à la réception d'un
-- devis, une poignée de lignes à la fois.
--
-- `m` et `ef_construction` restent aux valeurs par défaut (16 et 64) : les
-- ajuster sans mesure serait un réglage à l'aveugle.

drop index if exists public.fournisseur_embeddings_vecteur_idx;

create index if not exists fournisseur_embeddings_vecteur_idx
  on public.fournisseur_embeddings
  using hnsw (embedding vector_cosine_ops);

-- Retrouver les vecteurs produits par un modèle donné, pour les recalculer
-- après un changement d'embedding. Sans cet index, la détection balaierait la
-- table entière à chaque rattrapage.
create index if not exists fournisseur_embeddings_modele_idx
  on public.fournisseur_embeddings (tenant_id, modele);
