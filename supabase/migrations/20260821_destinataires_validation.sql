-- Qui reçoit les demandes d'approbation d'offre.
--
-- Le circuit existait entier — table, jeton, page publique, décision, envoi
-- Telegram — mais AUCUN écran ne le déclenchait : `soumettreValidation` et
-- `definirValidationObligatoire` n'étaient appelées de nulle part. Une offre
-- pouvait donc se générer sans qu'aucune demande ne parte, ce qui a été
-- constaté sur l'affaire Agadir : rien n'était cassé, rien n'était branché.
--
-- En rebranchant, il faut dire À QUI la demande s'adresse. Jusqu'ici l'action
-- lisait une adresse saisie dans un formulaire ; c'est à l'administrateur que
-- l'accord revient, pas à l'avant-vente de désigner son propre approbateur.

-- L'ADMIN REÇOIT TOUJOURS, sans que rien ne le déclare : son rôle suffit.
-- Cette colonne n'ouvre le canal qu'aux AUTRES, et seulement en secours —
-- quand aucun administrateur n'a de coordonnée instantanée renseignée.
--
-- Faux par défaut : activer ce drapeau pour tout le monde ferait partir chaque
-- demande d'accord à toute l'équipe, ce qui dilue la responsabilité au lieu de
-- la porter.
alter table public.users
  add column if not exists recoit_validations boolean not null default false;

comment on column public.users.recoit_validations is
  'Autorise ce compte à recevoir les demandes d''approbation d''offre EN SECOURS, '
  'quand aucun administrateur n''a de canal instantané lié. Les administrateurs '
  'les reçoivent de droit, sans ce drapeau.';

-- Index partiel : la résolution des destinataires ne cherche que les comptes
-- autorisés et actifs, jamais la table entière.
create index if not exists users_recoit_validations_idx
  on public.users (tenant_id)
  where recoit_validations and actif;
