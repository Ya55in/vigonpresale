-- Garantie annoncée par le fournisseur dans son devis.
--
-- Critère de comparaison systématique au même titre que le délai de livraison
-- et les conditions de paiement, qui ont déjà leur colonne. Une garantie de
-- 12 mois contre 36 mois change l'arbitrage autant qu'un écart de prix, et
-- rien dans le schéma ne permettait de la retenir : l'information se perdait
-- entre le devis reçu et le comparatif.
--
-- `text` libre et non contraint : les fournisseurs l'expriment en clair
-- (« 2 ans retour atelier », « garantie constructeur 36 mois »), et la
-- normaliser en durée ferait perdre les réserves qui l'accompagnent.
--
-- NULL = le devis n'en mentionne aucune. L'extraction n'invente jamais une
-- garantie absente : le comparatif affiche alors « non précisé », ce qui est
-- une information en soi au moment de trancher.

alter table public.devis_fournisseur
  add column if not exists garantie text;

comment on column public.devis_fournisseur.garantie is
  'Garantie annoncée par le fournisseur, telle qu''extraite du devis. NULL si non mentionnée.';
