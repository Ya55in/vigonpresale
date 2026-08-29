# Rapport de sécurité

Audit de la plateforme Vigon Presale, correctifs appliqués et décisions en
attente d'arbitrage.

Le journal des bugs fonctionnels est séparé :
[RAPPORT-DEVELOPPEMENT.md](RAPPORT-DEVELOPPEMENT.md).

**Audit du 2026-08-11 · correctifs du 2026-08-12 · revue RAG du 2026-08-12 ·
complétion du 2026-08-17 ([§7](#7-complétion-de-laudit--2026-08-17)) · audit de
mise en ligne du 2026-08-18 ([§8](#8-audit-de-mise-en-ligne--2026-08-18)) ·
audit de clôture du 2026-08-20 ([§9](#9-audit-de-clôture--2026-08-20)).**

> ✅ **Les trois bloquants sont levés (2026-08-18).** Next 16.3.1, React 19.2.8,
> nodemailer 9, node-cron 4 — les CVE qui visaient les Server Actions sont
> fermées, `npm audit` passe de 14 à 6, plus aucune modérée. Et le SQL de
> [SEC-06](#sec-06--trois-vues-contournaient-le-rls-fuite-réelle) **a été
> exécuté** : les trois vues répondent `42501 permission denied` à la clé
> publique, le `service_role` conserve son accès.
>
> Restent deux points **non bloquants**, à arbitrer : la limitation de débit sur
> les pages publiques et la `Content-Security-Policy`.

---

## Résumé pour décision

| | Au 2026-08-11 | Au 2026-08-18 |
|---|---|---|
| **Vulnérabilités** | 14 (9 hautes, 5 modérées) | **6**, toutes hautes, **aucune modérée** |
| **Corrigeables** | 3 par patch | **0** — [pourquoi](#mailparser--il-ny-a-pas-de-correctif-en-amont) |
| **Fuite de données** | non détectée | **trouvée le 17/08, fermée le 18/08** ([SEC-06](#sec-06--trois-vues-contournaient-le-rls-fuite-réelle)) |
| **Version** | Next 14.2.35, React 18 | **Next 16.3.1, React 19.2.8** |
| **Tests de bout en bout** | aucun | **32 contrôles, par HTTP** |

> ✅ **La condition non négociable est levée.** Elle disait : *ne jamais
> déployer sur Next 14*, deux CVE visant directement les Server Actions dont la
> plateforme est entièrement construite — *SSRF in Server Actions* et
> *Unauthenticated disclosure of internal Server Function endpoints*. La
> migration du 18/08 les a fermées.

---

## 1. Périmètre et méthode

Stack auditée : monorepo npm TypeScript, Next.js (App Router), worker Node,
Supabase PostgREST, Zod. Node ≥ 22. Au moment de l'audit initial : Next 14.2.35
et React 18 ; depuis le 18/08, Next 16.3.1 et React 19.2.8.

Points contrôlés : secrets versionnés, injection SQL et de filtres, contrôles
d'autorisation, exécution non sûre, fuite de données vers les pages publiques,
journaux, RLS, dépendances, timeouts réseau.

**Aucun framework de test dans le projet.** Ce qui suit a été vérifié par
exécution manuelle, requêtes directes en base et lecture du code — pas par une
suite qui rejouera demain.

---

## 2. Ce qui était déjà solide

Vérifié, non supposé.

| Contrôle | Résultat |
|---|---|
| Secrets versionnés | Aucun. `.env.local` jamais committé, `.env.example` sans valeur sensible |
| Clé service role | Confinée au serveur — aucun fichier `'use client'` ne l'importe |
| `eval`, `new Function`, `dangerouslySetInnerHTML` | Aucun dans tout le dépôt |
| Autorisations Server Actions | 11 fichiers sur 14 avec garde-fou ; les 3 autres sont publics **par conception** (connexion, mot de passe, page offre) |
| Injection de filtres PostgREST | La seule interpolation exposée à une saisie est **déjà assainie** (`replace(/[%,()]/g, ' ')`) |
| Secrets journalisés | Aucun |
| Timeouts sur appels IA / Gamma / Firecrawl | Présents |
| **RLS Supabase** | La clé publique ne lit **0 ligne** sur `clients`, `demandes`, `offres`, `devis_fournisseur`, `users`, `parametres` |

Le dernier point est le plus important : Supabase est la **seule surface
réellement joignable depuis internet**, et elle est verrouillée.

> ⚠️ **Cette dernière phrase était fausse, et l'est restée six jours.** Le
> contrôle portait sur six *tables*. Les trois *vues* du schéma, elles,
> rendaient tout — voir [SEC-06](#sec-06--trois-vues-contournaient-le-rls-fuite-réelle).

---

## 3. Correctifs appliqués — groupe A

Commit `57d696d`. Trois points corrigeables sans changer de version majeure ni
modifier un comportement métier.

### SEC-01 — Trois CVE hautes fermées

| Paquet | Avant → après | CVE |
|---|---|---|
| `brace-expansion` | 1.1.16 → 1.1.18 (+ 2 copies imbriquées) | DoS par expansion non bornée |
| `js-yaml` | 4.3.0 → 4.3.1 | Consommation CPU quadratique (`!!omap`) |
| `nanoid` | 3.3.16 → 3.3.18 | Boucle infinie si `size` vaut zéro |

Cinq bumps de **patch** uniquement, tous transitifs. Aucun paquet ajouté ni
retiré, aucun changement de version mineure ou majeure. **14 → 11
vulnérabilités.**

### SEC-02 — Une seule implémentation de l'échappement HTML

`echapper()` vivait en **cinq exemplaires strictement identiques**, un par
gabarit de courriel : invitation, envoi d'offre, réponse fournisseur, RFQ,
relance client.

Le risque n'est pas théorique : une fonction de sécurité dupliquée finit par
diverger. Il suffit qu'une copie oublie un caractère au fil d'une retouche pour
ouvrir une injection **sur ce seul canal**, sans que rien ne le signale
ailleurs.

Extraction pure vers [`packages/shared/src/html.ts`](../packages/shared/src/html.ts),
aucun site d'appel modifié — l'import est aliasé sur le nom local.

**Vérifié caractère par caractère** que la sortie reste identique aux cinq
copies, et que la charge utile `<img src=x onerror="alert(1)">&'` est toujours
neutralisée dans la RFQ, la relance fournisseur en arabe et la relance client.

### SEC-03 — Timeout sur le client Supabase

Le client admin n'en avait aucun. Une requête qui n'aboutit pas laissait le
rendu serveur pendant indéfiniment : l'utilisateur regardait une page qui ne
venait jamais, plutôt qu'un message d'erreur.

20 s — assez pour les lectures lourdes du comparatif, assez peu pour libérer le
rendu avant qu'on croie l'application plantée. Un `signal` fourni par l'appelant
reste prioritaire.

### SEC-04 — RLS déclaré explicitement sur la table d'embeddings

`fournisseur_embeddings` a été créée sans `enable row level security` dans la
migration. Vérification faite, Supabase l'avait activé de lui-même : une
écriture avec la clé publique est refusée par politique (`42501`, « new row
violates row-level security policy »), et la lecture ne renvoie aucune ligne.

**Pas exploitable, donc — mais dépendre d'un défaut de plateforme n'est pas une
garantie.** Rejouée sur un autre projet, la migration aurait pu produire une
table ouverte en lecture à la clé anonyme, celle qui est publiée dans le
navigateur. Elle contient les désignations produits et les noms de tous les
fournisseurs.

`alter table … enable row level security` est désormais dans la migration.
Aucune politique n'est créée, délibérément : toute la plateforme lit par la clé
service role, qui contourne le RLS, et filtre `tenant_id` en application. RLS
actif sans politique = refus par défaut, la posture des autres tables.

### SEC-05 — Le type MIME d'un dépôt ne vient plus du navigateur

Le dépôt de cahier des charges reprenait `File.type`, renseigné par le client.
Un fichier nommé `cps.pdf` peut s'annoncer `text/html`, et le stockage le
resservait tel quel. Le bucket est privé et l'accès passe par une URL signée,
mais cette URL s'ouvre dans le navigateur de l'utilisateur — un HTML servi comme
tel y exécuterait son script sur le domaine du stockage.

Le type est maintenant **déduit de l'extension**, elle-même déjà contrainte par
une liste blanche, et c'est cette valeur qui est stockée en base.

Exploitation limitée : il faut être un utilisateur PRESALE authentifié. Corrigé
par principe — une donnée choisie par le client n'a pas à décider comment un
fichier est servi.

### Ce qui a été vérifié sans rien trouver

| Contrôle sur la surface ajoutée | Résultat |
|---|---|
| RLS sur `fournisseur_embeddings` | ✅ actif, écriture anonyme refusée |
| Fonction `chercher_fournisseurs_similaires` | ✅ `SECURITY INVOKER` — le RLS de l'appelant s'applique |
| Vecteur passé en paramètre, pas concaténé | ✅ aucune voie d'injection SQL |
| Buckets `pieces-jointes`, `offres`, `logos` | ✅ tous privés |
| Traversée de chemin par nom de fichier | ✅ `/` remplacé, chemin préfixé d'un hash |
| Taille et format du dépôt | ✅ 15 Mo, liste blanche d'extensions |

---

## 4. Sécurité des deux pages publiques

Deux routes sont accessibles sans authentification. Le jeton **est**
l'autorisation.

| | `/offre/[token]` | `/devis/[token]` |
|---|---|---|
| Destinataire | Client | Fournisseur |
| Entropie du jeton | 24 octets (192 bits) | 24 octets (192 bits) |
| Identifiant interne accepté | Non | Non |
| Champs exposés | Allowlist explicite | Allowlist explicite |
| Statuts ouverts | 6 statuts publics | 5 statuts ; `en_validation` → 404 |

### Tests d'intrusion menés sur `/devis/[token]`

| Entrée | Résultat |
|---|---|
| Jeton court | 404 |
| Jeton inconnu de bonne longueur | 404 |
| `../../admin` | 404 |
| `' OR 1=1--` | 404 |
| Consultation non encore envoyée | 404 |
| Seconde soumission après réponse | Verrouillée |

### Contrôle de fuite

HTML servi au fournisseur comparé aux données réelles de la demande :

| Donnée sensible | Présente ? |
|---|---|
| Nom du client final | ❌ |
| Adresse du client | ❌ |
| Code interne de la demande | ❌ |
| Fournisseurs concurrents | ❌ |
| Prix des devis concurrents | ❌ |
| Marge / costing | ❌ |

---

## 5. Vulnérabilités restantes — arbitrage requis

> **Deux fois corrigé.** Le 17/08, ce paragraphe affirmait que les restantes
> exigeaient toutes une montée majeure, et `npm audit` semblait le démentir pour
> `mailparser`. Le 18/08, la vérification a montré que c'était `npm audit` qui
> se trompait — détail juste en dessous. Le tableau est celui du 2026-08-18.

| Paquet | Actuel → cible | Majeure ? | Note |
|---|---|---|---|
| `mailparser` | 3.9.14 → 3.9.15 | Non, **et sans effet** | Voir ci-dessous. Le passage à 3.9.15 est conservé : il est bénin et amène un `nodemailer` 9 pour l'usage interne de mailparser. |
| `next` | 14.2.35 → **16.3.1** | Oui, ×2 | `headers()`/`cookies()` deviennent asynchrones, `params` devient une Promise. Touche presque tous les fichiers. Entraîne `react` 19 et referme au passage `postcss`. |
| `nodemailer` | 6.10.1 → **9.0.5** | Oui, ×3 | `createTransport` reste stable. Ferme 8 avis dont l'injection SMTP CRLF et la lecture de fichier arbitraire. |
| `node-cron` | 3.0.3 → 4.6.0 | Oui | Ferme aussi `uuid`. API proche. |
| `eslint-config-next` | → 16.3.1 | Oui | `glob` CLI — voir [SEC-15](#sec-15). |

### `mailparser` : il n'y a pas de correctif en amont

`npm audit` annonçait `fixAvailable: true`, ce qui se lit « un correctif existe
dans la plage semver ». C'est faux ici, et la vérification l'a montré :

- l'avis porte sur `deepmerge-ts < 8.0.0`, atteint par `mailparser → html-to-text` ;
- `html-to-text@10.0.0` est la **dernière version publiée**, et elle épingle
  toujours `deepmerge-ts: ^7.1.5` ;
- monter `mailparser` en 3.9.15 ne change donc rien au décompte — mesuré, 14 avant, 14 après.

Restait à forcer `deepmerge-ts@8` par un `overrides`. **Écarté** : cela
franchirait une version majeure dans une bibliothèque qui se trouve sur le
chemin des courriels non fiables, pour refermer un avis qui n'y est pas
atteignable.

Car il ne l'est pas : `deepmergeCustom` n'est appelé que sur les **options** —
`deepMergeWithOptionsComposeRules(defaultOptions, userOptions)` et la
déduplication des sélecteurs. Le HTML analysé ne passe jamais par là. Pour
déclencher l'épuisement de pile, il faudrait fournir un objet d'options
récursif ; ces options sont des constantes de `mailparser`, hors de portée d'un
expéditeur.

**Conclusion : à surveiller, pas à forcer.** Le jour où `html-to-text` monte sa
dépendance, un simple `npm update` suffira.

### Ce que l'exposition réelle change à l'ordre des priorités

Toutes ces CVE ne se valent pas, et le décompte brut le masque.

| Avis | Atteignable ici ? |
|---|---|
| `postcss` — lecture de fichier via `sourceMappingURL` | **Non.** Le seul postcss vulnérable est la copie 8.4.31 interne à Next ; celle du projet est en 8.5.24, hors plage. Et le CSS traité est le nôtre. |
| `glob` — injection de commande | **Non.** Advisory sur l'usage `glob -c` en ligne de commande. Jamais invoqué. |
| `uuid` — dépassement de tampon | **Non.** Concerne v3/v5/v6 avec un `buf` fourni. Le projet n'appelle ni l'un ni l'autre. |
| `nodemailer` — CRLF, SSRF | **Partiellement.** Les paramètres viennent de la base, pas d'un tiers — mais les adresses destinataires, si. |
| `mailparser` — épuisement de pile | **Oui.** L'entrée est un courriel entrant, contenu choisi par l'expéditeur. |
| `next` — SSRF et divulgation d'endpoints Server Actions | **Oui, dès la mise en ligne.** D'où la règle absolue ci-dessus. |

### Points ouverts, non corrigés

**Aucune limitation de débit** sur les pages publiques et leurs actions. Le
jeton à 192 bits rend l'énumération irréalisable, mais un porteur de lien
légitime peut inonder les notifications de l'équipe. Correctif à comportement
visible — le client verrait un refus au-delà de N actions — donc laissé à
l'arbitrage.

**Recherche assainie par liste noire.** `replace(/[%,()]/g, ' ')` couvre les
caractères de syntaxe PostgREST et est correct aujourd'hui. Chaîner des
`.ilike()` plutôt que construire un `.or()` textuel serait plus sûr par
construction. Non fait : la règle « plus petit changement qui résout le
problème » ne s'applique pas — il n'y a pas de problème actuel.

---

## 6. Décision retenue et calendrier

**Fonctionnalités d'abord, migration lourde avant le déploiement.**

Le raisonnement : une CVE a besoin d'un attaquant. Le projet n'est ni déployé,
ni exposé — pas de config de déploiement, pas de CI, `localhost` uniquement — et
le RLS protège la seule surface joignable. Payer 1 à 3 jours de migration
pendant que l'encadrant attend des fonctionnalités n'achèterait aucune sécurité
réelle.

Le déclencheur est **le déploiement**, pas une date.

| Quand | Quoi | État |
|---|---|---|
| Fait | Groupe A — 3 CVE, échappement, timeout | ✅ `57d696d` |
| Fait | SEC-04 et SEC-05 — RLS déclaré, MIME déduit | ✅ |
| Pendant le projet | Fonctionnalités | En cours |
| Avant migration | 3 tests de bout en bout : connexion, envoi d'offre, décision client | ⬜ |
| Avant déploiement | Next 16 + nodemailer 9 + node-cron 4 | ⬜ |
| Avant mise en ligne | Limitation de débit sur les pages publiques | ⬜ |

Les tests ne sont pas un confort : sans eux, la migration Next 16 se vérifie
écran par écran, à la main. Deux bugs de cette session
([BUG-02](RAPPORT-DEVELOPPEMENT.md#bug-02),
[BUG-03](RAPPORT-DEVELOPPEMENT.md#bug-03)) sont passés au travers de `typecheck`
et `lint` — une migration de deux versions majeures en produirait davantage.

---

## 7. Complétion de l'audit — 2026-08-17

L'audit du 2026-08-11 avait un périmètre choisi : douze tables, deux pages
publiques, les dépendances. Cette passe balaie **tout ce que PostgREST et le
stockage exposent**, sans liste préalable, et reprend les surfaces ajoutées
depuis — elles représentent la moitié des fonctionnalités.

### SEC-06 — Trois vues contournaient le RLS (fuite réelle)

**La seule faille exploitable trouvée à ce jour, et elle l'était depuis le
premier jour.**

Une vue PostgreSQL s'exécute par défaut avec les droits de son **propriétaire**,
pas de son appelant. Créées par le rôle propriétaire du schéma, les trois vues
de pilotage traversaient le RLS des tables qu'elles lisent. Le verrou posé sur
`demandes` ou `clients` n'était jamais consulté par ce chemin.

Mesuré avec la seule clé anonyme — celle que le préfixe `NEXT_PUBLIC_` inline
dans le bundle du navigateur, et que lit quiconque ouvre la page de connexion :

| Vue | Rendue à la clé publique |
|---|---|
| `v_consultations_en_attente` | 3 lignes — noms **et courriels** de tous les fournisseurs consultés, marques, codes de demande |
| `v_kpi_tenant` | 1 ligne — chiffre d'affaires, **marge moyenne (31,86 %)**, deals gagnés et perdus |
| `v_pipeline` | 3 lignes — intitulés réels des affaires, dont le nom du projet client |

Gravité **haute** : aucune authentification, aucune énumération, aucun
préalable. Une requête HTTP suffisait.

**Pourquoi l'audit l'avait manquée** — il a énuméré des *tables*, et une vue
n'en est pas une. La liste des douze avait été dressée à partir de ce que le
code **écrit** ; personne n'écrit dans une vue, et aucune de ces trois n'est
lue nulle part dans le dépôt. Invisibles au code, invisibles à l'audit,
parfaitement visibles depuis internet.

**Correctif** — [`20260817_vues_sans_bypass_rls.sql`](../supabase/migrations/20260817_vues_sans_bypass_rls.sql),
deux verrous plutôt qu'un :

1. `security_invoker = on` — la vue s'exécute avec les droits de l'appelant, le
   RLS des tables redevient opposable. Correctif de fond : il tient même si un
   futur `grant` rouvre l'accès par mégarde.
2. `revoke … from anon, authenticated` — ne dépend d'aucune version de
   PostgreSQL, et rend un refus franc plutôt qu'un tableau vide : la vue ne
   confirme même pas son existence.

Aucun risque de régression : `grep` sur tout le dépôt ne trouve **aucun** appel
à ces vues. `service_role` conserve ses droits.

> ✅ **Exécuté le 2026-08-18.** Vérifié en direct, hors du script : la clé
> publique reçoit `42501 permission denied for view` sur les trois, et le
> `service_role` lit toujours `v_kpi_tenant`. Le refus est franc plutôt qu'un
> tableau vide — la vue ne confirme même pas son existence.

### SEC-07 — Le contrôle ne se dresse plus à la main

La cause immédiate est la vue ; la cause de fond est qu'**une liste écrite à la
main ne couvre que ce à quoi on a pensé le jour où on l'a écrite**, pendant que
le schéma continue de grandir. Le script sortait vert sur ses douze tables.

`scripts/essai-securite.ts` lit désormais ses relations dans
`packages/database/src/database.types.ts`, régénéré depuis la base par
`npm run gen:types`. Toute table et toute vue nouvelle entre dans le contrôle
sans que personne ait à y penser.

**29 → 58 contrôles** (50 sans `BASE_URL`, qui ajoute les 8 routes).

| Ajouté | Résultat |
|---|---|
| 30 tables (au lieu de 12), lues dans le schéma | ✅ 0 ligne partout |
| **3 vues** | ❌ **3 fuites** — voir SEC-06 |
| `chercher_fournisseurs_similaires` appelée en anonyme, vecteur quasi nul | ✅ rien ne sort (`SECURITY INVOKER` confirmé à l'exécution) |
| 3 buckets : privés **et** listage anonyme vide | ✅ |
| Chaque Server Action du tableau de bord appelle un garde-fou | ✅ 17 fichiers, 0 manquant |
| Aucun `.env` suivi par git **ni présent dans l'historique** | ✅ |

### Surfaces postérieures à l'audit, contrôlées ici

Le tableau du [§4](#4-sécurité-des-deux-pages-publiques) ne couvrait que deux
pages publiques. Une troisième est née depuis.

| | `/validation/[token]` |
|---|---|
| Destinataire | Administrateur, hors session |
| Entropie du jeton | 24 octets (192 bits) |
| Identifiant interne accepté | Non — validation, tenant et feuille retrouvés depuis le jeton |
| Rejeu | Bloqué : l'`update` est conditionné à `statut = 'en_attente'` |
| Expiration | Contrôlée avant écriture |
| Jeton inconnu | 404 |

**Dépôt de fichier par un tiers non authentifié** — le formulaire fournisseur
accepte un document. Chemin le plus sensible du produit : l'auteur n'a aucun
compte. Vérifié qu'il partage le noyau de [SEC-05](#sec-05--le-type-mime-dun-dépôt-ne-vient-plus-du-navigateur)
et n'en assouplit rien : 15 Mo, liste blanche d'extensions, MIME **déduit** de
l'extension, nom assaini et préfixé d'un hash, bucket privé. Un échec de dépôt
ne perd pas le devis saisi — il est signalé, pas avalé.

**Les 17 fichiers d'actions** — 10 actions du tableau de bord, toutes gardées ;
4 publiques par jeton ; 3 d'authentification, publiques par conception. Le
contrôle est désormais statique et rejoué à chaque passage du script : une
action ajoutée sans garde-fou fait sortir le script en échec.

### Ce qui reste ouvert après cette passe

| Point | État |
|---|---|
| SQL de SEC-06 | ✅ exécuté le 18/08 |
| `mailparser` | ⬜ corrigeable sans montée majeure, non appliqué : la règle du projet est de ne pas toucher aux CVE sans demande |
| Limitation de débit sur les pages publiques | ⬜ inchangé — comportement visible, arbitrage requis |
| 3 tests de bout en bout avant la migration Next 16 | ⬜ inchangé |
| Jetons de `validations_offre` | ~~ aucun en base : leur entropie est écrite, pas encore éprouvée à l'exécution |

---

## 8. Audit de mise en ligne — 2026-08-18

**Le déclencheur du report vient d'arriver.** Tout ce qui précède reposait sur
une phrase : *une CVE a besoin d'un attaquant, et le projet n'est ni déployé ni
exposé*. Cette phrase cesse d'être vraie le jour du déploiement, et tout ce
qu'elle couvrait redevient exigible d'un coup.

### Verdict

> 🚫 **Ne pas déployer en l'état.** Trois points bloquants, dont un qui fuit
> déjà et deux que la règle du projet interdit d'emporter en ligne.

### Bloquants

| | Point | Pourquoi maintenant |
|---|---|---|
| **B1** | [SEC-06](#sec-06--trois-vues-contournaient-le-rls-fuite-réelle) — SQL non exécuté | La fuite est **active**. Aujourd'hui il faut connaître l'URL Supabase ; en ligne, elle est dans le bundle de la page d'accueil. |
| **B2** | Next 14.2.35 → 16 | Règle absolue du projet. *SSRF in Server Actions* et *Unauthenticated disclosure of internal Server Function endpoints* visent l'architecture entière de la plateforme. |
| **B3** | nodemailer 6.10.1 → 9 | Injection SMTP CRLF et lecture de fichier arbitraire. Les adresses destinataires viennent de l'extérieur — courriels fournisseurs saisis, adresses de réponse. |

### SEC-08 — Le jeton d'autorisation fuit par l'en-tête `Referer`

Les pages publiques portent leur autorisation **dans l'URL** :
`/offre/<jeton>`. C'est un choix sain — 192 bits, inénumérable. Mais la page
d'offre charge les visuels produits par `<img src={…}>` depuis le stockage
Supabase, donc **une autre origine**.

Sans `Referrer-Policy`, le navigateur joint alors à chaque requête d'image
l'en-tête `Referer: https://…/offre/<jeton>`. Le jeton part chez un tiers, et
atterrit dans ses journaux d'accès.

La portée est aujourd'hui contenue : les visuels sont systématiquement
recopiés dans le stockage, jamais laissés en URL distante — vérifié dans
`photos.ts`. Le tiers est donc l'hébergeur de la plateforme. Mais le mécanisme,
lui, est général : le jour où une image externe passe, le jeton part chez
n'importe qui.

**Sans objet sur `localhost`**, où aucune de ces requêtes ne quitte la machine.
C'est exactement le genre de faille que seul le déploiement crée.

Correctif : `Referrer-Policy: strict-origin-when-cross-origin` (ou plus strict),
dans les en-têtes de `next.config.mjs`.

### SEC-09 — Aucun en-tête de sécurité

`next.config.mjs` ne déclare aucun en-tête. Manquent notamment `Strict-Transport-Security`
— le jeton voyage dans l'URL, une seule requête en clair l'expose —,
`X-Content-Type-Options: nosniff` et `X-Frame-Options`.

Le détournement de clic reste peu crédible ici : encadrer la page d'offre exige
d'en connaître le jeton, et qui le connaît peut approuver directement. L'en-tête
est bon marché, mais ce n'est pas lui qui presse — c'est HSTS.

### SEC-10 — URL signées valides un an

`createSignedUrl(chemin, 60 * 60 * 24 * 365)`, en trois endroits. Ces URL
partent dans les offres envoyées aux clients.

Une URL signée est un jeton porteur : transférée dans un courriel, gardée dans
un historique de navigation ou un journal de proxy, elle ouvre le fichier
pendant douze mois. Sur un poste local, sans objet ; en ligne, c'est une
autorisation qu'on ne peut plus retirer.

Une durée alignée sur la validité de l'offre — trente jours — couvrirait le
besoin réel.

### SEC-11 — Repli silencieux sur `localhost`

`process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'`, en **huit
endroits**, dont la génération des liens d'offre, de devis et de validation.

Ce n'est pas une faille, c'est une panne silencieuse : une variable oubliée à la
mise en ligne, et tous les liens envoyés aux clients et aux fournisseurs
pointent vers la machine du destinataire. Rien ne casse au démarrage, rien
n'apparaît dans les journaux — les liens partent, et personne ne répond.

Un échec au démarrage vaut mieux qu'un repli : en production, l'absence de cette
variable doit arrêter le processus.

### SEC-12 — Aucune limitation de débit, et un corps de 10 Mo accepté sans compte

Point déjà connu, dont la gravité change d'échelle. `serverActions.bodySizeLimit`
vaut **10 Mo**, et le formulaire fournisseur est accessible **sans
authentification** au porteur d'un jeton. Sans limitation de débit, une boucle
sur cette action suffit à saturer la bande passante et le stockage.

Au passage : cette limite de 10 Mo est **inférieure** aux 15 Mo qu'annonce la
liste blanche de `depot.ts`. Un devis de 12 Mo est rejeté par Next avant que la
validation ne s'exécute, et le fournisseur reçoit une erreur générique au lieu
du message qui lui dirait quoi faire. Les deux valeurs doivent s'accorder.

### Ce qui tient déjà pour la mise en ligne

| Contrôle | Résultat |
|---|---|
| Clé service role | Confinée à deux fichiers serveur ; aucun composant client ne l'importe |
| 30 tables en RLS | 0 ligne pour la clé publique |
| 3 buckets | Privés, listage anonyme vide |
| 18 fichiers de Server Actions | Toutes celles du tableau de bord gardées |
| Secrets | Aucun `.env` suivi par git, ni dans l'historique |
| Journaux | Aucun secret journalisé |
| Middleware | Couvre tout hors statiques ; les 5 chemins publics sont volontaires et existent |

### Ordre de marche

| Ordre | Quoi | État |
|---|---|---|
| 1 | **SQL de SEC-06** | ✅ exécuté et vérifié — `42501` pour la clé publique |
| 2 | SEC-08, SEC-09, SEC-11, SEC-12 | ✅ fait |
| 3 | SEC-10 — visuels re-signés à l'affichage | ✅ fait |
| 4 | **3 tests de bout en bout** | ✅ fait — `npm run essai:bout-en-bout`, 32 contrôles |
| 5 | **Next 16 + React 19** | ✅ fait — 16.3.1 / 19.2.8 |
| 6 | `nodemailer` 9, `node-cron` 4, `googleapis` 175 | ✅ fait |
| 7 | Limitation de débit | ⬜ comportement visible côté client : à décider, pas à subir |
| 8 | `Content-Security-Policy` | ⬜ demande des nonces et une vérification écran par écran |

### La migration, et ce qu'elle a coûté

Faite le 2026-08-18, validée par les tests écrits la veille pour elle.

| Obstacle | Résolution |
|---|---|
| 243 erreurs `TS2786` | Deux `@types/react` cohabitaient — 18 hissée à la racine par Radix, 19 dans le web. Ni un `overrides` ni une réinstallation ciblée n'ont suffi : il a fallu **régénérer le lockfile**. |
| 242 erreurs sur le gabarit PDF | `@react-pdf/renderer` marche sous React 19 mais ses types viennent de `@react-pdf/types`, écrit pour le JSX de React 18. Compromis **rassemblé** dans `pdf-primitives.ts`, cinq lignes à retirer d'un bloc — plutôt que 242 `@ts-expect-error` disséminés. |
| Build refusé | Next 16 active Turbopack par défaut et bute sur la config webpack du projet. `--webpack` explicite : `extensionAlias` existe pour une vraie raison. |
| `UnsafeUnwrappedCookies` | Le codemod officiel avait posé ce contournement de transition, que Next 16 ne fournit même plus. `createClient()` est devenue asynchrone, et ses huit appelants l'attendent. |
| `next lint` supprimé | Le script appelle `eslint` directement. `eslint-config-next@16` exige eslint 9 et la config plate : reporté, c'est de l'outillage. |
| nodemailer figé en 6.10.1 | Une entrée périmée du lockfile, que `npm install` ne réconciliait pas malgré le bon spécificateur. Retirée à la main. |

**Vérifié après migration** : build complet, 32 contrôles de bout en bout,
`essai:securite`, `essai:documents`, `essai:historique`, `verifier:permissions`
(18/18), `essai:reponse-fournisseur`, `essai:contacts`, `essai:parametrage`, et
le démarrage du worker sur `node-cron` 4 — six jobs planifiés, l'un exécuté.

### Correctifs appliqués le 2026-08-18

| | Ce qui a changé |
|---|---|
| **SEC-08** | `Referrer-Policy: strict-origin-when-cross-origin`. Le jeton ne part plus dans l'en-tête `Referer` des requêtes de visuels. |
| **SEC-09** | HSTS deux ans avec sous-domaines, `nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy`. **Pas de CSP** : Next 14 injecte des scripts en ligne qui exigent des nonces, et une CSP posée sans être éprouvée casse l'application en silence. À écrire pendant la migration, où le rendu change de toute façon. |
| **SEC-10** | Les visuels de la page publique sont **re-signés à l'affichage**, pour une heure. L'URL figée d'un an reste en base : la raccourcir à la source aurait cassé les offres déjà émises, puisqu'elle est gelée dans `source_json`. Le chemin de l'objet se relit dans l'URL figée, donc aucun `source_json` à migrer. Repli silencieux sur l'URL d'origine si la re-signature échoue — un visuel manquant vaut mieux qu'une offre qui ne s'affiche pas. |
| **SEC-11** | `urlApplication()` dans `@vigon/shared`, appelée aux huit sites. En production, l'absence de `NEXT_PUBLIC_APP_URL` **arrête le processus** au lieu de se replier sur `localhost`. Un échec au démarrage se voit ; des courriels partis vers `localhost`, non. |
| **SEC-12** | `bodySizeLimit` porté de 10 à 16 Mo, pour s'accorder avec les 15 Mo de la liste blanche des dépôts. La limitation de débit, elle, reste ouverte. |

---

## 9. Audit de clôture — 2026-08-20

Aucune régression : `essai:securite` passe ses contrôles, les jetons publics
tiennent l'entropie, les 19 fichiers d'actions ont tous leur garde, et les trois
points signalés restent ceux déjà connus — la CSP, la limitation de débit, et
les 6 CVE non corrigeables.

Deux défauts trouvés : une faille d'autorisation introduite le jour même, et une
justification fausse dans **ce rapport**.

### SEC-14 — Un document envoyé au client d'une autre affaire {#sec-14}

`envoyerDocumentAuClient`, écrite le 2026-08-20, lisait le document par
`lireDocument(tenant, documentId)` — qui ne contrôle **que le locataire** — puis
résolvait l'adresse du destinataire à partir du `demandeId` reçu du formulaire.

Les deux identifiants n'étaient jamais rapprochés. Un `documentId` forgé faisait
donc partir la **facture d'une autre affaire du même locataire** à l'adresse
client de celle-ci : deux dossiers distincts, une pièce comptable chez le mauvais
destinataire, et rien pour le signaler.

C'est la classe de défaut la plus banale et la plus coûteuse : deux identifiants
qui viennent du client, dont un seul est vérifié. La garde de permission était
bien là — `document.emettre` — et elle ne servait à rien ici, l'attaquant étant
un utilisateur légitime.

**Correctif** : le rapprochement se fait sur la donnée en base, `doc.demandeId
!== demandeId` → « Document introuvable ». Le même message que pour un document
absent, pour ne pas révéler l'existence d'une autre affaire.

Trouvé à la relecture du code écrit dans la journée, avant toute mise en ligne.

### SEC-15 — Une justification fausse dans ce rapport {#sec-15}

Ce document affirmait, à propos de l'avis sur `glob` :

> `glob` CLI. **Outillage seul**, jamais embarqué dans le rendu.

**La seconde phrase est fausse.** `npm ls glob` place le paquet dans l'arbre de
production :

```
@vigon/services → googleapis@175 → googleapis-common → gaxios@7.1.3
                → rimraf@5.0.10 → glob@10.3.10
```

La conclusion — l'avis n'est pas atteignable — reste juste, mais pour une **tout
autre raison** : l'avis GHSA-5j98-mcp5-4vw2 vise la **CLI** de `glob`, son option
`-c/--cmd` qui exécute les correspondances avec `shell: true`. Ni `rimraf` ni
`@next/eslint-plugin-next` n'appellent cette CLI ; ils utilisent la bibliothèque.

Ce qui protège ici est **la surface visée, pas l'emplacement du paquet**.

Pourquoi ça compte : une justification fausse se recopie. Le jour où `googleapis`
tirerait un paquet dont l'avis vise la bibliothèque, quelqu'un rouvrirait ce
tableau, lirait « outillage seul », et classerait sans regarder.

**Correctif retenu : aucun changement de dépendance.** `glob@10.5.0` ferme
l'avis, mais l'imposer demanderait un `overrides` qui force la version épinglée
par `@next/eslint-plugin-next` — pour faire taire un avis inatteignable. Même
arbitrage que pour `mailparser`. C'est la raison écrite qui est corrigée, pas la
conclusion, qui tenait déjà.

---

## 10. Commandes de contrôle

```bash
npm run essai:securite       # rejoue les 55 contrôles ci-dessus
npm audit                    # état des vulnérabilités
npm outdated                 # écart de versions
npm run typecheck && npm run lint
```

Avec le serveur de développement en marche, les routes sont contrôlées aussi :

```bash
BASE_URL=http://localhost:3000 npm run essai:securite
```

---

## 11. Nettoyage — 2026-08-25

### SEC-16 — Une table de champs interdits que personne n'appliquait {#sec-16}

`apps/web/lib/auth/permissions.ts` déclarait :

```ts
/** Champs interdits par rôle dans les réponses API */
export const CHAMPS_INTERDITS = {
  after_sales: ['prix_achat_ht', 'marge_pct', 'fournisseur_nom', …],
  …
};
```

**Rien ne la lisait.** Ni garde, ni filtre, ni écran — vérifié sur tout le
dépôt, scripts compris. Elle décrivait un filtrage de « réponses API » pour une
API REST qui n'a jamais existé : la plateforme rend des Server Components.

Le cloisonnement réel existe, et il est **plus solide** que ce qu'elle
promettait. L'écran après-vente ne demande jamais un prix d'achat :

```ts
.select('id, code, titre, date_decision, deadline, clients(nom, email_principal, telephone)')
```

Une liste blanche à la requête ne peut pas laisser passer une colonne oubliée,
là où une liste noire appliquée après coup laisse fuir tout ce qu'on n'a pas
pensé à y inscrire — et il aurait fallu l'étendre à chaque colonne ajoutée.

**Pourquoi la retirer plutôt que la laisser dormir.** Une constante de sécurité
que personne n'applique se lit comme une protection en place. Le jour où
quelqu'un ajoute un écran pour AFTER_SALES, il la trouve, la croit active, et
sélectionne large. Le commentaire qui la remplace dit ce qui protège réellement.

Aucune régression : `npm run verifier:roles` et `npm run verifier:permissions`
passent, et `essai:bout-en-bout` confirme les refus de route par rôle.
