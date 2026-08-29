# Vigon Presale — plateforme avant-vente IT

Plateforme SaaS de gestion d'avant-vente : de la réception du besoin client par
e-mail jusqu'à la clôture du deal, en passant par l'extraction des
spécifications, la consultation des fournisseurs, le costing et la génération de
l'offre commerciale.

Monorepo npm : application Next.js 16 (`apps/web`) + worker Node (`apps/worker`).

> **Documentation du projet** — ce README (installation, architecture,
> fonctionnement) · [rapport de développement](docs/RAPPORT-DEVELOPPEMENT.md)
> (défauts rencontrés, causes, corrections) ·
> [rapport de sécurité](docs/RAPPORT-SECURITE.md) (audit, failles, correctifs).

---

## Sommaire

- [Ce que fait la plateforme](#ce-que-fait-la-plateforme)
- [État d'avancement](#état-davancement)
- [Prérequis](#prérequis)
- [Démarrage](#démarrage)
- [Le flux métier](#le-flux-métier)
- [Rôles et permissions](#rôles-et-permissions)
- [Architecture](#architecture)
- [Le worker](#le-worker)
- [Paramétrage depuis l'interface](#paramétrage-depuis-linterface)
- [Fournisseur IA commutable](#fournisseur-ia-commutable)
- [Scripts de vérification](#scripts-de-vérification)
- [Déploiement](#déploiement)
- [Conventions de contribution](#conventions-de-contribution)
- [Décisions d'ingénierie notables](#décisions-dingénierie-notables)
- [Ce qui reste à faire](#ce-qui-reste-à-faire)

---

## Ce que fait la plateforme

Vigon Presale automatise le **tunnel avant-vente** : du besoin exprimé par un
client jusqu'à la facture. Ce qui demandait des heures de copier-coller entre
une boîte mail, un tableur et un traitement de texte devient un flux traçable où
chaque étape alimente la suivante. **L'humain garde toutes les décisions** ; la
plateforme lui retire la saisie, la relance et le classement.

```
Client ──► Réception ──► Consultation ──► Devis ──► Costing ──► Offre ──► Facture
             │            fournisseurs    reçus              client       SAV
             └── e-mail · cahier des charges · projet interne
```

| Étape | Ce que la plateforme apporte |
|---|---|
| **Réception** | Relève la boîte avant-vente, distingue demande client et devis fournisseur, extrait les articles du corps et des pièces jointes |
| **Fournisseurs** | Propose qui consulter par recherche sémantique sur l'historique réellement chiffré, complétée du sourcing web pour les marques inconnues |
| **Consultations** | Compose et planifie les demandes de devis par marque, relance automatiquement, clôt après épuisement des rappels |
| **Réponses** | Deux voies : formulaire en ligne sans compte (`/devis/[token]`) ou courriel, apparié au fil d'origine et extrait par le modèle |
| **Comparatif** | Une colonne par devis, meilleur prix signalé sans être retenu d'office, couverture par article affichée |
| **Costing** | Marge par ligne ou globale, prix calculés par des colonnes générées en base, escalade FINANCE au-delà des seuils |
| **Approbation** | Circuit optionnel avant génération : Telegram, WhatsApp ou courriel, décision aussi possible depuis la plateforme |
| **Offre** | Lien web personnalisé plutôt qu'un PDF figé, décision du client tracée, relance avant échéance |
| **Documents** | Bon de commande, pro-forma et facture, contenu gelé à l'émission |
| **Après-vente** | Suivi des tickets rattachés à l'affaire, historique complet par dossier |

### Trois principes qui traversent tout le code

**Le modèle ne produit jamais de HTML.** Il fournit des données structurées
validées par un schéma ; la mise en forme est assemblée en TypeScript. Tout
texte venu du modèle ou de la base est échappé avant insertion, par une
implémentation unique et partagée.

**Ce qui est parti est gelé.** Conditions d'offre, lignes de facture, montants
soumis à validation, contenu du BoQ : tout est recopié à l'émission. Un document
transmis à un tiers ne change jamais rétroactivement parce qu'un prix a été
corrigé après coup.

**Rien n'est décidé à la place de l'humain.** Le comparatif signale le meilleur
prix sans le retenir. La recherche de fournisseurs propose sans présélectionner.
La marge est calculée mais reste ajustable. Le classement ordonne, il ne tranche
pas — un fournisseur pertinent peut être écarté pour des raisons que la
plateforme ignore.

---

## État d'avancement

**Les 12 étapes sont livrées** et vérifiées sur données réelles.

| Étape | Périmètre | État |
|---|---|---|
| 1 | Fondations monorepo, Tailwind, clients Supabase | ✅ |
| 2 | Authentification sur invitation, rôles, layout | ✅ |
| 3 | Services externes (IA, Firecrawl, Gamma, messagerie, extraction) | ✅ |
| 4 | Réception des demandes, pièces jointes, extraction des specs | ✅ |
| 5 | Écran demandes, édition et validation des articles | ✅ |
| 6 | Fournisseurs, consultations, planification d'envoi | ✅ |
| 7 | Relances automatiques | ✅ |
| 8 | Réception, classification et extraction des devis | ✅ |
| 9 | Costing, marge, escalade FINANCE | ✅ |
| 10 | Génération de l'offre (Gamma + repli PDF local) | ✅ |
| 11 | Relecture, envoi client, page publique, clôture du deal | ✅ |
| 12 | Dashboards, notifications, expiration des offres, admin | ✅ |

S'y ajoutent, hors prompt maître : gestion des clés API depuis l'application,
invitation d'utilisateurs par l'administrateur, et les écrans fournisseurs,
clients, offres, opportunités et après-vente.

Puis, en dernier lieu — voir [Paramétrage depuis l'interface](#paramétrage-depuis-linterface) :

| Ajout | Où |
|---|---|
| Prompts du modèle modifiables sans redéploiement | `/admin` |
| Conditions commerciales des offres modifiables | `/admin` |
| Langue de correspondance par fournisseur | `/fournisseurs` |
| Rappel des offres envoyées et jamais ouvertes | worker, 8 h |
| Relance du client avant échéance | worker, 9 h |
| Comparatif : garantie, paiement, validité, couverture | `/demandes/[id]/costing` |
| Réponse fournisseur par formulaire en ligne | `/devis/[token]` |
| Trois portes d'entrée tracées, dépôt de cahier des charges | `/demandes` |
| Réponses fournisseurs lisibles, historique replié | `/demandes/[id]/consultations` |
| Suggestion sémantique des fournisseurs à consulter | `/demandes/[id]/consultations` |
| Contacts multiples et initiales par fournisseur | `/fournisseurs` |
| Devis joint par le fournisseur à sa réponse | `/devis/[token]` |
| Visuels et conditions réglables offre par offre | `/demandes/[id]/offre` |
| Suivi des demandes de support | `/apres-vente` |
| Bons de commande, pro-forma, factures, historique | `/demandes/[id]` |
| Approbation avant génération d'offre (optionnelle) | `/validation/[token]` |

---

## Prérequis

**Node 22 ou plus.** `supabase-js` exige un `WebSocket` global, absent de Node 20 :
sur une version antérieure, tout appel Supabase côté serveur échoue au démarrage.

```bash
node -v   # doit afficher v22.x ou plus
```

---

## Démarrage

```bash
cp .env.example apps/web/.env.local
npm install
```

Renseigner au minimum dans `apps/web/.env.local` :

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publique |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service role (serveur uniquement) |
| une clé IA au choix | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` — ou `AI_API_URL` + `AI_API_KEY` + `AI_MODEL` |
| `IMAP_CLIENT_USER` / `IMAP_CLIENT_PASSWORD` | Boîte mail — **mot de passe d'application**, pas le mot de passe du compte |

> `.env.example` ne doit contenir que des clés **vides**. Les secrets vivent
> dans `apps/web/.env.local`, couvert par `.gitignore`.

Puis :

```bash
npm run init:storage    # crée les buckets privés pieces-jointes, offres, logos
npm run dev             # application seule, sur http://localhost:3000
```

**`npm run dev` ne lance que l'application, jamais le worker.** Les deux
lancements sont volontairement séparés depuis le 2026-08-27 : le worker fait de
vrais envois — RFQ, relances, courriels — dès qu'il tourne, et le bundler par
défaut a produit une relance réelle vers quatre fournisseurs pendant une
session où seule l'interface était censée être testée. Détail dans
[docs/RAPPORT-DEVELOPPEMENT.md](docs/RAPPORT-DEVELOPPEMENT.md#lancement-separe).

```bash
npm run dev:worker      # worker seul — geste voulu, jamais un effet de bord
```

Sans lui, aucune demande n'entre, aucune RFQ ne part, aucune relance ne se
déclenche : ce n'est pas un utilitaire optionnel, seulement un lancement qui ne
doit plus être implicite.

```bash
npm run dev:tout        # les deux ensemble, si vraiment nécessaire
```

Réservé aux cas où web et worker doivent tourner côte à côte de façon prolongée
(démonstration en conditions réelles, session de recette). S'il plante, le
worker est relancé automatiquement, avec une temporisation qui double jusqu'à
30 s.

**Un seul worker à la fois, quel que soit le lancement.** `npm run dev:tout`
refuse de démarrer si un worker tourne déjà — y compris un `npm run dev:worker`
oublié dans un autre terminal — et affiche la commande pour l'arrêter. Deux
workers feraient tourner chaque job en double — deux demandes de devis au même
fournisseur, deux relances, deux courriels au client. Les gardes d'idempotence
lisent puis écrivent, et deux workers synchronisés sur la même minute passent
entre les deux.

Le cas se produisait en fermant le terminal sans Ctrl-C : le lanceur recevait
SIGHUP, que Node traite par défaut en terminant sur-le-champ, donc l'arrêt
propre n'était jamais exécuté et le worker survivait — invisible, à relever la
boîte et envoyer des RFQ. SIGHUP et SIGQUIT sont désormais interceptés
(`npm run dev:tout` uniquement — `npm run dev:worker` seul reste un processus
nu, sans cette garde).

### Faire tourner le worker en permanence

La boîte avant-vente reçoit des demandes même quand personne ne développe. Pour
que le worker démarre à l'ouverture de session et survive à la fermeture du
terminal, il s'installe en service macOS
([`worker-service.mjs`](scripts/worker-service.mjs)) :

```bash
npm run worker:service            # installer et démarrer
npm run worker:service -- etat    # état et emplacement des journaux
npm run worker:service -- stop    # arrêter et désinstaller
```

launchd plutôt que cron : il relance le processus s'il meurt (`KeepAlive`) et le
démarre à la session, ce que cron ne sait pas faire. Les journaux vont dans
`logs/`, hors dépôt.

### Comptes de test

L'accès fonctionne **sur invitation** : un profil `users` doit exister avec
l'adresse de la personne. La première connexion se contente d'y rattacher
`auth_user_id`. Une adresse inconnue est refusée et sa session détruite — il
n'y a pas d'auto-inscription.

```bash
SEED_PASSWORD='<12 caractères minimum>' npm run seed:users
```

Crée un compte par rôle : `admin@`, `presale@`, `finance@`, `aftersales@vigon.test`.
Sur un compte déjà existant, le script réinitialise le mot de passe avec la
valeur de `SEED_PASSWORD` — c'est la façon de rattraper un mot de passe perdu.

Pour ne toucher qu'un seul compte et laisser les autres intacts :

```bash
SEED_PASSWORD='<12 caractères minimum>' SEED_ONLY_ROLE=presale npm run seed:users
```

---

## Le flux métier

### Trois portes d'entrée

Une demande naît de trois façons, et la colonne `demandes.source` les distingue.
Sans elle, elles étaient indiscernables une fois créées : impossible de filtrer
la liste ni de mesurer la répartition des entrées.

| Origine | Qui la crée | Ce qui la caractérise |
|---|---|---|
| `email` | worker, `pollClientMailbox` | Fil de discussion conservé, PJ extraites |
| `cps` | PRESALE, `/demandes/nouvelle` | Cahier des charges déposé, son texte rejoint la demande |
| `interne` | PRESALE, `/demandes/nouvelle` | Projet ouvert après un appel ou une réunion |

Le dépôt d'un cahier des charges accepte PDF, Word, Excel et texte, 15 Mo au
plus. Les formats sont **refusés à l'entrée s'ils ne sont pas relisibles** :
stocker un document qu'on ne saura jamais rouvrir donne l'illusion d'une pièce
au dossier. Le texte extrait rejoint `contenu_consolide`, donc l'extraction des
articles le lit au même titre qu'un corps de courriel.

Un dépôt en échec ne perd jamais la demande déjà créée : le message le signale
et le document se rattache plus tard, plutôt que de faire ressaisir tous les
articles.

```
   ┌──────────────┐
   │ Client       │  envoie un besoin par e-mail (corps, PJ, ZIP)
   └──────┬───────┘
          │  worker : pollClientMailbox (60 s)
          ▼
   ① Demande créée ──► PJ stockées, ZIP décompressé, texte consolidé
          │
          │  IA : extraction des articles (marque déduite de la référence)
          ▼
   ② Articles extraits ──► écran PRESALE : correction et validation
          │
          │  base fournisseurs, sinon sourcing web Firecrawl
          ▼
   ③ Fournisseurs identifiés
          │
          │  IA : rédaction RFQ anonymisée, HTML assemblé en TypeScript
          ▼
   ④ Consultations préparées ──► écran de validation, édition, exclusion
          │
          │  envoi immédiat ou planifié (worker : sendScheduledRfq)
          ▼
   ⑤ RFQ envoyées ──► relances automatiques (worker : processRelances)
          │
          │  worker : réception, classification et extraction des devis
          ▼
   ⑥ Devis reçus ──► comparatif des prix d'achat
          │
          │  sélection par ligne, coûts additionnels, marge
          ▼
   ⑦ Costing ──► dans les seuils : PRESALE verrouille
          │        hors seuils : escalade FINANCE obligatoire
          ▼
   ⑧ Marge validée ──► enrichissement IA, photos produits, BoQ
          │
          │  Gamma si clé présente, sinon PDF local
          ▼
   ⑨ Offre générée ──► relecture interne /offres/[id]/preview
          │
          │  validation et envoi au client
          ▼
   ⑩ Lien public /offre/[token] ──► traçage de consultation
          │
          ├─ Approuver          ──► demande gagnée, AFTER_SALES notifié
          ├─ Demander une modif ──► dossier reste ouvert
          ├─ Décliner + motif   ──► demande perdue
          └─ Silence            ──► expiration (worker : expireOffres)
```

---

## Rôles et permissions

Quatre rôles, dont les périmètres sont vérifiés **côté serveur** à chaque
requête. Masquer un bouton dans l'interface n'est jamais une autorisation.

| Rôle | Périmètre |
|---|---|
| **ADMIN** | Accès total, gestion des comptes et des paramètres |
| **PRESALE** | Demandes, fournisseurs, consultations, costing dans les seuils, offres |
| **FINANCE** | Validation des costings escaladés, seuils, indicateurs financiers |
| **AFTER_SALES** | Deals gagnés uniquement — jamais de prix d'achat ni de marge |

La matrice est figée par un test :

```bash
npm run verifier:permissions     # 12 cas issus de la spec
npm run verifier:roles --workspace=@vigon/web
```

### Cloisonnement vérifié

- Une demande hors périmètre renvoie **404**, pas 403 : on ne révèle pas
  l'existence d'un dossier qu'on n'a pas le droit de voir.
- FINANCE accède à l'écran des articles mais **sans aucun bouton** de
  modification — elle ne touche pas aux spécifications techniques.
- Les indicateurs financiers ne sont pas seulement masqués pour AFTER_SALES :
  ils ne sont **pas calculés**.

---

## Architecture

```
apps/
  web/                    Next.js 16 — App Router, Server Actions
    app/(auth)/           login, callback OAuth
    app/(dashboard)/      écrans authentifiés
    app/offre/[token]/    page publique client, sans authentification
    lib/auth/             session, gardes, matrice de permissions
    lib/costing/          comparatif, conversion de marge, escalade
    lib/offres/           génération, BoQ, PDF, lecture publique
    components/           UI (shadcn/ui écrit à la main)

  worker/                 Node + node-cron
    src/jobs/             pollClientMailbox, sendScheduledRfq,
                          processRelances, expireOffres

packages/
  database/               types Supabase générés
  shared/                 schémas zod, constantes métier
  services/               IA, Firecrawl, Gamma, Gmail, IMAP, Supabase,
                          paramètres, sourcing, BoQ, photos
  extraction/             PDF, XLSX, DOCX, ZIP
```

### Écrans

| Route | Contenu |
|---|---|
| `/` | Tableau de bord — KPI adaptés au rôle, notifications |
| `/demandes` | Liste filtrable, triable, paginée (état porté par l'URL) |
| `/demandes/[id]` | Message d'origine, pièces jointes, contenu analysé |
| `/demandes/[id]/articles` | Édition inline et validation des articles |
| `/demandes/[id]/consultations` | RFQ préparées, édition, planification |
| `/demandes/[id]/costing` | Comparatif fournisseurs, marge, validation |
| `/demandes/[id]/offre` | Génération de l'offre |
| `/demandes/[id]/documents` | Bons de commande, pro-forma, factures — émission, envoi et suivi |
| `/demandes/[id]/historique` | Chronologie de l'affaire, reconstruite sans table dédiée |
| `/documents/[id]` | Le document financier tel qu'il part chez le client, imprimable |
| `/offres/[id]/preview` | Relecture interne — rendu client exact |
| `/offre/[token]` | **Page publique** — approuver, modifier, décliner |
| `/validation/[token]` | **Page d'approbation** — accord avant génération de l'offre |
| `/finance` | Costings escaladés en attente |
| `/admin` | Paramètres métier, gestion des comptes |
| `/notifications` | Centre de notifications par rôle |

### Le lien public ne s'ouvre qu'à partir de la validation

Un jeton d'offre n'ouvre rien tant que l'offre n'est pas `validee` : avant, le
document est interne. La page répond alors **le même 404 qu'à un jeton
inconnu**, pour ne rien révéler sur l'existence de l'offre.

Ce silence, utile face à l'extérieur, est trompeur pour l'équipe — l'écran de
relecture proposait « Lien client » quel que soit le statut, et distribuait donc
des adresses en 404 sans que rien n'explique pourquoi ([BUG-16](docs/RAPPORT-DEVELOPPEMENT.md#bug-16)).

`estStatutPublic` (`apps/web/lib/offres/public.ts`) est **lue des deux côtés** :
la page qui refuse, et l'écran qui propose. Une seconde liste recopiée dériverait
et ramènerait le symptôme. Avant validation, le bouton est désactivé et porte le
motif en infobulle — désactivé plutôt que masqué, une disparition se lisant
comme un droit manquant.

---

## Le worker

```bash
npm run dev:worker
```

| Job | Fréquence | Rôle |
|---|---|---|
| `reception` | 60 s | Relève la boîte et **aiguille** : demande client ou devis fournisseur |
| `reprise` | 2 min | Reprend les extractions restées en plan |
| `envoi-rfq` | 60 s | Envoie les consultations planifiées |
| `relances` | 5 min | Relance en réponse dans le fil, clôt après épuisement |
| `expiration` | 7 h chaque jour | Expire les offres non décidées |
| `rappel-offres` | 8 h chaque jour | Alerte ADMIN sur les offres envoyées et jamais ouvertes |
| `relance-client` | 9 h chaque jour | Relance le client à l'approche de l'échéance |

Chaque job est protégé contre le chevauchement : un cycle plus lent que son
intervalle ne s'exécute jamais deux fois en parallèle.

`npm run essai:worker` les exécute **tous les sept**, dans cet ordre, après un
appel réel au modèle. Les trois qui écrivent vers l'extérieur ne tournent que
lorsqu'ils n'ont rien à envoyer — le code passe alors entièrement sans qu'aucun
message ne parte ; au-delà il faut poser `ENVOIS_REELS=1` sciemment.

### Une seule boîte, deux flux

Les demandes clients et les devis fournisseurs arrivent dans la même boîte. Le
job de réception les distingue sur les en-têtes `In-Reply-To` / `References` :
un message qui répond à l'une de nos consultations part dans le flux devis, tout
autre message crée une demande. Sans cet aiguillage, chaque réponse de
fournisseur créerait une demande client fantôme.

### Ce que la relève n'accepte pas

Deux familles sont écartées avant qu'une demande n'existe, sur des **en-têtes**
et jamais sur une lecture du texte par le modèle :

| Famille | Signal | Module |
|---|---|---|
| Avis de non-remise | `multipart/report; report-type=delivery-status`, `MAILER-DAEMON` | `email/rebond.ts` |
| Courrier automatique | `Auto-Submitted` ≠ `no`, `List-Id` / `List-Unsubscribe`, `Precedence: bulk` | `email/automatique.ts` |

La boîte avant-vente sert aussi d'adresse d'inscription : sans ce second filtre,
chaque notification de service devenait une demande, consommait un appel au
modèle et se bloquait faute d'articles.

Le tri repose sur ce que **l'expéditeur déclare**, parce qu'un modèle à qui l'on
demande « est-ce une demande commerciale ? » classera un jour une infolettre de
distributeur comme une consultation. L'adresse en `noreply@` est volontairement
absente des signaux : des portails d'achat publient de vraies consultations
depuis une adresse de ce type.

### Une demande bloquée n'est plus un terminus

`bloquee` était écrit à deux endroits et levé nulle part. Le job `reprise`
rattrape trois situations :

- une extraction reportée pour quota épuisé — le message ayant été marqué lu,
  rien ne la reprenait, malgré le message contraire affiché à l'écran ;
- un déblocage demandé depuis la fiche de la demande (« Relancer l'extraction ») ;
- un arriéré, via `npm run relancer:bloquees`.

**L'extraction reste du seul côté du worker.** L'application se borne à reposer
la demande en `nouvelle` : deux extractions concurrentes inséreraient les
articles en double, et rien ne le signalerait avant le chiffrage.

Une demande sans contenu exploitable se rebloquera au même motif — c'est
attendu. `npm run purger:bloquees` la supprime, après sauvegarde JSON.

Un job dont le service est absent se désactive avec un message explicite, sans
empêcher les autres de tourner. Le job de relances continue notamment de clore
les consultations sans réponse même sans Gmail, cette transition ne dépendant
d'aucun envoi.

---

## Paramétrage depuis l'interface

Quatre réglages sortent du code et vivent en base, dans la table `parametres`.
Règle commune : **la base fait autorité quand la ligne existe, le code sert de
repli**. Une ligne absente ou illisible ne bloque jamais un job.

### Prompts du modèle — `/admin`, ADMIN seul

Les sept prompts du flux sont éditables. Ils sont déclarés dans
`packages/services/src/ai/gabarits.ts` sous forme de gabarits à variables
`{{nom}}`, substituées à l'exécution.

Chaque gabarit déclare ses variables **obligatoires**. L'enregistrement est
refusé si l'une manque : un prompt d'extraction privé de `{{contenu}}` produirait
une réponse plausible sur du vide — c'est-à-dire une invention, qu'aucun
contrôle en aval ne rattraperait. Une variable inconnue est refusée pour la même
raison, elle resterait vide.

« Rétablir le texte d'origine » supprime la ligne : le prompt suit de nouveau
les évolutions livrées avec l'application. Un texte réenregistré identique au
défaut est traité comme un rétablissement, pour la même raison.

Chaque modification est tracée dans `audit_events` **avec le texte intégral**,
ancien et nouveau — c'est ce qui permet de revenir en arrière quand une retouche
dégrade les extractions.

Prise en compte immédiate côté application, sous une minute côté worker
(cache de 60 s).

### Conditions commerciales — `/admin`, ADMIN et FINANCE

Livraison, paiement, garantie : les trois lignes du pied de chaque offre.

Elles sont **gelées dans `source_json`** au moment de la génération. Modifier une
condition ne réécrit donc aucune offre déjà partie chez un client — ce qui serait
inacceptable sur un document contractuel.

### Langue de correspondance des fournisseurs — `/fournisseurs`

Chaque fournisseur porte une langue parmi français, anglais, espagnol, allemand,
italien et arabe. Elle détermine la langue de la demande de devis **et** des
relances.

- La **demande de devis** est rédigée dans cette langue par le modèle
  (variable `{{langue}}` du gabarit `rfq`), désignations et références inchangées.
- Les **relances** ne passent pas par le modèle : leurs textes sont traduits à la
  main dans `packages/services/src/email/rfqHtml.ts`. Les faire traduire à
  l'exécution réintroduirait l'appel qu'on cherche justement à éviter et rendrait
  le ton imprévisible d'un envoi à l'autre.
- L'arabe passe le courriel en `dir="rtl"` : sans cela le corps s'affiche aligné
  à gauche et ponctué à l'envers.

Sans choix explicite, la langue est **déduite du pays** et l'écran l'indique.
Choisir la langue déjà déduite efface le réglage : le fournisseur suit alors son
pays si celui-ci est corrigé plus tard.

> **Où c'est stocké.** `fournisseurs` n'a pas de colonne `langue` et le schéma
> distant ne se modifie pas depuis le dépôt. Le choix explicite vit donc dans
> `parametres`, une ligne par fournisseur — une ligne chacun plutôt qu'un objet
> JSON unique, pour que deux enregistrements simultanés ne s'écrasent pas. Si une
> colonne `langue` est ajoutée un jour, seules les fonctions d'accès de
> `packages/services/src/fournisseurs/langues.ts` changent.

### Rappel des offres jamais ouvertes — worker, 8 h

Distinct de l'expiration, qui **constate** la perte une fois l'échéance passée.
Le rappel intervient avant : une offre envoyée depuis plusieurs jours et jamais
ouverte signale le plus souvent un problème de délivrabilité — adresse erronée,
message en indésirables — qu'aucune relance commerciale ne résoudra.

Le délai est la moitié de la validité de l'offre, plafonnée à 7 jours. Sur une
offre valable 30 jours, alerter au bout de 15 laisserait trop peu de marge ; sur
une offre valable 4 jours, alerter au bout de 2 est le bon moment.

ADMIN et PRESALE sont notifiés. Le rappel n'est émis **qu'une fois** par offre :
faute de colonne dédiée au schéma, l'événement d'audit `offre.rappel_non_consultee`
en est la trace et sert de garde d'idempotence.

### Relance du client avant échéance — worker, 9 h

Troisième job de la même famille, et le seul qui écrive **au client**. Une offre
qui expire sans réponse est presque toujours une offre oubliée, pas une offre
refusée : le refus, lui, arrive vite et explicitement.

Le délai est réglable depuis `/admin` — « Relance du client avant échéance »,
3 jours par défaut. **`0` coupe la relance** sans déployer, pour les équipes qui
préfèrent reprendre contact à la main.

L'ordre des jobs porte une règle métier : un client qui **n'a jamais ouvert**
l'offre n'est relancé que si l'administration a déjà été alertée. Relancer sur un
canal qui n'a manifestement rien délivré échouerait pareillement, et écrire
« votre offre expire » à quelqu'un qui n'a jamais rien reçu est incompréhensible.
Le job vérifie donc la présence de l'événement `offre.rappel_non_consultee` avant
d'écrire, et `relance-client` passe à 9 h, après `rappel-offres` à 8 h.

Le message s'adapte : un client qui a ouvert l'offre reçoit « nous revenons vers
vous », celui qui ne l'a jamais ouverte « nous souhaitions nous assurer qu'elle
vous est bien parvenue ». Prétendre qu'il a étudié la proposition trahirait le
suivi d'ouverture. Comme les RFQ, le courriel est **construit en TypeScript** :
aucun HTML ne vient du modèle, et rien d'interne — marge, prix d'achat, nom de
fournisseur — n'y figure.

PRESALE et ADMIN sont notifiés qu'un message est parti en leur nom, sans quoi un
rappel téléphonique ferait doublon le même jour.

---

## Costing — une offre par fournisseur

Le comparatif signale le prix le plus bas en vert, mais **ne le retient jamais
d'office**. Retenir le moins cher revenait à trancher à la place du client,
alors que le délai, la disponibilité ou la cohérence d'un lot chez un seul
interlocuteur pèsent souvent davantage que quelques dirhams.

### Deux niveaux de comparaison

Le tableau par article ne peut pas tout porter : garantie, conditions de
paiement et validité s'annoncent **une fois pour tout le devis**, pas ligne par
ligne. Une synthèse par fournisseur les précède donc, et l'arbitrage article par
article vient ensuite.

| Critère | Niveau | Origine |
|---|---|---|
| Prix net, remise, disponibilité | ligne | `lignes_devis` |
| Total HT, couverture | fournisseur | calculé |
| Livraison, paiement, garantie, validité | devis | `devis_fournisseur` |

La **couverture** — articles chiffrés sur articles demandés — est affichée à
côté du total et commande le tri. Sans elle, le fournisseur le plus incomplet
paraîtrait systématiquement le moins cher : un total sur trois articles ne se
compare pas à un total sur dix. Pour la même raison, le meilleur prix n'est mis
en évidence **qu'entre devis complets**, et quand aucun ne couvre toute la
demande l'écran le dit plutôt que de désigner un gagnant trompeur.

Un critère absent s'affiche « non précisé » — l'absence est une information au
moment de trancher, et l'extraction n'invente jamais une garantie que le devis
ne mentionne pas.

`garantie` a demandé la seule modification du schéma distant du projet
(`supabase/migrations/20260811_devis_garantie.sql`) : `delai_livraison` et
`conditions_paiement` avaient déjà leur colonne, pas elle, et l'information se
perdait entre le devis reçu et le comparatif.

Deux parcours coexistent depuis l'écran costing :

| Bouton | Résultat |
|---|---|
| « Construire la feuille de coûts » | Une feuille panachée à partir des lignes que vous retenez |
| « Une feuille par fournisseur » | Une feuille — donc une offre — par fournisseur ayant répondu |

Le second produit N offres que le client compare lui-même. Un fournisseur qui
n'a chiffré qu'une partie du besoin produit malgré tout la sienne : les articles
manquants apparaissent dans l'offre sous « Articles non couverts par cette
proposition », calculés par différence entre la demande et la feuille — le
modèle ne les invente pas. L'écarter priverait le client d'une option, et sur
certaines demandes aucun fournisseur ne couvre tout.

Le fournisseur d'une feuille n'est pas une colonne de `cost_sheets` : il se
déduit de `cost_lines.fournisseur_id`. Une feuille dont les lignes viennent de
plusieurs fournisseurs s'affiche donc « Panaché », ce qui distingue les deux
parcours sans toucher au schéma distant.

---

## Le fournisseur répond par formulaire — `/devis/[token]`

Chaque demande de devis porte un bouton « Répondre en ligne », traduit dans les
six langues. Le fournisseur arrive sur un formulaire **déjà rempli** avec les
articles qu'on lui a demandés, et saisit prix unitaire, remise et disponibilité,
puis les quatre conditions du devis — livraison, paiement, garantie, validité.

L'intérêt n'est pas le confort : ce chemin **retire l'extraction du parcours**.
Un prix mal lu par le modèle se propageait jusqu'au costing sans que personne ne
le voie. Ici les données arrivent structurées, `source` vaut `formulaire` et
`confiance_globale` vaut 1 — il n'y a rien à relire.

Les articles sont pré-remplis et **non modifiables** : le fournisseur chiffre ce
qu'on lui demande, il ne réécrit pas le besoin. Laisser la désignation éditable
romprait le rattachement à l'article de la demande, et le comparatif n'aurait
plus rien à aligner.

Chaque ligne peut être **décochée** — « je ne fournis pas cette référence ». Ce
n'est pas un prix à zéro, qui fausserait le comparatif : la ligne n'est
simplement pas enregistrée. Sans cette possibilité, un fournisseur à qui il
manque une référence sur dix renonce à répondre.

Le jeton vit sur `consultations.token_public`, construit comme celui des offres
— 24 octets aléatoires, donc hors de portée d'une énumération. Il **est**
l'autorisation : aucun identifiant interne n'est accepté du formulaire, tout est
retrouvé depuis le jeton. Une consultation `en_validation` renvoie 404 : elle
n'est pas partie, le fournisseur ne peut détenir le lien que par fuite.

Ce que le fournisseur ne voit jamais, vérifié : les autres fournisseurs
consultés, leurs prix, le nom et l'adresse du client final, le code interne de
la demande. Le filtrage se fait à la lecture, avant tout rendu.

`consultation_items` était déclarée au schéma mais **jamais écrite** — elle l'est
désormais à la création de la consultation. Re-déduire les articles par marque à
l'affichage aurait suffi la plupart du temps, mais la marque d'un article peut
changer après l'envoi : le fournisseur aurait alors vu autre chose que ce qu'on
lui avait écrit.

---

## Répondre à un fournisseur depuis la plateforme

Chaque consultation porte son fil de messages, replié par défaut et **ouvert
d'office quand une précision est en attente** — le seul cas qui appelle une
action immédiate.

La réponse part dans le fil d'origine, en `In-Reply-To` du dernier message reçu
du fournisseur et non de notre propre consultation : c'est lui qui porte le fil
côté destinataire, et c'est ce dont dépend l'appariement de sa prochaine
réponse. La consultation repasse alors de « précision demandée » à « envoyée »
et les relances reprennent, sinon le dossier resterait figé sur une question
déjà traitée.

Répondre depuis sa boîte mail resterait possible, mais l'échange échapperait au
dossier et n'apparaîtrait dans aucun historique.

---

## Fournisseur IA commutable

Écart assumé à la spec, qui imposait Gemini : le quota du projet Google est nul.

**Changer de modèle ne demande aucune modification de code** — une clé et, au
besoin, le nom du modèle :

```bash
AI_PROVIDER=anthropic   # ANTHROPIC_API_KEY  (alias : claude)
AI_PROVIDER=openai      # OPENAI_API_KEY
AI_PROVIDER=groq        # défaut, llama-3.3-70b-versatile
AI_PROVIDER=gemini      # GEMINI_API_KEY
AI_PROVIDER=compatible  # AI_API_URL + AI_API_KEY + AI_MODEL
```

`compatible` est la porte de sortie pour tout le reste : la quasi-totalité des
fournisseurs expose aujourd'hui le protocole OpenAI, donc un seul adaptateur
paramétré ([`openaiCompatible.ts`](packages/services/src/ai/openaiCompatible.ts))
couvre DeepSeek, Mistral, OpenRouter, Together, xAI, ainsi que les serveurs
locaux — Ollama, vLLM, LM Studio :

```bash
AI_PROVIDER=compatible
AI_API_URL=http://localhost:11434/v1   # Ollama
AI_API_KEY=ollama
AI_MODEL=llama3.1
```

Claude a son propre adaptateur ([`anthropic.ts`](packages/services/src/ai/anthropic.ts)) :
le protocole diffère — en-tête `x-api-key`, `max_tokens` obligatoire, réponse en
blocs `content[]`, et **aucun mode JSON déclaratif**. La sortie structurée est
obtenue en préremplissant la réponse de l'assistant avec `{`, ce qui interdit au
modèle d'ouvrir sur une phrase d'introduction ; l'accolade est réinjectée au
retour puisqu'elle ne vient pas du modèle.

À défaut de `AI_PROVIDER`, le premier fournisseur configuré est retenu. Les
prompts et les schémas zod sont communs — seul le client HTTP change.

```bash
npm run essai:extraction    # compare deux fournisseurs sur la même demande
```

Toute sortie du modèle est validée par zod avant écriture, avec réinjection de
l'erreur de validation dans le prompt en cas d'échec. Le modèle ne produit
**jamais** de HTML : e-mails et offres sont assemblés par des fonctions
TypeScript déterministes.

La règle vaut aussi pour l'humain. L'écran de consultation édite le *contenu*
du message — introduction, articles, questions, clôture — dans des champs de
texte ordinaires ; `buildRfqHtml()` réassemble le rendu à l'enregistrement, et
la signature est réappliquée automatiquement. À la réouverture, la structure est
relue depuis `corps_texte` par `parseRfqTexte()`, réciproque de
`buildRfqTexte()` : les deux doivent rester alignées.

---

## Envoi de courriels — SMTP ou API Gmail

Deux transports, choisis automatiquement selon ce qui est configuré :

| Transport | Condition | Ce qu'il apporte |
|---|---|---|
| **SMTP** | Un mot de passe d'application | Suffit à tout le flux |
| **API Gmail** | Un `refresh_token` OAuth | Ajoute le label de suivi Gmail |

Le mot de passe d'application qui donne accès à la boîte en IMAP fait aussi
fonctionner l'envoi SMTP : **aucun parcours OAuth n'est nécessaire** pour un
déploiement complet. À défaut de configuration SMTP dédiée, les identifiants
`IMAP_CLIENT_*` sont repris — une installation modeste n'a qu'une boîte.

L'appelant ignore quel transport est actif. L'appariement des réponses repose
sur `Message-ID` / `In-Reply-To`, des en-têtes universels, et non sur le
`threadId` propre à Gmail : c'est ce qui rend le label facultatif.

### Pièces jointes et en-têtes libres

`envoyer` accepte `piecesJointes` — nom, tampon, type MIME — et les **deux
transports** les portent : Gmail par une enveloppe `multipart/mixed` construite
à la main, SMTP par nodemailer. Sans pièce jointe, chacun produit exactement le
message qu'il produisait avant : le flux existant n'est pas emballé pour rien.

`entetes` pose des en-têtes supplémentaires. Il existe pour les **harnais
d'essai**, qui écrivent dans la boîte de la plateforme elle-même : sans
`Auto-Submitted: auto-generated`, leur message revient par la relève, devient
une demande et se bloque faute d'articles. Quatre demandes fantômes sont nées
ainsi avant que le filtre n'existe.

Stamper le message est plus honnête qu'un cas particulier dans la relève : ces
messages **sont** générés sans intervention humaine, et `estCourrierAutomatique`
n'a aucune raison de les traiter autrement que les autres.

```bash
npm run essai:smtp     # envoie un message réel et vérifie qu'il arrive
```

---

## Scripts de vérification

Chaque étape est accompagnée d'un script qui exerce le vrai code, pas une
réimplémentation. Les scripts qui écrivent en base nettoient derrière eux,
même en cas d'échec.

```bash
npm run test:services            # état de chaque service externe
npm run verifier:permissions     # matrice des permissions vs spec
npm run verifier:roles           # navigation visible et gardes de route, par rôle

npm run essai:demande            # dépose un mail de test (XLSX + ZIP) en IMAP
npm run essai:relire -- <uid>    # remet un message en non-lu (idempotence)

npm run essai:sourcing           # sourcing fournisseurs sur marques réelles
npm run essai:repondre           # simule les devis d'une demande (--supprimer)
npm run essai:consultations      # génération des RFQ
npm run essai:planification      # planification d'envoi
npm run essai:relances           # relances et clôture après épuisement
npm run essai:relance-html       # rendu et échappement des relances
npm run essai:parametrage        # gabarits, langues, relances traduites (hors base)
npm run essai:comparatif         # garantie extraite, relance client (hors base)
npm run typecheck                # workspaces ET scripts — les seconds vivent hors workspace
npm run essai:rag                # recherche sémantique de fournisseurs (lit la base)
npm run indexer:historique       # vectorise les devis déjà reçus (rejouable)
npm run essai:bout-en-bout-reel  # parcours complet sur un cas réel, sans envoi
npm run essai:reponse-fournisseur # formulaire fournisseur, sources de demande (hors base)
npm run essai:relance-client     # exécute le job sur l'état réel — PEUT ENVOYER
npm run essai:historique         # chronologie : fusion acte/état, cloisonnement (lit la base)
npm run essai:documents          # BC, pro-forma, facture : gel éprouvé — ÉCRIT ET NETTOIE
npm run essai:whatsapp           # canal de validation : inerte sans clé, actif avec
npm run essai:telegram           # second canal de validation, même garde
npm run essai:costing            # comparatif, colonnes générées, circuit de validation
npm run telegram:contacts        # identifiants de chat des approbateurs (lecture seule)
npm run essai:ia-secours         # bascule entre fournisseurs IA — aucun appel réseau
npm run essai:worker             # LES 7 JOBS + appel IA réel + tri du courrier entrant
npm run essai:envoi-offre        # envoi de l'offre au client — ENVOIE UN VRAI COURRIEL (à soi)

npm run relancer:bloquees        # remet les demandes bloquées en flux (APPLIQUER=1)
npm run purger:bloquees          # les supprime, après sauvegarde JSON (APPLIQUER=1)
SEED_PASSWORD='…' BASE_URL=http://localhost:3000 npm run essai:bout-en-bout  # connexion, offre publique, décision
npm run essai:securite           # RLS, vues, buckets, gardes des Server Actions

npm run essai:smtp               # envoi réel d'un message et contrôle de réception
npm run essai:reception-devis    # étape 8 complète : RFQ, réponse, extraction

npm run essai:devis              # injecte des devis de test (--supprimer)
npm run essai:expiration         # expiration des offres
npm run essai:parcours           # réception → offre, sur une affaire simulée
```

**Tous les harnais vivent dans `scripts/`.** Une seconde série avait grandi
dans `apps/web/scripts/`, avec sa propre lecture de `.env.local` et ses propres
conventions ; elle a été retirée le 2026-08-25. Les trois harnais qu'elle
portait étaient couverts ailleurs — et le plus ancien écrivait `marge_valeur`,
colonne générée depuis, donc échouait à coup sûr. Un harnais qui ne passe plus
est pire qu'absent : on le lance, on lit l'échec comme une régression, et on
cherche là où il n'y a rien. `verifier:roles`, seul à couvrir la navigation par
rôle, a été déplacé plutôt que supprimé.

### Résultats notables

**Extraction des specs** — la marque est déduite de la référence quand elle
n'apparaît nulle part : `SRT3000RMXLI` → APC, `U6-PRO` → Ubiquiti,
`C9200L-48P-4G-E` → Cisco, `P2723DE` → Dell.

**Anonymisation des RFQ** — aucune trace du client final dans les 3 demandes de
devis générées.

**Absence de données internes dans l'offre** — vérifié sur le BoQ stocké *et*
sur le HTML servi au navigateur : aucun des 4 noms de fournisseurs, aucun des
10 prix d'achat, aucun terme interdit.

**Réception d'un devis** — une réponse déposée dans la vraie boîte est appariée
à sa consultation, classée `DEVIS_RECU`, et ses lignes extraites avec le bon
prix **unitaire** (24 500, pas le total) et la remise appliquée en base
(23 275). Les lignes sont rattachées aux articles de la demande.

---

## Déploiement

**Deux processus distincts, et c'est une contrainte d'architecture, pas une
préférence.** Le worker repose sur `node-cron` : il suppose un processus qui
**vit**, il ne se réveille pas sur requête HTTP. Aucun hébergement de fonctions
ne peut l'accueillir — ce qui écarte les plateformes serverless pour ce service,
non par défaut de leur part mais par nature du besoin.

| Processus | Commande | Rôle |
|---|---|---|
| Application web | `next start` — sonde de santé possible sur `/login` | Interface, Server Actions, pages publiques |
| Worker | `node --import tsx apps/worker/src/index.ts` | Sept jobs planifiés (voir [Le worker](#le-worker)) |

L'application web seule est déployable sur n'importe quel hébergeur Node. Le
worker exige un service de type « background worker » ou une machine dédiée.

### Trois contraintes vérifiées, à ne pas redécouvrir

- **Le build web exige les devDependencies.** Un `npm ci` en `NODE_ENV=production`
  les omet — or `tailwindcss`, `postcss`, `autoprefixer` et `typescript` y sont
  déclarés et `next build` en a besoin. Utiliser `npm ci --include=dev`.
- **`tsx` est une dépendance de production du worker.** Les paquets internes
  exportent du `.ts` brut (`main: ./src/index.ts`) : tsx est un besoin
  d'exécution, pas un outil de développement. Rangé en devDependencies, il
  produit un `MODULE_NOT_FOUND` qui n'apparaît qu'une fois déployé.
- **`NEXT_PUBLIC_*` est inlinée dans le bundle AU BUILD**, pas lue à
  l'exécution. Poser la variable après coup n'a aucun effet tant qu'un nouveau
  build n'a pas eu lieu. Vrai pour tout hébergeur.

### Variables d'environnement

Les clés de services externes sont **modifiables depuis `/admin`** et stockées
en base, avec priorité sur l'environnement (voir
[Paramétrage depuis l'interface](#paramétrage-depuis-linterface)). Seul le socle
doit être présent au démarrage :

| Variable | Obligatoire | Rôle |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | oui | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | oui | Clé publique |
| `SUPABASE_SERVICE_ROLE_KEY` | oui | Clé service role — **serveur uniquement** |
| `NEXT_PUBLIC_APP_URL` | oui | Base des liens publics envoyés aux tiers |
| une clé IA | oui | `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` — ou `AI_API_URL` + `AI_API_KEY` + `AI_MODEL` |
| `IMAP_CLIENT_USER` / `IMAP_CLIENT_PASSWORD` | worker | Boîte avant-vente — **mot de passe d'application** |
| `GEMINI_API_KEY` | recommandé | Embeddings de la recherche sémantique |
| `GAMMA_API_KEY` | non | Génération Gamma ; sans elle, le PDF local est produit |
| `TELEGRAM_BOT_TOKEN` | non | Canal de validation |

Aucun secret n'est versionné : `.env.example` ne contient que des clés vides, et
les valeurs vivent dans `apps/web/.env.local`, couvert par `.gitignore`.

---

## Conventions de contribution

### Langue

**Tout est en français** : code, commentaires, noms de variables et de
fonctions, messages d'interface, messages de commit, documentation.
`lireContacts`, `resoudreDestinataires`, `demanderValidation` — pas
`readContacts` ni `getRecipients`. Une base mi-anglaise mi-française oblige à
traduire mentalement à chaque lecture.

Les seules exceptions sont imposées de l'extérieur : noms de colonnes SQL déjà
en base, API tierces, mots-clés du langage.

### Commentaires

Les commentaires disent **pourquoi**, jamais quoi. `// incrémente le compteur`
n'apprend rien ; `// deux workers sur la même minute passent entre la lecture et
l'écriture` explique une garde qu'on aurait supprimée par ignorance. Un
commentaire d'en-tête de fichier situe le rôle du module et la décision qui a
présidé à sa forme.

### Modifier le schéma

Par migration, jamais à la main :

1. Écrire le fichier dans `supabase/migrations/`, daté et commenté
2. Exécuter le SQL dans le tableau de bord Supabase
3. `npm run gen:types` pour régénérer `packages/database/src/database.types.ts`

**Toute nouvelle table doit déclarer `enable row level security` explicitement.**
Aucune politique n'est créée : la plateforme lit par la clé service role, qui
contourne le RLS, et filtre `tenant_id` en application. RLS actif sans politique
= refus par défaut pour `anon` et `authenticated`. Compter sur un défaut de la
plateforme plutôt que de le déclarer a déjà produit une alerte de sécurité.

### Pièges qui coûtent une session entière

| Règle | Ce qui casse sans elle |
|---|---|
| **Node 22 minimum** | `supabase-js` exige un `WebSocket` global, absent de Node 20 : tout appel Supabase côté serveur échoue au démarrage |
| **Une route publique s'ajoute à deux endroits** | Le fichier de page **et** `PUBLIC_PATHS` dans `apps/web/middleware.ts`. L'oubli n'apparaît qu'à l'appel sans session : la page redirige vers la connexion, et le destinataire du lien n'a pas de compte |
| **Ne jamais builder pendant que le serveur de dev tourne** | `next build` écrase le `.next` du serveur en cours, qui sert alors des artefacts incohérents et renvoie des 500 sur des routes qui marchaient |
| **`tailwind.config.ts` n'est lu qu'au démarrage** | Un changement de thème exige de redémarrer le serveur ; toucher le CSS ne suffit pas |
| **Lire les clés par `requis`/`optionnel`** | `chargerSecrets` n'écrit **pas** dans `process.env` : les valeurs vont dans une table de surcharges interne à `env.ts`. Lire `process.env.WHATSAPP_TOKEN` rend `undefined` alors que la clé est bien chargée |
| **Next 16 impose `--webpack`** | Turbopack est activé par défaut et refuse de démarrer devant la config webpack du projet, dont l'`extensionAlias` est indispensable aux imports `.js` des paquets internes |

### Vérifier son travail

**Il n'existe aucun framework de test.** Les scripts `npm run essai:*` sont des
harnais manuels qui frappent la vraie base et la vraie boîte mail. En
conséquence : **ne jamais qualifier un changement de « sûr » ou
« fonctionnellement équivalent »** — dire ce qui a réellement été exécuté.

Avant de livrer : `npm run typecheck && npm run lint`, puis les harnais
concernés (voir [Scripts de vérification](#scripts-de-vérification)).

Deux règles apprises à leurs dépens :

- **Nettoyer, ce n'est pas supprimer : c'est rendre l'état trouvé.** Un harnais
  qui « nettoie » par `delete` sur une clé de configuration détruit la valeur
  réelle de l'utilisateur. Tout script touchant `parametres` passe par
  [`scripts/preserver-parametres.ts`](scripts/preserver-parametres.ts).
- **Lire l'erreur des écritures.** Un `insert` dont l'erreur est ignorée rend un
  défaut invisible : la contrainte d'unicité le refuse en silence, et l'essai
  passe au vert sur une valeur qui n'est pas la sienne.

**Ne jamais expédier un message d'essai à une adresse externe réelle.**

---

## Décisions d'ingénierie notables

### Aucun prix recalculé côté application

`prix_vente_ht`, `total_ligne_ht` et `prix_achat_net_ht` sont des colonnes
`GENERATED ALWAYS AS` en base. L'application ne fait qu'agréger les totaux de
feuille à partir de valeurs déjà produites par Postgres.

Conséquence : le mode « marge brute » est converti en son équivalent markup
**avant écriture**, la formule générée étant celle du markup. `mode_calcul`
garde la trace du mode saisi pour réafficher le bon taux.

### La recherche de fournisseurs vectorise l'historique, pas les fiches

`fournisseurs` ne porte que nom, marque et pays — et une comparaison exacte sur
`marque_norm` fait déjà ce travail. Vectoriser cela n'aurait rien apporté.

Le signal est dans **ce que chacun a réellement chiffré** : un fournisseur ayant
coté quarante équipements réseau EST un fournisseur réseau, quoi qu'en dise sa
colonne `marque`. C'est ce qui permet de proposer Medina Networks sur un besoin
en points d'accès Ubiquiti — il a chiffré des bornes WiFi Aruba, jamais
d'Ubiquiti, et la recherche par marque le manquait.

Une ligne de `lignes_devis` = un vecteur, calculé à la réception du devis et
sur les deux chemins d'entrée, worker comme formulaire en ligne. L'échec est
toujours avalé : un embedding raté ne doit jamais empêcher un devis d'être
enregistré, et `npm run indexer:historique` rattrape.

**1536 dimensions et non 3072**, le défaut de `gemini-embedding-001` : pgvector
plafonne ivfflat et hnsw à 2000, au-delà l'index ne sert plus et chaque
recherche devient un balayage. Gemini accepte `outputDimensionality`, mais la
troncature Matryoshka casse la norme unitaire — les vecteurs sont donc
renormalisés à l'écriture, sans quoi tout passage ultérieur au produit scalaire
donnerait des classements faux.

**Un embedding par article, pas un pour le besoin entier.** Sur un appel
d'offres multi-lots, un vecteur unique moyennerait bornes WiFi, onduleurs et
pare-feux en une bouillie qui ne ressemble à aucun fournisseur.

**Le seuil de 0,72 est mesuré, pas choisi.** Les embeddings Gemini donnent une
similarité de fond élevée : deux textes techniques français sans rapport
tournent déjà à 0,60. Relevé sur les 33 lignes indexées — ≥ 0,85 même produit,
0,72 même domaine, ≤ 0,71 bruit. Un premier seuil à 0,55 faisait paraître que
chaque fournisseur couvrait tout le besoin.

Gemini et non le fournisseur IA courant : Groq, actif ici, n'expose aucune API
d'embeddings. Les deux quotas sont distincts, donc un Gemini épuisé côté
génération reste utilisable.

**`hnsw` et non `ivfflat`**, et c'est une question de justesse. `ivfflat`
partitionne en `lists` cellules et n'en sonde qu'une par défaut : avec 100
listes pour 33 vecteurs, chacune en contient moins d'un, et la recherche
manquerait presque tout dès que le planificateur choisirait l'index. Le
symptôme serait un mauvais classement, jamais une erreur. `hnsw` n'a aucun
paramètre à dimensionner sur la taille de la table.

**La fiabilité ne se fond pas dans le score.** La pertinence dit qui *sait*
fournir, le taux de réponse dit qui *répond* : un nombre unique mêlant les deux
ne s'expliquerait plus, et l'avant-vente ne saurait pas si un fournisseur est
mal placé parce qu'il ne sait pas fournir ou parce qu'il ne répond jamais. Le
taux est affiché à côté et ne départage qu'à égalité de couverture. « Jamais
consulté » n'est pas un taux de 0 : c'est une absence de donnée, et l'afficher
comme un échec condamnerait tout nouveau fournisseur.

**Le modèle est stocké sur chaque vecteur.** Deux modèles d'embedding ne vivent
pas dans le même espace et leurs distances n'ont aucun sens entre elles.
`indexer:historique` détecte les vecteurs d'une génération antérieure, les
supprime **avant** de recalculer — une interruption laisse alors un index
incomplet, qui ne remonte rien, plutôt qu'un index mêlant deux espaces, qui
remonte n'importe quoi.

**Le démarrage à froid est nommé, pas masqué.** Un domaine absent de
l'historique ne remonte rien, et c'est le cas normal d'une première
consultation sur une marque. L'écran liste alors les marques concernées et
propose le sourcing web, plutôt que d'afficher un vide.

### Le sourcing web trouve le distributeur, pas toujours son adresse

`resoudreFournisseurs` cherche d'abord en base, puis lance Firecrawl sur les
marques inconnues et fait extraire le contact par le modèle. L'adresse est
**revalidée en TypeScript** après extraction, le modèle pouvant rendre une
adresse plausible mais inexploitable.

Le cas fréquent n'est pas l'échec de la recherche : c'est **l'absence d'adresse
sur les pages**. Mesuré sur Synology — trois résultats pertinents en 1,2 s,
26 ko de contenu, **zéro adresse dans le texte** : les constructeurs publient un
formulaire de contact, pas un `mailto:`.

Le modèle rend alors un e-mail vide plutôt qu'une adresse inventée, ce qui est
le comportement voulu. Mais le nom et le site trouvés sont **conservés dans le
motif** — « Aucune adresse publiée. Piste trouvée : ASBIS — asbisme.ae ». Les
jeter aurait forcé PRESALE à refaire la recherche à la main.

La marque reste non résolue, aucune consultation n'est créée, et rien ne part à
une adresse devinée.

### L'administrateur n'escalade pas vers lui-même

Le circuit d'approbation a deux entrées, et le rôle de celui qui regarde décide
laquelle s'affiche :

| Qui travaille la feuille | Ce que fait la plateforme |
|---|---|
| Avant-vente | Escalade — la demande part chez l'administrateur par **Telegram**, sinon WhatsApp, sinon courriel. L'accord donné là-bas débloque la génération ici. |
| Administrateur | **Décision sur place**, à l'écran, devant les montants. Rien n'est envoyé. |

Escalader vers soi-même n'a pas de sens : jusqu'au 2026-08-21, un administrateur
qui cliquait « demander l'accord » se réexpédiait son propre lien sur son propre
Telegram, et devait quitter la plateforme pour revenir y valider ce qu'il venait
d'y soumettre. `resoudreApprobateurs` écarte désormais le demandeur de ses
propres destinataires, et l'écran lui propose le bouton d'accord direct.

**La trace ne change pas.** Que la décision vienne de Telegram, du lien public ou
de l'écran, elle s'écrit dans la même ligne de `validations_offre` — avec
`decide_par` renseigné quand un compte connecté l'a prise, et le canal `interne`
quand elle n'est passée par aucun transport. C'est cette ligne, et elle seule,
que `genererOffre` interroge : il n'existe pas de second chemin pour débloquer
une génération.

Un administrateur qui reçoit la demande d'une avant-vente peut aussi trancher
depuis cet écran plutôt que depuis Telegram : la demande en attente est **close**,
pas doublée. Un refus déjà motivé, lui, ne se rattrape pas d'un clic — il faut
reprendre le costing, comme pour l'escalade.

### Un document financier ne relit jamais l'offre

`/documents/[id]` se rend **uniquement** depuis `contenu_json`. Aucune jointure
vers l'offre, la feuille de coûts ou la fiche client au moment de l'affichage.

C'est la raison d'être du gel. Relire l'offre serait plus simple et rendrait le
document faux le jour où un prix bouge — sans que rien ne le signale, jusqu'au
litige. Le client est recopié pour la même raison : une raison sociale corrigée
ne réécrit pas les factures déjà envoyées.

`npm run essai:documents` l'éprouve plutôt que de le supposer : il renomme le
client après émission, relit le document, vérifie que la raison sociale n'a pas
suivi, puis restaure le nom dans un `finally`.

Les totaux sont recalculés depuis les lignes à l'émission, et le harnais refait
chaque ligne : un total repris de la source passerait un contrôle global en
silence.

### Une écriture qui enregistre un fait irréversible lit son erreur

PostgREST ne lève pas d'exception : il rend `{ data, error }`. Un `await` qui
ne regarde pas `error` réussit donc **toujours**, même quand la base a refusé
l'ordre. C'est ce qui a produit [BUG-28](docs/RAPPORT-DEVELOPPEMENT.md#bug-28) —
neuf jours sans qu'aucun total de feuille ne se rafraîchisse.

Le dépôt compte environ cent quarante écritures sans lecture d'erreur. Les
passer toutes en revue n'aurait produit que du bruit : l'écrasante majorité
sont des `audit_events` et des `notifications`, secondaires par nature — faire
échouer l'action de l'utilisateur parce qu'une ligne d'audit n'est pas partie
serait une régression, pas une correction.

La règle retenue, appliquée le 2026-08-25 : **une écriture lit son erreur quand
son échec fait perdre un travail qu'on ne peut pas refaire, ou installe une
boucle.** Cinq l'ont adoptée — le statut d'extraction, l'offre générée, le PDF
d'un document financier, l'affaire gagnée ou perdue par le client, la
consultation close par le formulaire fournisseur. Le détail, cas par cas, est
dans [BUG-30](docs/RAPPORT-DEVELOPPEMENT.md#bug-30).

### Next 16 impose `--webpack`, et les primitives PDF sont retypées

`next dev` et `next build` portent `--webpack` explicitement : Next 16 active
Turbopack par défaut et refuse de démarrer devant une config webpack sans
équivalent Turbopack. Celle du projet n'est pas décorative — `extensionAlias`
apprend à webpack que les imports relatifs en `.js` des paquets internes
désignent des `.ts`.

`@react-pdf/renderer` fonctionne sous React 19, mais ses définitions viennent de
`@react-pdf/types`, écrit pour le JSX de React 18 : 242 erreurs de type sur le
seul gabarit d'offre, dont aucune ne décrit un défaut réel. Le compromis est
rassemblé dans [`pdf-primitives.ts`](apps/web/lib/offres/pdf-primitives.ts) —
cinq lignes à supprimer d'un bloc le jour où l'amont corrige, plutôt que 242
`@ts-expect-error` à retirer un par un.

### L'historique d'une affaire n'a pas de table

`/demandes/[id]/historique` reconstruit la chronologie à la lecture, depuis les
colonnes de date des tables métier, `audit_events` et `communications`.

Une table d'historique aurait été plus simple à lire — et fausse au premier
événement écrit d'un côté et pas de l'autre. Un fait consigné à deux endroits
finit toujours par diverger, et rien ne signale lequel des deux ment.

Le coût est de neuf requêtes en deux vagues sur un écran consulté
ponctuellement. `audit_events` ne portant pas de `demande_id`, il faut connaître
les enfants de l'affaire avant de pouvoir demander ses actes.

Les trois sources se recouvrent : un envoi de demande de devis laisse une trace
dans chacune, et aucune n'est complète seule. Chaque fait porte donc une clé
`entité:id:suffixe` que les trois calculent indépendamment, et à clé égale les
champs sont **fusionnés** plutôt que choisis
([BUG-12](docs/RAPPORT-DEVELOPPEMENT.md#bug-12)).

Le mode de défaillance est délibéré : une action inconnue de la table des clés
apparaît sur sa propre ligne au lieu d'être écartée. **Un doublon se voit à
l'écran ; un événement manquant, non.**

### L'échelle de graisses est décalée d'un cran

`font-normal` vaut 500 et non 400, `font-medium` 580, et ainsi de suite. Inter
étant une police variable de 100 à 900, ce sont de vrais poids interpolés par le
fichier — pas un gras synthétique que le navigateur fabriquerait en épaississant
les contours, lequel se voit tout de suite.

L'échelle entière est décalée plutôt que `font-normal` seul : le retoucher isolé
écraserait l'écart avec `font-medium`, et les deux finiraient par se confondre à
l'écran.

La graisse est aussi posée sur `body`, sans quoi tout texte dépourvu de classe
resterait au 400 du navigateur et cohabiterait avec du 450 — un écart léger mais
visible d'un paragraphe à l'autre.

**Un changement de `tailwind.config.ts` exige un redémarrage du serveur.** Le
fichier n'est lu qu'au démarrage : toucher le CSS ne suffit pas à le recharger,
et on croit le réglage sans effet.

### Les caches de service sont ancrés sur `globalThis`

Next bundle les Server Components et les Server Actions dans **deux graphes
distincts** : un même fichier de service y est instancié deux fois, avec deux
jeux de variables de module. Un cache déclaré en portée de module n'est donc pas
partagé — `invaliderCacheParametres()` appelé depuis une action vidait un cache
que la page ne lisait pas.

Le symptôme était trompeur : l'écran affichait « enregistré », puis remontrait
l'état d'avant, y compris après rechargement, jusqu'à expiration du cache une
minute plus tard. On croyait à un échec d'écriture alors que la base était juste.

[`cacheGlobal.ts`](packages/services/src/cacheGlobal.ts) ancre ces caches sur
`globalThis`, partagé par tous les graphes du même processus. Sans effet sur le
worker, qui n'a qu'un seul graphe — mais sans coût non plus.

En complément, `lireTousGabarits` (l'écran d'administration) lit **toujours
frais** : c'est l'écran depuis lequel on vient d'enregistrer, il ne doit jamais
montrer autre chose que la base.

### Le cache de Next sur les fetch

Next met les `fetch` en cache par défaut, et `supabase-js` passe par `fetch` :
sans précaution, l'application sert un état figé au premier appel. Le client
admin force `no-store`. `dynamic = 'force-dynamic'` ne suffit pas — il rend la
route dynamique, pas les requêtes qu'elle effectue.

### Idempotence

- Réception : garde sur `message_id_client`, message rejoué ignoré.
- Pièces jointes : garde sur `(demande_id, hash_sha256)`.
- Envoi RFQ et relances : verrou optimiste sur le statut ou le compteur, si
  bien que deux cycles concurrents ne peuvent pas envoyer deux fois.

### Ce qui est délibérément déterministe

Les relances ne passent pas par le modèle : elles n'apportent aucune
information nouvelle, et les faire rédiger ferait courir un risque de fuite du
client final pour un gain nul.

### Deux portes d'entrée, un seul tunnel

Une demande naît par e-mail (worker) **ou** à la main
([`/demandes/nouvelle`](apps/web/app/(dashboard)/demandes/nouvelle/page.tsx)) —
beaucoup d'opportunités s'ouvrent par un appel ou une réunion, sans message à
extraire.

La saisie manuelle passe l'extraction IA, puisque les articles sont déjà écrits
par un humain, mais la demande entre en `specs_extraites` : **le même point du
tunnel** qu'une demande reçue par mail. Un seul chemin de validation à
raisonner ensuite, et l'écran d'articles est celui de tout le monde.

Réservée à `demande.creer`, donc à ADMIN et PRESALE. FINANCE ne l'a pas : le
bouton disparaît de la liste **et** la page redirige vers `/403`, l'URL étant
devinable.

### Un avis de non-remise n'est jamais une demande client

Le contrôle vit dans l'aiguillage de réception, pas seulement dans le traitement
des réponses fournisseurs. Un rebond dont le fil d'origine reste introuvable —
celui d'une relance, dont l'en-tête pointe un message que la table ne connaît
pas — retombait sur le flux client et créait une demande fantôme, aussitôt
bloquée faute d'articles. La liste se remplissait de MAILER-DAEMON.

### Un avis de non-remise n'est pas une réponse fournisseur

La détection des rebonds est **déterministe**, jamais confiée au modèle
([`rebond.ts`](packages/services/src/email/rebond.ts)) : soumis au modèle, un
avis de non-remise cite notre propre demande de devis et se fait classer comme
une réponse du fournisseur — la consultation passerait pour traitée alors que
l'adresse est morte.

Trois signaux, du plus fiable au moins fiable : `Content-Type: multipart/report;
report-type=delivery-status` (RFC 3464), un expéditeur `MAILER-DAEMON` ou
`postmaster`, puis un objet connu **combiné** à un en-tête `Auto-Submitted`.

Le statut de la consultation n'est pas modifié et `date_reponse` reste vide ;
seules les relances sont suspendues et PRESALE est notifié pour corriger
l'adresse.

### La planification reste modifiable jusqu'à l'envoi

Une consultation `planifiee` peut être replanifiée ou annulée tant que le worker
ne l'a pas expédiée. La course avec le worker est assumée : les mises à jour
filtrent sur le statut, donc un envoi déjà parti fait échouer l'opération plutôt
que de laisser croire qu'il a été retenu.

### L'écran et le PDF montrent la même maquette

[`DocumentOffre.tsx`](apps/web/lib/offres/DocumentOffre.tsx) (PDF) et
[`RenduOffre.tsx`](apps/web/components/offres/RenduOffre.tsx) (web) reprennent la
maquette commerciale de référence : **onze diapositives 16:9**, fond sombre et
accent bleu, puis une page financière sur fond clair. L'enchaînement est fixe —
couverture, présentation, valeurs, positionnement, domaines, démarche 01-05,
solution, équipements, offre financière, conditions, appel à l'action.

Couleurs, textes institutionnels et format des montants vivent dans
[`maquette.ts`](apps/web/lib/offres/maquette.ts), **importé par les deux**.
Les dupliquer les ferait diverger dès la première retouche : le client verrait un
document à l'écran et un autre en pièce jointe.

Les sept pages institutionnelles ne varient pas d'une offre à l'autre, et les
écrire en TypeScript les met hors de portée du modèle, comme le reste de la mise
en forme. Seules la solution, les équipements, le tableau financier et les
conditions viennent du BoQ.

Les montants suivent le format de la maquette : `151,287.50 DH`, `MAD` étant
rendu « DH ».

Le rendu web est le même sur la page publique et sur l'écran de relecture
interne — c'est ce qui garantit que la relecture montre ce qui part réellement.
En dessous de 768 px le format 16:9 est **levé** : le conserver réduirait le
texte à quelques pixels sur téléphone. Le tableau financier, lui, garde ses
quatre colonnes et défile dans son propre conteneur — les empiler ferait perdre
l'alignement des montants, qui est ce qu'on lit en premier.

### Une ligne de devis sans prix n'est pas stockée à zéro

`prix_achat_ht` est `NOT NULL` en base, alors que la spec interdit d'inventer un
prix absent. Stocker 0 serait le pire choix : dans le comparatif, 0 l'emporterait
comme « meilleur prix » et fausserait la sélection du fournisseur. Ces lignes
sont donc **écartées et signalées** à PRESALE, qui les saisit à la main.

### Sécurité de la page publique

Le BoQ est reconstruit **champ par champ** avant rendu : ce qui n'est pas
explicitement listé ne peut pas atteindre le navigateur, même si le BoQ stocké
gagne des clés plus tard. Le jeton *est* l'autorisation — aucune action
publique n'accepte d'identifiant interne.

### Le pouce baissé ne perd pas le deal

Sur la page publique, le client répond par un pouce levé ou baissé. Le pouce
levé demande une confirmation : c'est un engagement commercial, un clic
accidentel ne doit pas gagner le deal.

Le pouce baissé, lui, ouvre un champ où le client décrit ce qui ne va pas, et le
message part vers PRESALE et ADMIN — **l'offre reste ouverte**. Un client qui
trouve le prix trop élevé n'a pas renoncé au projet ; refermer le dossier sur ce
seul signal ferait perdre des affaires encore négociables, et priverait
l'analyse des pertes d'un motif exploitable.

Le renoncement définitif existe, mais comme action distincte et volontairement
discrète, sous le champ de saisie. C'est lui — et lui seul — qui passe la demande
en `perdue` avec son motif.

Le flux est le même quel que soit le point d'entrée : le bouton « Demander une
modification », plus discret encore, mène au même formulaire. Trois libellés,
deux issues possibles, une seule mécanique.

### Traçabilité

Trois colonnes prévues par la spec (`escalade_finance`, `motif_escalade`,
`validateur_role`) n'existent pas au schéma, qui est intouchable. Les deux
premières vont dans `audit_events` — où la spec les demande de toute façon — et
le motif d'escalade est **recalculé à l'affichage** : un motif figé mentirait
dès que la marge ou les seuils changent.

### Dépendances sensibles

`xlsx` est installé depuis le CDN officiel SheetJS et non depuis npm : le
paquet npm est abandonné en 0.18.5 avec deux failles non corrigées (prototype
pollution, ReDoS), or les tableurs proviennent de pièces jointes non fiables.

---

## Ce qui reste à faire

### Corrigé — l'invitation ne créait aucun moyen de se connecter

L'invitation écrivait un profil dans `users` avec `auth_user_id` à `null`, sans
créer de compte Supabase Auth ni envoyer de courriel. L'adresse était donc
autorisée, mais **aucun mot de passe n'existait nulle part** : « adresse +
mot de passe » était refusé, et seul Google fonctionnait — puisque Google crée
lui-même le compte Auth que `lierProfilApresConnexion` rattache ensuite.

L'invitation crée maintenant le compte Auth et envoie un lien à usage unique
menant à [`/definir-mot-de-passe`](apps/web/app/(auth)/definir-mot-de-passe/page.tsx).

`generateLink` plutôt que `inviteUserByEmail` : il crée le compte **et** rend le
lien sans expédier de message, ce qui laisse l'envoi au SMTP de l'application —
le quota par défaut de Supabase étant trop faible pour être fiable. Aucun mot de
passe ne transite par le courriel, ni n'est connu de l'administrateur.

Le lien expédié n'est **pas** l'`action_link` de Supabase mais une route à nous,
[`/invitation`](apps/web/app/(auth)/invitation/route.ts), qui vérifie le jeton
haché côté serveur. Deux raisons, toutes deux constatées à l'usage : le flux
`recovery` place ses jetons dans le **fragment** de l'URL, que le navigateur
n'envoie jamais au serveur ; et faire pointer `redirect_to` vers
`/callback?redirectTo=…` imbrique une query dans une query — le paramètre se
perdait, et l'invité arrivait connecté sur le tableau de bord sans jamais voir
l'écran de mot de passe. La destination est donc en dur dans la route.

« Renvoyer l'invitation » couvre les profils créés avant ce correctif, qui
existaient sans aucun moyen de se connecter, ainsi que les liens expirés.

**L'étape est obligatoire.** Le lien ouvre une session valide ; sans passage
imposé, l'invité pouvait naviguer ailleurs et se retrouver ensuite sans aucun
moyen de se reconnecter. Un marqueur `mot_de_passe_a_definir` est posé dans les
métadonnées Auth à l'invitation, et le middleware ramène toute navigation vers
`/definir-mot-de-passe` tant qu'il tient. Il est levé dans le même appel que
l'enregistrement du mot de passe — deux appels séparés ouvriraient une fenêtre
où le mot de passe existe mais où la redirection s'applique encore, donc une
boucle.

Le marqueur est aussi levé à une connexion Google réussie : qui s'authentifie
par OAuth dispose déjà d'un accès, lui réclamer un mot de passe n'aurait pas de
sens. Les métadonnées Auth plutôt qu'une colonne : le schéma distant ne se
modifie pas depuis l'application.

### Livré depuis — paramétrage des clés API

Les clés de services et les paramètres métier (seuils d'escalade, marge, délais
de relance, validité des offres) sont modifiables depuis `/admin`, avec priorité
de la base sur les variables d'environnement. Les valeurs sont masquées à
l'affichage et l'accès réservé à ADMIN.

### Identifiants optionnels

| Variable | Ce qu'elle ajoute |
|---|---|
| `GAMMA_API_KEY` | Génération Gamma ; sans elle le PDF local est produit |
| `GMAIL_*_REFRESH_TOKEN` | Label de suivi Gmail ; l'envoi fonctionne sans, en SMTP |

Le code détecte leur absence, se dégrade proprement et conserve les échéances :
rien ne sera à rejouer une fois les clés fournies.

### Points d'attention

- Le quota Gemini est à zéro **côté génération de texte**. Sans conséquence :
  Groq assure ce travail. Le quota d'**embeddings** est distinct et reste
  disponible — c'est lui qu'utilise la recherche sémantique de fournisseurs,
  Groq n'exposant aucune API d'embeddings.
- Les écrans admin « boîtes mail » et « templates » prévus par la spec ne sont
  pas implémentés ; les paramètres métier et la gestion des comptes le sont.
- Le mot de passe de la boîte doit être un **mot de passe d'application**, pas
  le mot de passe du compte, et n'a sa place que dans `apps/web/.env.local`,
  couvert par `.gitignore`.

---

## Commandes utiles

```bash
npm run typecheck     # TypeScript strict sur tout le monorepo
npm run lint          # ESLint
npm run gen:types     # régénère les types Supabase depuis le schéma live
```
