-- 2026-08-17 — Ferme la lecture anonyme des trois vues de pilotage.
--
-- CE QUI A ÉTÉ TROUVÉ
--
-- Les six tables sensibles étaient verrouillées, et l'audit du 2026-08-11 l'a
-- vérifié. Mais il a énuméré des TABLES, et une vue n'en est pas une : les
-- trois vues du schéma initial rendaient à la clé publique exactement ce que le
-- RLS refusait en dessous.
--
--   v_consultations_en_attente  → noms et courriels de tous les fournisseurs
--                                 consultés, marques, codes de demande
--   v_kpi_tenant                → chiffre d'affaires, marge moyenne, deals
--   v_pipeline                  → intitulés réels des affaires en cours
--
-- Mesuré, pas supposé : 3 lignes, 1 ligne et 3 lignes remontées avec la seule
-- clé anonyme, celle qui est inlinée dans le bundle du navigateur par le
-- préfixe `NEXT_PUBLIC_` et que lit quiconque ouvre la page de connexion.
--
-- POURQUOI LE RLS NE S'APPLIQUAIT PAS
--
-- Une vue PostgreSQL s'exécute par défaut avec les droits de son PROPRIÉTAIRE,
-- pas de son appelant. Créée par le rôle propriétaire du schéma, elle traverse
-- le RLS des tables qu'elle lit. Le verrou posé sur `demandes` ou `clients`
-- n'était donc jamais consulté par ce chemin.
--
-- DEUX VERROUS PLUTÔT QU'UN
--
-- 1. `security_invoker` fait exécuter la vue avec les droits de l'appelant : le
--    RLS des tables sous-jacentes redevient opposable. C'est le correctif de
--    fond — il reste vrai si un futur `grant` rouvre l'accès par mégarde.
-- 2. Le `revoke` retire l'accès à `anon` et `authenticated`. C'est le correctif
--    qui ne dépend d'aucune version de PostgreSQL, et il rend un refus franc
--    plutôt qu'un tableau vide : la vue ne confirme même pas son existence.
--
-- Aucun risque de régression : `grep` sur tout le dépôt ne trouve AUCUN appel à
-- ces trois vues. Elles datent du schéma initial et n'ont jamais été lues par
-- l'application, qui interroge les tables par la clé service role.

-- `security_invoker` existe depuis PostgreSQL 15. Le garde-fou évite que la
-- migration entière échoue sur une instance plus ancienne, où le `revoke`
-- ci-dessous suffit à fermer la fuite.
do $$
begin
  if current_setting('server_version_num')::int >= 150000 then
    execute 'alter view public.v_consultations_en_attente set (security_invoker = on)';
    execute 'alter view public.v_kpi_tenant set (security_invoker = on)';
    execute 'alter view public.v_pipeline set (security_invoker = on)';
  else
    raise notice 'PostgreSQL < 15 : security_invoker indisponible, seul le revoke s''applique.';
  end if;
end
$$;

revoke all on public.v_consultations_en_attente from anon, authenticated;
revoke all on public.v_kpi_tenant from anon, authenticated;
revoke all on public.v_pipeline from anon, authenticated;

-- `service_role` conserve ses droits : c'est par lui que passe toute lecture
-- applicative, et le filtrage `tenant_id` est fait en application.
