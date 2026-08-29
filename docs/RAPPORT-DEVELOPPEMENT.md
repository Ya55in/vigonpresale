# Rapport de développement — bugs trouvés et corrections

Journal des anomalies rencontrées pendant le développement, étape par étape.
Chaque entrée porte une référence stable, citable en revue ou en soutenance.

Le rapport de sécurité est séparé : [RAPPORT-SECURITE.md](RAPPORT-SECURITE.md).

**Dernière mise à jour : 2026-08-21.**

---

## Avertissement sur la portée des vérifications

Le projet n'a **aucun framework de test** — ni Vitest, ni Jest, ni Playwright,
ni CI. Les scripts `npm run essai:*` sont des harnais manuels qui frappent la
vraie base et la vraie boîte mail.

Aucune correction listée ici ne peut donc être qualifiée de « prouvée ». Ce qui
est écrit en colonne « Vérifié par » est ce qui a réellement été exécuté :
`typecheck`, `lint`, un script d'essai, un aller-retour à l'écran ou une
requête en base. Rien de plus.

---

## Récapitulatif

| Réf | Sévérité | Zone | État |
|---|---|---|---|
| [BUG-01](#bug-01) | 🔴 Bloquant | Paramétrage admin | Corrigé |
| [BUG-02](#bug-02) | 🔴 Bloquant | Formulaire fournisseur | Corrigé |
| [BUG-03](#bug-03) | 🟠 Majeur | Formulaire fournisseur | Corrigé |
| [BUG-04](#bug-04) | 🟠 Majeur | Consultations | Corrigé |
| [BUG-05](#bug-05) | 🟡 Mineur | Comparatif | Corrigé |
| [BUG-06](#bug-06) | 🟡 Mineur | Migration `source` | Corrigé |
| [BUG-07](#bug-07) | 🟠 Majeur | Fil de consultation | Corrigé |
| [BUG-08](#bug-08) | 🟠 Majeur | Scripts non typés | Corrigé |
| [BUG-09](#bug-09) | 🟠 Majeur | Police de l'interface | Corrigé |
| [BUG-10](#bug-10) | 🟡 Mineur | Seuil de similarité | Corrigé |
| [BUG-08](#bug-08) | 🟠 Majeur | Lancement | Corrigé |
| [BUG-09](#bug-09) | 🔴 Bloquant | Circuit de validation | Corrigé |
| [BUG-10](#bug-10) | 🟠 Majeur | Connexion | Corrigé |
| [BUG-11](#bug-11) | 🟡 Mineur | Historique d'affaire | Corrigé |
| [BUG-12](#bug-12) | 🟠 Majeur | Historique d'affaire | Corrigé |
| [BUG-13](#bug-13) | 🟡 Mineur | Historique d'affaire | Corrigé |
| [BUG-14](#bug-14) | 🔴 Bloquant | Envoi de l'offre au client | Corrigé |
| [BUG-15](#bug-15) | 🟡 Mineur | Restes de React 18 | Corrigé |
| [BUG-16](#bug-16) | 🟠 Majeur | Lien public d'offre | Corrigé |
| [BUG-17](#bug-17) | 🟠 Majeur | Tri du courrier entrant | Corrigé |
| [BUG-18](#bug-18) | 🔴 Bloquant | Demandes bloquées | Corrigé |
| [BUG-19](#bug-19) | 🟡 Mineur | Chaîne IA au démarrage | Corrigé |
| [BUG-20](#bug-20) | 🟠 Majeur | Copie visible sur Gmail | Corrigé |
| [BUG-21](#bug-21) | 🟠 Majeur | Harnais s'auto-empoisonnant | Corrigé |
| [BUG-22](#bug-22) | 🟠 Majeur | Filtre du courrier automatique | Corrigé |
| [BUG-23](#bug-23) | 🟠 Majeur | Simulateur de devis | Corrigé |
| [BUG-24](#bug-24) | 🟡 Mineur | Job de reprise sans borne | Corrigé |
| [BUG-25](#bug-25) | 🔴 Bloquant | Harnais effaçant des clés réelles | Corrigé |
| [BUG-26](#bug-26) | 🔴 Bloquant | Comparatif — offres inatteignables | Corrigé |
| [BUG-27](#bug-27) | 🔴 Bloquant | Circuit d'approbation inatteignable | Corrigé |
| [BUG-28](#bug-28) | 🔴 Bloquant | Totaux de feuille jamais rafraîchis | Corrigé |
| [BUG-29](#bug-29) | 🟠 Majeur | L'administrateur s'escaladait à lui-même | Corrigé |
| [ENV-01](#env-01) | ⚪ Environnement | Build / serveur | Contourné |
| [ENV-02](#env-02) | ⚪ Environnement | Build Edge Runtime | Connu, non traité |

---

## Étape 1 — Paramétrage depuis l'interface

### BUG-01 {#bug-01}

**Un prompt rétabli restait affiché comme modifié, même après rechargement.**

| | |
|---|---|
| **Symptôme** | L'écran affichait « enregistré », puis remontrait l'état d'avant. Le compteur restait bloqué sur « 1 modifié(s) » pendant une minute. |
| **Découvert** | En testant le cycle défaut → retouche → rétablissement sur `/admin`. |
| **Fausse piste** | L'écriture semblait avoir échoué. Une requête directe a montré que la base était juste : `aucune ligne prompt`. |
| **Cause réelle** | Next bundle les Server Components et les Server Actions dans **deux graphes distincts**. Un même fichier de service y est instancié deux fois, avec deux jeux de variables de module. `invaliderCacheGabarits()` appelé depuis l'action vidait un cache que la page ne lisait pas. |
| **Portée** | Touchait aussi `lireParametres`, **défaut préexistant** à ce travail. |
| **Correction** | [`packages/services/src/cacheGlobal.ts`](../packages/services/src/cacheGlobal.ts) — les caches sont ancrés sur `globalThis`, partagé par tous les graphes du même processus. En complément, `lireTousGabarits` lit toujours frais : c'est l'écran depuis lequel on vient d'enregistrer. |
| **Vérifié par** | Cycle 0 → 1 → 0 rejoué à l'écran sans rechargement, et `npm run essai:gabarits` sur la vraie base. |

---

## Étape 2 — Comparatif fournisseurs

### BUG-05 {#bug-05}

**Le fournisseur le plus incomplet paraissait le moins cher.**

| | |
|---|---|
| **Symptôme** | Sur la demande d'essai, UBSM affichait 19 980 MAD contre 292 626 à Atlas — mais ne chiffrait qu'un article sur quatre. |
| **Nature** | Défaut de conception détecté avant livraison, pas une régression. |
| **Cause** | Comparer des totaux à périmètre inégal n'a aucun sens. Sans indicateur de couverture, l'écran désigne un gagnant trompeur. |
| **Correction** | [`SyntheseFournisseurs.tsx`](../apps/web/components/costing/SyntheseFournisseurs.tsx) — la couverture (articles chiffrés / demandés) est affichée à côté du total et **commande le tri**. Le meilleur prix n'est mis en évidence **qu'entre devis complets** ; quand aucun ne couvre tout, l'écran le dit au lieu de trancher. |
| **Vérifié par** | Écran : Atlas (4/4) en vert, UBSM (1/4) non mis en avant malgré le montant le plus bas. |

---

## Étape 3 — Formulaire de réponse fournisseur

### BUG-02 {#bug-02}

**La page `/devis/[token]` renvoyait 500 — API React inexistante.**

| | |
|---|---|
| **Symptôme** | `TypeError: useActionState is not a function or its return value is not iterable`. Page totalement inaccessible. |
| **Cause** | J'avais écrit `useActionState`, une API **React 19**, alors que le projet est en **React 18.3.1** avec Next 14. Le typecheck ne l'a pas vu : les types `@types/react` 18 l'exposent, l'implémentation non. |
| **Leçon** | Un typecheck vert ne garantit pas l'existence à l'exécution. Les autres formulaires du projet utilisaient déjà le bon patron — j'aurais dû le lire avant d'écrire. |
| **Correction** | [`FormulaireDevis.tsx`](../apps/web/components/consultations/FormulaireDevis.tsx) — `useState` + `useTransition` avec `onSubmit`, exactement le patron de `formulaire-demande.tsx` et `DecisionClient.tsx`. |
| **Vérifié par** | Page servie en 200, soumission complète jusqu'à la création du devis en base. |

### BUG-03 {#bug-03}

**Une ligne décochée faisait échouer toute la saisie.**

| | |
|---|---|
| **Symptôme** | Message « Prix invalide » alors que tous les articles cochés portaient un prix correct. |
| **Cause** | Le formulaire poste **toutes** les lignes, y compris celles que le fournisseur a décochées. Leur champ prix vide (`""`) était lu comme un montant illisible → `NaN` → refus. `.optional()` ne protégeait pas : la chaîne vide est présente, pas absente. |
| **Impact métier** | Bloquant. Un fournisseur ne fournissant pas une référence sur dix ne pouvait rien envoyer — exactement le cas que la case à cocher devait servir. |
| **Correction** | [`reponseFournisseur.ts`](../packages/shared/src/schemas/reponseFournisseur.ts) — `z.preprocess` traduit `''` et `null` en `undefined` avant le parsing du montant. Une absence n'est pas une erreur. Le contrôle métier `validerReponse` prend le relais et distingue « coché sans prix » de « non fourni ». |
| **Vérifié par** | `npm run essai:reponse-fournisseur` — cas nominal, ligne décochée, coché sans prix, prix négatif, remise > 100 %, aucune ligne. |

### BUG-04 {#bug-04}

**`consultation_items` était déclarée au schéma mais jamais écrite.**

| | |
|---|---|
| **Symptôme** | Le formulaire affichait « Aucun article à chiffrer » sur toutes les consultations existantes. |
| **Cause** | Le regroupement des articles par marque se faisait **en mémoire** au moment de rédiger la RFQ, et le lien n'était jamais persisté. La table existait, vide, depuis l'origine du projet. |
| **Option écartée** | Re-déduire les articles par marque à l'affichage. Rejetée : la marque d'un article peut changer après l'envoi, et le fournisseur aurait alors vu autre chose que ce qu'on lui avait écrit. |
| **Correction** | [`consultations.ts`](../packages/services/src/fournisseurs/consultations.ts) — les liens sont écrits à la création. `ArticleDemande` porte désormais l'`id`, propagé depuis les deux appelants. L'échec du rattachement est **non bloquant** : la consultation part quand même, seul le formulaire en ligne est privé d'articles. |
| **Vérifié par** | Formulaire affichant les 4 articles réellement consultés, sur deux consultations distinctes. |

---

## Étape 4 — Trois portes d'entrée

### BUG-06 {#bug-06}

**Le rattrapage des demandes existantes les étiquetait toutes « courriel ».**

| | |
|---|---|
| **Symptôme** | `demandes.source` ayant pour défaut `'email'`, toute ligne antérieure — y compris créée à la main — héritait de cette valeur. |
| **Détecté** | En comparant `source` à `message_id_client` : seule une demande relevée en porte un. |
| **Sur cette base** | Aucune ligne mal étiquetée — les 8 demandes existantes venaient toutes du courriel. C'est une chance, pas une garantie. |
| **Correction** | [`20260811_source_demande_et_jeton_consultation.sql`](../supabase/migrations/20260811_source_demande_et_jeton_consultation.sql) — un `UPDATE` corrige les lignes sans `message_id_client`. Sans effet ici, il rend la migration juste sur toute autre base. |
| **Vérifié par** | Contrôle de cohérence ligne à ligne : 8/8 cohérentes. |

---

## Étape 5 — Lisibilité des réponses fournisseurs

### BUG-07 {#bug-07}

**La réponse utile était noyée dans l'historique recopié.**

| | |
|---|---|
| **Symptôme** | Sur le message #67 en base : **3 lignes utiles affichées parmi 36**. Le reste était une signature, un en-tête « Message original » et l'intégralité de notre propre message précédent, recopié en `>`. |
| **Impact** | L'avant-vente devait chercher la réponse du fournisseur au milieu de ses propres mots. Sur le message #66, la citation contenait « Nous restons à votre disposition » et « Service Avant-vente » — nos phrases, présentées comme si le fournisseur les avait écrites. |
| **Cause** | Le corps était rendu brut : `<p className="whitespace-pre-wrap">{corpsTexte}</p>`. Aucun découpage. |
| **Difficulté** | Deux formats coexistent. Le #67 porte des marqueurs explicites (`-------- Message original --------`, lignes `>`). Les #65 et #66 n'en ont **aucun** : ce sont des courriels HTML dont la conversion en texte a rendu les tables imbriquées par onze espaces d'indentation. |
| **Correction** | [`packages/shared/src/courriel.ts`](../packages/shared/src/courriel.ts) — `decouperReponse` détecte les marqueurs des six langues, puis se replie sur l'indentation quand aucun n'est trouvé. `detacherSignature` isole la formule de politesse. |
| **Choix de conception** | L'historique est **replié, jamais supprimé**. Certains fournisseurs répondent *en ligne* dans le texte cité : le jeter perdrait la réponse. Un faux positif coûte un clic, pas une donnée. |
| **Résultat mesuré** | #67 : 36 lignes → 4 utiles + signature détachée + 20 repliées. #66 et #65 : 31 → 3. |
| **Vérifié par** | Les trois vrais messages de la base, `npm run essai:bout-en-bout-reel` (5 contrôles dédiés), et 6 boutons « Afficher le message cité » rendus sur l'écran réel. |

---

## Étape 6 — Recherche sémantique de fournisseurs

### BUG-08 {#bug-08}

**Dix-neuf scripts n'étaient jamais typés — une régression y dormait.**

| | |
|---|---|
| **Découvert** | En ajoutant l'étape RAG au parcours de bout en bout : `indexerDevis(tenant, [d.id])` renvoyait 0, `d` étant un `number` et `d.id` valant `undefined`. Le typecheck était pourtant vert. |
| **Cause** | `npm run typecheck` lance `--workspaces`, et `scripts/` vit à la racine, hors de tout workspace. Aucun de ces fichiers n'avait jamais été compilé. |
| **Ce qui dormait** | 15 erreurs, dont **une vraie régression que j'avais introduite** : `ArticleDemande` exige un `id` depuis le correctif [BUG-04](#bug-04), et `essai-consultations.ts` ne le passait plus. Ce script créait donc des consultations sans alimenter `consultation_items` — le formulaire de réponse en ligne y aurait affiché « aucun article à chiffrer ». |
| **Correction** | [`scripts/tsconfig.json`](../scripts/tsconfig.json) et un script `typecheck:scripts` chaîné au typecheck du projet. Les 15 erreurs corrigées. |
| **Vérifié par** | `npm run typecheck` couvre désormais workspaces **et** scripts, sans erreur. |

### BUG-09 {#bug-09}

**L'interface s'affichait dans une police de repli.**

| | |
|---|---|
| **Symptôme** | Signalé à l'œil : « le font a changé un peu ». |
| **Constat** | La famille calculée était `__Inter_Fallback`, et le CSS ne portait que **2 déclarations `@font-face` sans `src`** — des replis système ajustés métriquement. La vraie Inter n'était pas embarquée. |
| **Cause** | `next/font/google` télécharge la police **au build**. J'avais purgé `.next` à un moment où le réseau était indisponible ; Next est retombé sur le repli sans rien signaler. Le code, lui, n'avait pas changé depuis un commit antérieur à la session. |
| **Correction** | Purge et reconstruction avec le réseau disponible. Le CSS porte maintenant 8 `@font-face` dont 7 avec un fichier réel, et le body applique `__Inter_f367f3` avant le repli. |
| **À retenir** | Un build hors ligne dégrade silencieusement la typographie. Le symptôme est visuel, jamais une erreur. |

### BUG-10 {#bug-10}

**Le seuil de similarité laissait tout passer.**

| | |
|---|---|
| **Symptôme** | Les cinq fournisseurs paraissaient couvrir les treize articles du cahier des charges — Atlas compris, qui n'a jamais chiffré de pare-feu. Medina Networks apparaissait par ailleurs **trois fois**. |
| **Cause du seuil** | Je l'avais fixé à 0,55 d'après une mesure sur deux textes. Les embeddings Gemini ont une similarité de fond élevée : deux textes techniques français sans rapport tournent déjà à 0,60. Le filtre ne filtrait rien. |
| **Cause du doublon** | Déduplication par `fournisseur_id`, alors qu'une société porte une fiche par marque distribuée — Medina en a quatre. |
| **Correction** | Seuil calibré à **0,72** sur les 33 lignes réelles (≥ 0,85 même produit, 0,72 même domaine, ≤ 0,71 bruit), et regroupement par nom de société. Résultat : 5 sociétés distinctes, couvertures de 3 à 7 sur 13. |
| **Vérifié par** | `npm run essai:rag` — 14 contrôles, dont l'absence de doublon et le pouvoir discriminant de la couverture. |

---

## Étape 6 — Lancement

### BUG-08 {#bug-08}

**Fermer le terminal laissait un worker vivant, invisible et actif.**

| | |
|---|---|
| **Symptôme** | Deux workers tournaient en parallèle, dont un lancé **quatre jours plus tôt**, sans serveur web associé. |
| **Cause** | `dev-tout.mjs` n'interceptait que `SIGINT` et `SIGTERM`. Fermer un terminal envoie **`SIGHUP`**, que Node traite par défaut en terminant le processus sur-le-champ : `tout_arreter()` n'était jamais exécuté et les enfants survivaient. |
| **Fausses pistes écartées** | J'ai d'abord soupçonné `npm` de ne pas relayer les signaux, puis `tsx watch` de redémarrer son enfant. **Les deux ont été testés en isolation et transmettent correctement** — ce n'était pas là. |
| **Reproduit** | Lanceur factice n'écoutant que SIGINT/SIGTERM + `kill -HUP` → orphelin systématique. |
| **Impact** | Chaque job du worker s'exécutait deux fois : deux RFQ au même fournisseur, deux relances, deux courriels au client. Les gardes d'idempotence lisent puis écrivent — deux workers sur la même minute passent entre les deux. |
| **Correction** | [`scripts/dev-tout.mjs`](../scripts/dev-tout.mjs) — `SIGHUP` et `SIGQUIT` interceptés ; `process.on('exit')` en filet ; et surtout une **garde au démarrage** qui refuse de lancer si un worker tourne déjà, en affichant son heure de démarrage et la commande pour l'arrêter. |
| **Vérifié par** | SIGHUP sur le lanceur corrigé → enfant terminé, plus d'orphelin. Garde testée sur les deux workers réels, refus avec code 1. |

Le garde-fou compte plus que le correctif de signal : `kill -9` ou une coupure
de courant orphelineront toujours un enfant. Détecter l'orphelin au démarrage
suivant est la seule protection qui tienne dans tous les cas.

---

## Étape 7 — Circuit d'approbation

### BUG-09 {#bug-09}

**La page de validation renvoyait l'administrateur vers la connexion.**

| | |
|---|---|
| **Symptôme** | `/validation/[token]` redirigeait vers `/login` au lieu d'afficher la demande. |
| **Cause** | J'ai créé la route publique sans l'ajouter à `PUBLIC_PATHS` du middleware. |
| **Impact** | **Bloquant, et invisible au typage.** Le destinataire du lien n'a pas de compte sur la plateforme : pour lui, le lien paraissait simplement cassé. Le circuit entier était inutilisable. |
| **Pourquoi les tests ne l'ont pas vu** | Mes 12 contrôles portaient sur le service — création, décision, expiration, idempotence — tous passés. Le middleware s'interpose **avant** la page, sur un plan que ces contrôles ne traversent jamais. |
| **Correction** | [`apps/web/middleware.ts`](../apps/web/middleware.ts) — `/validation` rejoint `/offre` et `/devis`, les trois routes qui s'ouvrent sur un jeton reçu par message. |
| **Vérifié par** | Écran affiché, approbation enregistrée, rejeu du lien bloqué ; et `/validation` en 404 sur jeton inconnu, `/apres-vente` toujours en 307. |

Une route publique s'ajoute à **deux** endroits : le fichier de page, et la liste
du middleware. Rien ne relie les deux, et seul un appel sans session le révèle.

---

## Étape 8 — Connexion

### BUG-10 {#bug-10}

**« Authentication service was unavailable » à chaque tentative Google.**

| | |
|---|---|
| **Symptôme** | Le bouton « Continuer avec Google » échouait systématiquement, avec un message anglais qui laissait croire à une panne du service. |
| **Cause** | Le fournisseur Google **n'est pas activé** sur le projet Supabase — `provider is not enabled`. Le bouton était affiché sans condition, alors que son activation se fait dans le tableau de bord Supabase et non dans ce dépôt. |
| **Écarté par la mesure** | Auth était sain (`/auth/v1/health` → 200, GoTrue v2.195), la connexion par mot de passe répondait correctement (`invalid_credentials` sur un mot de passe faux), et les six comptes étaient rattachés. Le service n'était donc pas en cause. |
| **Correction** | Bouton conditionné à `NEXT_PUBLIC_AUTH_GOOGLE`, absent par défaut. Mieux vaut ne rien montrer qu'un chemin qui échoue toujours. Le message d'erreur nomme désormais la cause au lieu d'inviter à « réessayer » une action qui ne peut pas aboutir. |
| **Vérifié par** | Écran sans le bouton, message explicite affiché sur `?erreur=oauth`. |

**Correctif revu sur retour utilisateur** : le bouton est finalement conservé,
le fournisseur devant être configuré prochainement. Le message d'erreur
explicite suffit à ne pas faire croire à une panne du service — c'est lui qui
portait le vrai défaut, pas la présence du bouton.

Pour l'activer : tableau de bord Supabase, *Authentication > Providers >
Google*.

---

## Étape 9 — Historique par affaire

### BUG-11 {#bug-11}

**Un tiers des actes s'affichaient en jargon de base de données.**

La chronologie traduit chaque ligne d'`audit_events` en une phrase lisible. La
table de correspondance avait été dressée par `grep` sur `action: '…'` — la
forme littérale des insertions écrites à la main.

À l'écran, onze événements sont sortis bruts : `offre.generee`,
`consultations.planifiees`, `consultations.preparees`, `demande.recue`,
`article.modifie`.

**La fausse piste** : chercher un défaut dans la table de correspondance, ou
dans la lecture. Les deux étaient correctes.

Le vrai motif est que la moitié des actes ne passent pas par une insertion
littérale mais par un helper, `auditer(utilisateur, action, …)`, qui reçoit
l'action en **argument positionnel**. Aucun `action: '…'` à trouver — le `grep`
ne pouvait pas les voir, et il sortait silencieusement incomplet.

**Correctif** : la liste est relevée sur `audit_events` en base, pas sur le
code. Quarante actions distinctes y figurent, contre vingt-huit trouvées par
lecture du code.

La leçon est celle de [SEC-06](RAPPORT-SECURITE.md#sec-06--trois-vues-contournaient-le-rls-fuite-réelle),
sur un autre terrain : **une liste dressée par balayage d'une seule syntaxe ne
couvre que cette syntaxe**. C'est pourquoi une action inconnue s'affiche
désormais telle quelle plutôt que d'être ignorée — le défaut se voit à l'écran
au lieu de disparaître.

### BUG-12 {#bug-12}

**Le même envoi occupait trois lignes de la chronologie.**

Envoyer une demande de devis produit trois écritures : la date sur la
consultation, l'acte dans `audit_events`, le courriel dans `communications`.
Trois lignes à l'écran pour un seul fait, à 140 ms d'intervalle — et **aucune
des trois complète** : la date nomme le fournisseur, l'acte nomme l'auteur, le
courriel porte le sujet et le destinataire.

**La fausse piste** : dédoublonner sur l'horodatage. Les trois écritures ne
partagent pas la même milliseconde, et un seuil de tolérance aurait fusionné
des faits distincts survenus dans la même seconde — ce qui arrive, quatre
consultations partant en rafale.

**Correctif** : chaque fait porte une clé stable `entité:id:suffixe`, et les
trois sources la calculent indépendamment. À clé égale, on ne choisit pas — on
**fusionne champ par champ**, en gardant le premier renseigné et la date la
plus ancienne.

Le mode de défaillance choisi compte : une action absente de la table des clés
n'est pas perdue, elle apparaît sur sa propre ligne. **Un doublon se voit ; un
événement manquant, non.**

Effet mesuré sur `DM-2026-000013` : 47 lignes ramenées à 34, sans perte.

### BUG-13 {#bug-13}

**Les rafales entrelacées échappaient au regroupement.**

L'écran livré était juste et illisible : trente-quatre lignes du même poids.
Deux correctifs ont suivi — une hiérarchie majeur/manœuvre, et le repliement
des séries. Le second ne prenait pas.

À 15:21, quatre demandes de devis partent d'un coup, et chacune produit un avis
de non-remise dans la foulée. En base, les huit lignes **alternent** : envoi,
avis, envoi, avis. Le regroupement ne compare que des voisins immédiats — il ne
trouvait donc jamais deux lignes semblables côte à côte, et les huit
s'affichaient telles quelles.

**La fausse piste** : élargir la fenêtre de comparaison à N lignes en arrière.
Cela regroupe aussi des faits éloignés que rien ne rapproche, et le résultat
dépend de N.

**Correctif** : avant de regrouper, les faits d'une **même minute** sont rangés
par poids puis par intitulé. Les réordonner ne travestit rien — ils portent la
même minute, et c'est la minute qui est affichée. L'ordre exact à la
milliseconde n'était de toute façon pas lisible.

Le bloc de 15:21 est passé de **huit lignes à deux** :
`Avis de non-remise ×4` et `Demande de devis — Medina Networks ×4` suivie de
`Fortinet · Hikvision · HP · Aruba`.

Trouvé en regardant l'écran, pas en lisant le code : le harnais était vert, et
il l'était à juste titre — il éprouvait la fusion acte/état, pas la lisibilité.
Six contrôles de lisibilité ont été ajoutés depuis.

### BUG-14 {#bug-14}

**Le bouton d'envoi de l'offre au client refusait d'envoyer, sur un compte qui
fonctionnait.**

Signalé à l'usage : « le bouton d'envoi du lien web de l'offre ne marche pas ».
Il marchait en réalité à moitié — l'offre passait bien en `validee`, puis
l'action répondait *« Envoi impossible : compte Gmail principal non configuré
(GMAIL_PRINCIPAL_*) »*.

**La fausse piste** : croire le message et aller chercher un refresh token
Gmail. Il est bien absent, mais ce n'est pas ce qui manquait.

La plateforme dispose d'un **point d'envoi unifié**, `envoyer()`, dont le
commentaire dit exactement son rôle : *« deux transports possibles, choisis
automatiquement — Gmail API si un refresh_token est disponible, SMTP sinon.
L'appelant n'a pas à savoir lequel est actif. »* Sept fichiers l'utilisent : les
RFQ, les relances, les invitations, la relance client.

`valider.ts` était **le seul à ne pas le faire**. Il appelait `gmailConfigure`
puis `envoyerEmail` directement, se privant du repli. Mesuré :

| Compte | Gmail | SMTP | Transport retenu par `envoyer()` |
|---|---|---|---|
| `principal` | ❌ | ✅ | **SMTP**, fonctionnel |

Autrement dit : le seul canal qui parle au **client final** était aussi le seul
à ne pas savoir se replier, alors que le transport marchait partout ailleurs.

**Correctif** : `envoiConfigure` et `envoyer` à la place des fonctions Gmail. Le
message de succès nomme désormais le transport utilisé — c'est la première
question posée quand un client dit n'avoir rien reçu, et la réponse était
invisible depuis l'écran.

**Garde-fou** : `essai:bout-en-bout` refuse tout appel direct à `gmailConfigure`
ou `envoyerEmail` hors des scripts. Éprouvé en réintroduisant l'appel dans un
autre fichier — le contrôle l'a signalé. Il a d'ailleurs commencé par se
déclencher sur le commentaire qui *explique* le piège : les lignes de
commentaire sont maintenant exclues.

Transport vérifié pour de bon avec `essai:smtp`, qui envoie à la boîte de la
plateforme et non à un tiers : message accepté par le serveur.

### BUG-15 {#bug-15}

**Deux restes de React 18, signalés par l'indicateur de Next et passés au
travers de `typecheck` et de `lint`.**

Repérés en répondant à une question sur un bouton apparu en bas à gauche de
l'écran : l'indicateur de développement de Next 16, qui affichait « 2 Issues »
en rouge. Il n'apparaît qu'en développement, jamais en production — mais il
comptait deux incidents réels.

**`useFormState` au lieu de `useActionState`.** L'écran de connexion et celui de
définition du mot de passe importaient encore le hook de `react-dom`. React 19
l'a renommé et le retirera. Le typage l'acceptait, donc rien ne l'a signalé à la
compilation.

C'est le miroir exact de [BUG-02](#bug-02), qui avait vu `useActionState` écrit
sous React 18 — l'API existait dans les types, pas à l'exécution. **La même
frontière, franchie dans l'autre sens** : un typecheck vert ne dit rien de ce
qui existe vraiment au moment où le code tourne.

**« Auth session missing » journalisé comme une erreur.** C'est la réponse
normale de Supabase à une visite sans session — sur `/login`, sur la page
d'offre publique, sur le formulaire fournisseur. La journaliser en `error`
remplissait la console à chaque visite anonyme et faisait compter un incident
par l'indicateur.

Le risque n'est pas cosmétique : un bruit permanent noie les vraies pannes. Une
absence de session est désormais journalisée en `info`, et seule une véritable
erreur d'authentification — panne réseau vers Supabase, jeton corrompu — reste
en `error`.

Vérifié à l'écran : l'indicateur est repassé au neutre.

---

### BUG-16 {#bug-16}

**Le bouton « Lien client » distribuait une adresse en 404.**

Signalé comme « le lien web des offres rend 404 ». Sur les neuf offres de la
base, six s'ouvraient et trois répondaient 404 — les trois en statut `generee`.

La page publique a raison de les refuser : une offre non validée est un document
interne, et `STATUTS_PUBLICS` ne s'ouvre qu'à partir de `validee`. Le défaut
était ailleurs — l'écran de relecture proposait « Lien client » **quel que soit
le statut**, et copiait donc une adresse que la plateforme elle-même refusait.

**La fausse piste**, et elle a coûté du temps : chercher un jeton expiré ou une
route mal déclarée. Les neuf jetons étaient valides et faisaient tous 32
caractères ; `/offre` figurait bien dans `PUBLIC_PATHS`. Rien n'était cassé.

Ce qui rendait le diagnostic pénible est **délibéré** : le 404 est muet par
construction, identique pour un jeton inconnu et pour une offre pas encore
publiable, afin de ne rien révéler à un inconnu. Ce silence, utile face à
l'extérieur, est trompeur pour l'équipe.

Le correctif ne touche donc pas la règle. `estStatutPublic` est exportée depuis
`apps/web/lib/offres/public.ts` et **lue des deux côtés** — la page publique qui
refuse, l'écran qui propose. Une seconde liste, recopiée, aurait dérivé et
ramené le même symptôme.

Le bouton est désormais désactivé avant validation, avec le motif en infobulle.
Désactivé plutôt que masqué : une disparition se lirait comme un droit manquant.

Vérifié sur le serveur de développement, les neuf jetons interrogés un par un :
six `200`, trois `404` sur les `generee`, `404` sur un jeton inconnu — la
propriété d'indiscernabilité tient.

---

### BUG-17 {#bug-17}

**« Welcome to Facebook » est devenue une demande, puis s'est bloquée.**

Trois des neuf demandes bloquées étaient des courriels de service Meta :
« Welcome to Facebook », « Did you just add this phone number? », « Welcome to
Meta for Developers ». Chacune avait consommé un appel au modèle pour n'en tirer
aucun article, puis réclamait une décision humaine.

La relève écartait déjà les avis de non-remise (`estRebond`). Rien ne couvrait
l'autre famille : notifications, infolettres, envois de masse. Or la boîte
avant-vente sert aussi d'adresse d'inscription — le flux est **permanent**, pas
accidentel.

**La fausse piste évitée** : demander au modèle « est-ce une demande
commerciale ? ». Une infolettre de distributeur qui liste des références produit
passerait pour une consultation, et le tri deviendrait non reproductible. Même
raisonnement que pour `estRebond`, dont l'en-tête le dit déjà.

`estCourrierAutomatique` ne lit que ce que **l'expéditeur déclare** :
`Auto-Submitted` autre que `no` (RFC 3834), `List-Id` / `List-Unsubscribe`,
`Precedence` de masse. Trois signaux qu'aucun correspondant humain ne pose sur
un message rédigé à la main.

Volontairement absente de la liste : l'adresse en `noreply@`. Des portails
d'achat publient leurs consultations depuis une adresse de ce type, et les
écarter perdrait de vraies affaires. Le cas est éprouvé explicitement par
`essai:worker`, au même titre que les faux positifs.

---

### BUG-18 {#bug-18}

**« La demande sera reprise automatiquement » était faux.**

`extractionSpecs` laissait en `nouvelle` une demande dont l'extraction avait
échoué sur un quota, en annonçant sa reprise. La seule reprise écrite vivait
dans `pollClientMailbox`, sur le chemin d'un message re-relevé — or le message
est marqué lu dès que `traiterMessage` rend la main, report compris. Il n'était
donc **jamais** relu, et la demande restait en attente indéfiniment.

Le même trou rendait `bloquee` terminal : deux endroits l'écrivaient, aucun ne
le levait. Six demandes y sont restées après le retrait du modèle
`llama-3.3-70b-versatile` par Groq, alors que la cause était réparée le jour
même.

Le job `reprise` comble les deux. L'application, elle, ne fait que reposer la
demande en `nouvelle` : **l'extraction reste du seul côté du worker**, qui porte
la garde anti-chevauchement. Deux extractions concurrentes sur la même demande
inséreraient les articles en double, sans que rien ne le signale avant le
chiffrage.

Deux gardes, et la seconde n'est pas redondante :

1. **une temporisation de dix minutes**, contre une extraction encore en vol née
   de la réception ;
2. **un décompte d'articles**, contre une extraction aboutie dont seul le statut
   n'aurait pas suivi.

La temporisation est **levée pour les déblocages explicites** — repérés par
l'événement d'audit `demande.debloquee`. Elle ne protège que du chemin de
réception ; l'appliquer à un bouton qui vient d'annoncer « relancé » ferait
attendre dix minutes devant un écran muet, ce qui se lit comme une panne.

---

### BUG-19 {#bug-19}

**Le worker annonçait au démarrage un fournisseur IA qui n'était pas le sien.**

Trouvé en faisant sortir `essai:ia-secours` au rouge : « chaîne : openai — aucun
secours », alors que `essai:worker` mesurait `openrouter → openai` sur la même
base, à la même seconde.

Les deux disaient vrai sur ce qu'ils lisaient. La chaîne se **déduit des clés**,
et cette déduction n'avait lieu qu'au premier appel de génération. Tout ce qui
se contentait de lire `chaineFournisseurs()` sans jamais générer retombait sur
l'ancien mécanisme `AI_PROVIDER` — c'est-à-dire sur une configuration que plus
rien n'utilise depuis la refonte à deux clés.

Deux lecteurs étaient dans ce cas, et le premier est le plus gênant : **la ligne
de démarrage du worker**, celle qu'on lit précisément pour savoir ce qui est
configuré.

`assurerChaine` est désormais exportée, et appelée après `chargerSecrets` — dans
cet ordre, les clés vivant dans `/admin`. `demarrer()` est passée en `async`
pour cela.

C'est le même piège que le 19/08 sous une autre forme : **une configuration
« valide » qui n'est pas celle qui servira**. Une clé présente ne prouve rien.
D'où l'appel réel au modèle en tête de `essai:worker` — seule une réponse
prouve quelque chose.

---

### BUG-20 {#bug-20}

**Le transport Gmail perdait la copie visible, sans rien dire.**

Trouvé en ajoutant les pièces jointes au point d'envoi. `envoyer` transmet `cc`
à son transport, `construireMime` sait le poser — mais la signature
d'`envoyerEmail` ne le déclarait pas, et le paramètre tombait entre les deux.

Aucun effet aujourd'hui : le SMTP est actif, et nodemailer, lui, reçoit bien la
copie. Le jour d'une bascule vers l'API Gmail, les contacts secondaires d'un
fournisseur auraient cessé de recevoir les consultations — **sans erreur, sans
trace**, et le seul symptôme aurait été un fournisseur qui « ne répond plus ».

C'est le défaut typique d'un paramètre facultatif traversant deux couches : la
première le transmet, la seconde ne l'attend pas, et TypeScript n'y voit rien
puisque l'objet passé n'est pas contraint à la signature cible.

---

### BUG-21 {#bug-21}

**Les harnais d'essai fabriquaient les demandes bloquées qu'on nettoyait.**

`essai:smtp` et `essai:envoi-offre` envoient un vrai message — à la boîte de la
plateforme, conformément à la règle du projet. Or c'est la boîte que le worker
relève. Chaque exécution produisait donc une demande, un appel au modèle, et un
blocage faute d'articles.

`DM-2026-000021` à `24` sont nées ainsi. Le nettoyage du 19/08 les a supprimées,
et la prochaine exécution les aurait recréées.

**La fausse piste** : ajouter une exception dans `pollClientMailbox` sur le
marqueur `essai-…` du sujet. Elle aurait mis du code d'essai dans le chemin de
production, et un vrai client écrivant « essai » dans son objet serait passé à
la trappe.

Le point d'envoi accepte désormais des en-têtes libres, et les harnais posent
`Auto-Submitted: auto-generated`. La mention est **exacte** — ces messages sont
générés sans intervention humaine — et `estCourrierAutomatique`
([BUG-17](#bug-17)) les écarte pour la même raison que les notifications Meta,
sans qu'aucune ligne ne leur soit dédiée.

Vérifié sur un message réel : `essai:envoi-offre` puis `essai:worker` →
« courrier automatique écarté (Auto-Submitted: auto-generated) », zéro demande
créée.

---

### BUG-22 {#bug-22}

**Le filtre du courrier automatique laissait passer les confirmations Meta.**

Trouvé à l'audit de clôture : `DM-2026-000033`, « Confirm your business email »,
de `notification@facebookmail.com`, bloquée faute d'articles — exactement la
famille que [BUG-17](#bug-17) devait écarter.

**La fausse piste, écartée d'emblée** : conclure que le filtre par en-têtes ne
marche pas et se rabattre sur l'expéditeur ou le sujet. Les en-têtes du message
ont été relus dans la boîte avant toute décision :

```
auto-submitted             —
precedence                 —
list-id / list-unsubscribe —
x-auto-response-suppress   "All"
```

Le filtre n'avait pas échoué : **aucun de ses trois signaux n'était présent**.
Une confirmation d'adresse n'a pas de lien de désabonnement — on ne se désabonne
pas d'un message de sécurité. C'est précisément ce qui la faisait passer.

`X-Auto-Response-Suppress` est le quatrième signal, et il est de la même nature
que les autres : déclaratif, posé par la machine émettrice, jamais par quelqu'un
qui écrit depuis son client de messagerie.

**Ce que cette liste ne couvrira jamais** est écrit dans le module : un
expéditeur qui ne déclare rien. Le message deviendra alors une demande sans
article, donc bloquée — comportement correct, seulement bruyant, et le remède
est en aval avec `relancer:bloquees` et `purger:bloquees`. Élargir le tri au
contenu coûterait de vraies affaires, ce qui est bien plus cher.

---

### BUG-23 {#bug-23}

**Le simulateur de devis écrivait « presque » ce qu'écrit le formulaire.**

`essai:repondre` reproduit les écritures de `/devis/[token]` : devis, lignes,
passage en « devis reçu », notification, audit. Il en oubliait une — la
**vectorisation**, que le formulaire lance en fin de course.

Attrapé par `essai:rag` : « 33 vecteurs pour 49 lignes ».

Le défaut n'est pas dans le simulateur seul, il est dans ce qu'il produit :
**un état de base que la production n'atteint jamais**. Tout ce qui lit ensuite
— recherche sémantique, propositions de fournisseurs — travaille alors sur un
index incomplet, sans rien qui le signale. Un harnais qui laisse la base dans un
état impossible est pire qu'un harnais absent.

Le contrôle qui l'a vu compare deux nombres qu'aucune couche n'a de raison de
faire diverger. C'est le genre d'invariant qui mérite d'être écrit.

---

### BUG-24 {#bug-24}

**Le job de reprise lisait sans borne.**

`reprendreExtractions` filtre en mémoire — deux règles d'éligibilité, dont l'une
tirée de l'audit — donc la limite SQL avait été retirée. Elle ramenait ainsi
tout le `contenu_consolide` des demandes en attente, **toutes les deux minutes**.

Sans effet sur une base de démonstration. Sur un arriéré réel, c'est un transfert
inutile répété indéfiniment. Borné à 30, très au-delà du lot de 3 : l'arriéré se
résorbe de toute façon cycle après cycle.

---

### BUG-25 {#bug-25}

**Un harnais d'essai a effacé les vraies clés WhatsApp saisies dans `/admin`.**

Le 2026-08-20, l'utilisateur colle son jeton Meta et son *Phone number ID* dans
l'écran d'administration. `npm run essai:whatsapp` est lancé pour vérifier la
liaison. Il sort vert. **Les deux clés ont disparu de la base.**

Deux fautes cumulées, chacune inoffensive isolément.

**La première rendait la seconde invisible.** Le harnais posait ses valeurs par
un `insert` dont l'erreur n'était jamais lue. Une ligne existant déjà, la
contrainte d'unicité sur `(tenant_id, cle)` la refusait **en silence** — et le
contrôle « une clé écrite en base active le canal » passait au vert sur la
**vraie** clé de l'utilisateur, jamais sur celle du harnais. La sortie affichait
d'ailleurs le numéro réel, ce qui aurait dû alerter.

**La seconde détruisait.** Le nettoyage supprimait par nom de clé, donc en
emportant ce que le harnais n'avait pas créé.

#### Ce n'était pas un bug, c'était une règle mal implémentée

La convention du projet dit : *« ceux qui écrivent en base nettoient derrière
eux »*. Trois harnais l'avaient traduite par un `delete`. C'est correct sur une
table vide — l'état dans lequel ils ont été écrits — et destructeur dès qu'elle
est garnie :

| Harnais | Ce qu'il aurait effacé |
|---|---|
| `essai:whatsapp` | le jeton et l'identifiant de numéro — **c'est arrivé** |
| `essai:cles` | la clé Gamma, supprimée **dès sa première ligne** |
| `essai:gabarits` | une retouche de prompt faite dans `/admin` |

Nettoyer, ce n'est pas supprimer : c'est **rendre l'état trouvé**. Une ligne
absente au départ doit disparaître ; une ligne présente doit retrouver sa
valeur.

D'où une implémentation **unique**, `scripts/preserver-parametres.ts`, appelée
par les trois — même raisonnement que [SEC-02](RAPPORT-SECURITE.md#sec-02--une-seule-implémentation-de-léchappement-html)
pour l'échappement HTML : une règle recopiée dérive, et celle-ci avait déjà
dérivé trois fois.

#### La correction avait elle-même un défaut

Première version : relever la valeur, la remettre par `update`. Elle échouait
sur `essai:gabarits`, qui **supprime la ligne en cours de route** — c'est même
ce qu'il éprouve, la transition « retouche → défaut du code ». L'`update` ne
retrouvait plus rien et la valeur était perdue, silencieusement.

La restitution relève donc la **ligne entière** — catégorie, type, libellé — et
la recrée. Une restitution ratée est journalisée en clair avec la valeur
d'origine, plutôt qu'avalée.

#### Deux gardes ajoutées, contre chacune des fautes

- **« c'est bien la valeur du harnais qui est active »** : sans ce contrôle,
  une écriture muette laisse l'essai passer sur la valeur d'origine. C'est
  exactement ce qui a masqué le défaut pendant tout un cycle.
- **« les clés réelles sont restituées »**, comparé à l'octet près sur ce qui a
  été relevé au départ.

Éprouvé pour de bon : quatre témoins posés en base — les deux clés WhatsApp, la
clé Gamma et un gabarit de prompt — les trois harnais lancés dessus, **4/4
intacts**.

**Ce qui n'est pas rattrapable** : le jeton effacé. Les valeurs sensibles ne
sont jamais rendues en clair par `etatDesCles`, ce qui est la bonne posture — et
signifie qu'il fallait le ressaisir.

---

### BUG-26 {#bug-26}

**Six offres sur seize étaient impossibles à retenir dans le comparatif.**

Signalé comme « un problème au niveau de la génération des feuilles de coût ».
Le défaut n'était pas dans la génération : il était dans l'écran qui la
précède, et il rendait certaines offres **inatteignables**.

Le tableau comparatif avait une colonne par FOURNISSEUR, et chaque cellule
retrouvait son offre par le NOM :

```ts
const offre = ligne.offres.find((o) => o.fournisseurNom === f.nom);
```

Deux situations ordinaires la mettaient en défaut, et elles se cumulaient :

1. **Une société porte une fiche par marque distribuée.** « Medina Networks » en
   a quatre. Trois colonnes homonymes apparaissaient, toutes remplies par la
   même première offre trouvée — et React recevait trois fois la même clé.
2. **Un fournisseur répond par plusieurs devis.** `find` n'en rendait qu'un ;
   les autres n'étaient ni affichés ni sélectionnables.

**Mesuré avant correction sur DM-2026-000032 : 6 offres sur 16 perdues**, dont
la moins chère de chaque paire. L'écran mettait le meilleur prix en évidence
sans permettre de le retenir — d'où l'impression que la feuille refusait de se
construire.

**La fausse piste**, écartée en mesurant plutôt qu'en supposant : croire à un
défaut de `construireFeuille`. Le comparatif rendait bien 11 articles, les
colonnes générées calculaient juste, les trois lectures de l'écran passaient.
Rien en aval n'était en cause.

#### Le devis est la bonne unité, pas le fournisseur

Chaque offre appartient à exactement un devis. Une colonne par devis rend donc
toute offre atteignable **par construction**, sans dépendre d'un nom.

Les libellés ne sont complétés du numéro de devis **que lorsqu'ils se répètent** :
alourdir toutes les colonnes pour le cas d'un fournisseur unique — le cas
courant — se paierait à chaque écran.

La même désambiguïsation s'applique aux blocs de critères, qui affichaient trois
fois « Medina Networks » sans moyen de les départager.

#### Ce que la plateforme savait déjà, et que cet écran ignorait

`chercherFournisseurs` regroupe **délibérément par nom**, avec la raison écrite
dans le code : « une même société a autant de fiches que de marques ». Le cas
était donc connu et traité ailleurs. Seul le comparatif l'ignorait.

#### L'invariant qui l'aurait attrapé

`essai:costing` vérifie désormais que **toute offre tombe dans exactement une
colonne**, que deux colonnes ne portent jamais le même libellé, et qu'aucun bloc
de critères ne se dédouble. Aucun de ces trois contrôles n'existait — le harnais
lisait le comparatif sans jamais se demander ce que l'écran pouvait en montrer.

Et `essai:bout-en-bout` rend maintenant **23 écrans du tableau de bord** avec une
vraie session. Un changement de forme de props passe `typecheck` sans rien
prouver du rendu : les harnais appellent les fonctions de lecture, jamais React.
Un statut 200 ne suffit pas non plus — Next sert sa page d'erreur avec un 200 —
d'où l'inspection du corps.

---

### BUG-27 {#bug-27}

**Le circuit d'approbation était complet, et inatteignable.**

Signalé ainsi : « lors de l'offre d'Agadir Bay je n'ai pas reçu la validation
sur Telegram ». Rien n'était cassé côté Telegram — le bot répondait, le canal
était éprouvé. Le circuit n'avait simplement **jamais été déclenché**.

`soumettreValidation` et `definirValidationObligatoire` existaient depuis le
2026-08-16, complètes : table, jeton, page publique, décision, idempotence,
envoi Telegram. **Aucun écran ne les appelait.** Une recherche sur tout le dépôt
ne rendait que leur propre déclaration.

Conséquence : `validation_offre_obligatoire` restait absent — donc `false` — et
`genererOffre` ne demandait jamais d'accord. L'offre d'Agadir s'est générée
directement, sans qu'aucune demande ne parte.

**La fausse piste** : chercher le défaut dans l'émetteur Telegram, qui venait
d'être livré. Ce qui a désigné le coupable est une requête, pas une intuition —
le drapeau valait `false`, et aucune ligne de `validations_offre` n'existait
pour la feuille concernée.

#### Ce qui a été rebranché

L'interrupteur du drapeau dans `/admin`, la carte d'accord sur l'écran de
costing, et la résolution automatique du destinataire.

Ce dernier point corrige au passage un défaut de conception : l'action lisait
une **adresse saisie dans le formulaire**. L'avant-vente désignait donc son
propre approbateur, ce qui vide la garde de son sens. `resoudreApprobateurs`
tranche à partir des rôles — l'administrateur d'abord, les suppléants déclarés
seulement si aucun administrateur n'est joignable, le courriel en dernier
recours.

---

### BUG-28 {#bug-28}

**Aucun total de feuille de coûts n'était rafraîchi, en silence.**

`rafraichirTotaux` écrivait `marge_valeur`, qui est une **colonne générée**.
Postgres refuse alors la requête ENTIÈRE — « column marge_valeur can only be
updated to DEFAULT » — et l'erreur n'était pas lue.

Les totaux de la feuille restaient donc ceux posés à l'insertion, c'est-à-dire
zéro, quelle que soit la suite. Le symptôme est invisible à la construction :
les **lignes** ont bien leurs totaux, eux aussi générés, et l'écran les affiche.
Seule la feuille ment.

C'est la règle du projet retournée contre elle-même — « aucun prix recalculé
côté application, les colonnes générées font foi » — appliquée partout sauf ici,
où l'application tentait d'écrire par-dessus la base.

**Trouvé par `essai:parcours`**, qui a buté sur le même refus en verrouillant sa
feuille. Aucun harnais ne pouvait le voir avant : ils vérifiaient les lignes,
jamais la cohérence entre les lignes et leur feuille.

`marge_valeur` est retirée de l'écriture, et l'erreur est désormais journalisée
— c'est son absence qui a rendu le défaut muet pendant neuf jours.

---

### BUG-29 {#bug-29}

**L'administrateur s'escaladait à lui-même.**

Le circuit rebranché la veille adressait la demande d'accord à l'administrateur
— règle juste tant que c'est une avant-vente qui soumet. Mais rien n'écartait le
demandeur de ses propres destinataires : un administrateur qui travaillait
l'opportunité et cliquait « demander l'accord » **recevait son propre lien sur
son propre Telegram**, et devait quitter la plateforme pour revenir y valider ce
qu'il venait d'y soumettre.

Le défaut ne plantait rien, et c'est ce qui le rendait durable : le message
partait, le lien fonctionnait, la génération se débloquait. Seul le trajet était
absurde.

La correction tient en deux points. `resoudreApprobateurs` accepte un compte à
exclure — le demandeur — et l'écran de costing propose à l'administrateur un
accord **sur place**, écrit directement dans `validations_offre` avec le canal
`interne` et `decide_par` renseigné. La lecture que fait `genererOffre` est
inchangée : il n'existe toujours qu'un seul chemin pour débloquer une
génération.

**Ce que l'essai ne voyait pas.** `essai:bout-en-bout` ouvrait une session
PRESALE et une seule. `/admin` n'était visité que pour constater son refus, et
la carte d'accord côté administrateur n'était rendue par personne — une erreur
de rendu y serait passée inaperçue. Le parcours ouvre désormais aussi une
session ADMIN.

---

### BUG-30 {#bug-30}

**Cinq écritures dont l'échec passait pour un succès.**

[BUG-28](#bug-28) n'était pas un accident isolé : c'était un exemplaire d'une
classe. PostgREST ne lève pas d'exception, il rend `{ data, error }` — un
`await` qui ignore `error` réussit donc même quand la base a refusé l'ordre.

**La fausse piste, c'est l'exhaustivité.** Le premier relevé a compté **139**
écritures sans lecture d'erreur, et la tentation était de toutes les corriger.
C'eût été une faute : l'écrasante majorité sont des `audit_events` et des
`notifications`. Faire échouer l'approbation d'un client parce qu'une ligne
d'audit n'est pas partie remplacerait un défaut silencieux par un défaut
bruyant — et plus grave.

Le critère retenu est la conséquence, pas le nombre : **une écriture lit son
erreur quand son échec fait perdre un travail irréproductible, ou installe une
boucle.** Cinq répondaient à ce critère.

| Écriture | Ce que le silence coûtait |
|---|---|
| `extractionSpecs` — statut `specs_extraites` | Les articles sont insérés, la demande reste `nouvelle`. Le job `reprise` la revoit tous les cycles, constate qu'elle porte déjà des articles, l'écarte — **indéfiniment**, sur un avertissement que personne ne lit. |
| `generer.ts` — offre `generee` | `source_json` est la photographie figée : sans elle la page publique n'a rien à montrer, et `pdf_url` désigne un fichier déposé que plus rien ne relie. La fonction rendait pourtant un résultat complet **après cent secondes de travail**. |
| `documents/pdf.ts` — `pdf_url` | Le PDF existe dans le bucket, la base l'ignore. Le lien n'apparaît jamais et la réémission réécrit le même chemin. |
| `offre/[token]` — affaire `gagnee` / `perdue` | Le client a décidé et il est parti : il ne réessaiera pas. Une affaire gagnée qui ne s'inscrit pas se découvre au reporting, sans plus aucun moyen de savoir ce qui a échoué. |
| `devis/[token]` — consultation `devis_recu` | Le fournisseur a rempli le formulaire ; la consultation reste « envoyée », donc le job de relances le rappellera pour un devis déjà remis. |

Deux traitements distincts, et la distinction compte. L'écriture de l'offre
**lève** : le `catch` de `genererOffreComplete` retire alors l'offre et ses
produits, et perdre la génération en le disant vaut mieux que garder une offre à
moitié écrite. Les quatre autres **journalisent** : le fait principal est déjà
enregistré, et le détruire pour un statut non suivi serait disproportionné.

Le cas de l'extraction va plus loin : l'échec **bloque** la demande. C'est ce
qui la sort de la boucle du job `reprise` — elle n'est plus `nouvelle`, donc
plus candidate — et l'écran offre le bouton qui la relance une fois la cause
corrigée.

---

### BUG-31 {#bug-31}

**Le harnais de costing n'était pas rejouable après une interruption.**

`essai:costing` crée sa feuille en `version 9000` et la retire dans un
`finally`. Un processus tué — délai dépassé, Ctrl-C, machine en veille —
n'exécute pas ce `finally`. La feuille survit, et
`cost_sheets_demande_id_version_key` fait échouer **toutes** les exécutions
suivantes.

Le message affiché ne dit rien du vrai problème : `duplicate key value violates
unique constraint`. On cherche une régression dans le code qu'on vient
d'écrire, alors que la cause est un résidu de la fois d'avant. Constaté deux
fois le 2026-08-25, dont une où l'échec a été attribué à une modification qui
n'y était pour rien.

Le harnais purge maintenant les feuilles en `version 9000` de la demande
d'appui avant de créer la sienne. La version est réservée par construction :
purger ce qui la porte ne peut pas toucher une feuille réelle.

C'est le complément de la règle déjà écrite pour `parametres` : **nettoyer,
c'est rendre l'état trouvé — y compris l'état laissé par soi-même la fois
d'avant.**

---

### BUG-32 {#bug-32}

**L'adresse de la boîte mail se saisissait à l'aveugle, sans contrôle.**

`/admin` présentait **tous** les champs de clés en `type="password"` — y compris
« Boîte mail — adresse », qui n'est pas un secret. L'information existait
pourtant : `CLES_GEREES` porte `sensible: false` sur cette entrée, mais elle
s'arrêtait à `masquer()` et ne remontait jamais jusqu'à l'interface.

Conséquence pour qui change l'adresse : il la tape en points, sans pouvoir se
relire, alors qu'elle est **affichée en clair** dans la liste juste après
enregistrement. L'incohérence est totale — masquée à la saisie, lisible ensuite.

Aggravé par l'absence de contrôle de format : la validation était
`min(1).max(4000)`. `contact@vigon`, ou une adresse avec une espace, était
acceptée en silence. L'erreur n'apparaissait qu'au test de connexion, sous forme
de refus d'authentification — **un message qui accuse le compte quand le tort
est à la frappe**, exactement le travers déjà relevé pour les clés IA mal
rangées.

Correction : `sensible` est remonté jusqu'au champ, et un `format: 'email'`
déclaré sur l'entrée `IMAP_CLIENT_USER` est vérifié à l'enregistrement. Le
format se déclare **à la source**, dans `CLES_GEREES`, plutôt qu'en dur dans
l'action : le jour où une autre clé sera une adresse, rien à modifier ailleurs.

Trois champs seulement deviennent lisibles — le modèle IA imposé, l'adresse de
la boîte, l'identifiant de numéro WhatsApp. Tous les secrets réels restent
masqués, vérifié clé par clé.

Le mécanisme lui-même n'était pas en cause, et il a été éprouvé à cette
occasion : la valeur enregistrée depuis `/admin` l'emporte sur l'environnement,
l'expéditeur SMTP la suit **sans redémarrage** — ni le transport ni le client
IMAP ne sont mémorisés — et un second processus la lit dans la minute.

Reste un piège que le code ne peut pas fermer, désormais dit dans l'aide du
champ : **l'adresse et le mot de passe vont par paire.** Changer l'une sans
l'autre casse la connexion, le mot de passe d'application étant lié au compte
précédent.

---

### Le parcours complet, éprouvé d'un bout à l'autre {#parcours-complet}

`npm run essai:parcours` simule une affaire entière : réception d'un courriel,
extraction par le modèle, préparation des consultations, réception des devis,
comparatif, costing verrouillé, accord, génération de l'offre, nettoyage.

Il appelle **les vraies fonctions** partout où elles existent —
`extraireSpecifications`, `genererConsultations`, `demanderValidation`,
`genererOffreComplete`. Deux exceptions nommées dans son en-tête : les devis
fournisseurs et la composition de la feuille, `construireFeuille` étant une
Server Action inaccessible hors de Next.

C'est lui qui a trouvé [BUG-28](#bug-28), qu'aucun essai unitaire ne voyait.

---

### Lancement séparé de l'application et du worker {#lancement-separe}

**Rien n'était défectueux — le worker a fait exactement ce pour quoi il est
construit.** Le 2026-08-27, une session de travail sur l'interface a laissé
tourner `npm run dev` (donc le worker, bundlé depuis l'origine de
`dev-tout.mjs`) sans personne pour surveiller la boîte. À 13h01, le job
`relances` a trouvé quatre consultations de DM-2026-000028 (huit jours sans
réponse) échues pour leur rappel, et a envoyé une relance réelle à UBSM, Lenovo
Maroc, Pure Solutions et APC — correctement, dans le fil d'origine, comme
conçu.

Le hasard du calendrier a voulu que cette demande porte déjà le statut
`offre_consultee` : une offre avait été générée et le client l'avait déjà vue.
`processRelances` ne regarde pas ce statut avant de relancer — il reste
scopé sur `statut in (envoyee, relancee, precision_demandee)`, sans lien avec
l'état de la demande parente. Ce n'est pas corrigé : c'est peut-être voulu
(compléter le dossier, préparer une révision), et la décision revient à
l'avant-vente, pas au code.

Le vrai sujet n'était donc pas ce que le worker a fait, mais **quand il a pu le
faire sans que personne ne le sache** : `dev-tout.mjs` bundlait web et worker
sous une seule commande, précisément pour qu'on ne croie jamais l'application
cassée faute d'avoir démarré le worker dans un second terminal — la garde
d'instance unique et le rattrapage de SIGHUP décrits en [BUG-08](#bug-08)
protègent ce même lanceur contre un worker orphelin, pas contre un worker actif
qu'on a simplement oublié. Le bundling supposait un développeur qui reste
devant son terminal. Une session de travail prolongée dessus, où le worker
tourne des heures sans qu'on y pense, est le cas qu'il n'avait pas prévu.

`npm run dev` ne lance désormais que l'application. Le worker exige un geste
séparé — `npm run dev:worker`, sans filet, ou `npm run dev:tout`
([`dev-tout.mjs`](../scripts/dev-tout.mjs)) quand les deux doivent
réellement tourner ensemble, avec sa garde d'instance unique et sa relance
automatique. Rien dans le comportement des jobs n'a changé — seule la façon de
les rendre actifs.

---

## Environnement

### ENV-01 {#env-01}

**Le serveur de dev renvoyait 500 après un build de production.**

| | |
|---|---|
| **Symptôme** | `Cannot find module './vendor-chunks/@supabase.js'` sur des routes qui fonctionnaient. |
| **Cause** | `next build` écrit dans le même `.next` que le serveur de dev en cours. Les artefacts deviennent incohérents. **Erreur de manipulation de ma part, deux fois.** |
| **Contournement** | Arrêter le serveur → purger `.next` → builder → redémarrer. Dans cet ordre. |
| **Statut** | Aucun code en cause. Documenté pour ne pas rediagnostiquer un faux bug. |

### ENV-02 {#env-02}

**Avertissement Edge Runtime au build.**

| | |
|---|---|
| **Message** | `A Node.js API is used (process.version) which is not supported in the Edge Runtime` — depuis `@supabase/supabase-js`, tiré par le middleware. |
| **Statut** | **Préexistant**, sans rapport avec les travaux de cette session. Le middleware fonctionne : les cinq routes testées répondent correctement. |
| **Recommandation** | À revoir lors de la montée `@supabase/ssr` (0.5.2 → 0.12.4), pas avant. |

---

## Parcours de bout en bout

[`essai-bout-en-bout-reel.ts`](../scripts/essai-bout-en-bout-reel.ts) rejoue un
cas professionnel complet — hôtel, refonte réseau, trois fournisseurs aux
couvertures inégales — en **24 contrôles**, sans envoyer le moindre courriel.

Depuis l'ajout du RAG, il boucle : les devis du parcours sont vectorisés, puis
la recherche doit retrouver leurs auteurs sur leur propre besoin. C'est ce qui
vérifie que chaque devis reçu améliore bien la proposition suivante.

Le scénario est construit pour que le piège se produise : Medina Tech affiche
**57 665 MAD** contre 118 700 à Atlas, mais ne chiffre que 2 articles sur 3. Le
test vérifie que le meilleur prix retenu est bien un devis **complet** — c'est
la protection qu'apporte la colonne de couverture, et elle est désormais
testée, pas seulement observée.

Le script nettoie intégralement derrière lui, y compris en cas d'échec.

---

## Ce qu'il faudrait pour aller plus loin

**BUG-02 et BUG-03 auraient été pris par un test.** Ils sont passés au travers de
`typecheck` et `lint`, et n'ont été trouvés qu'en cliquant.

Trois tests de bout en bout couvriraient l'essentiel : connexion, envoi d'offre,
décision client. Ce sont aussi les parcours à sécuriser avant la migration Next
16 décrite dans le rapport de sécurité — sans eux, cette migration se vérifie
écran par écran, à la main.
