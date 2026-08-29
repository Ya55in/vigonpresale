-- Telegram comme second émetteur du circuit d'approbation, à côté de WhatsApp.
--
-- WhatsApp reste bloqué côté Meta — Business Portfolio non vérifié, carte
-- bancaire refusée sur la vérification récurrente. Telegram n'a aucune de ces
-- exigences : un jeton de bot via @BotFather suffit. Le circuit devient donc
-- disponible dès aujourd'hui, WhatsApp prenant le relais le jour où le compte
-- Meta sera débloqué — sans que rien d'autre ne change au contenu ni au jeton
-- de décision.

-- 1. Identifiant Telegram de l'approbateur -----------------------------------
--
-- Même rôle que `telephone` pour WhatsApp : sans lui, aucun message ne peut
-- être adressé à quelqu'un en particulier. Nullable — un approbateur qui n'a
-- pas démarré de conversation avec le bot n'a simplement pas ce canal.
alter table public.users
  add column if not exists telegram_chat_id text;

comment on column public.users.telegram_chat_id is
  'Identifiant numérique du chat Telegram avec le bot de validation. Obtenu en '
  'démarrant une conversation avec le bot, puis en relevant l’identifiant via '
  'scripts/telegram-derniers-contacts.ts. Vide = pas de canal Telegram pour '
  'cet utilisateur.';

-- 2. Le canal « telegram » rejoint la liste autorisée ------------------------
--
-- Contrainte posée dans 20260816_validation_offre.sql : ('email', 'whatsapp',
-- 'interne'). 'interne' sert désormais réellement — la demande reste toujours
-- consultable depuis le centre de notifications, quel que soit le canal
-- externe tenté par ailleurs.
alter table public.validations_offre
  drop constraint if exists validations_offre_canal_check;

alter table public.validations_offre
  add constraint validations_offre_canal_check
  check (canal in ('email', 'whatsapp', 'telegram', 'interne'));
