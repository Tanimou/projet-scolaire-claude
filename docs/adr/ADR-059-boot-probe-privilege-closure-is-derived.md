# ADR-059 — La clôture de la sonde de démarrage est DÉRIVÉE du corpus, plus écrite à la main

- **Statut :** accepté
- **Date :** 2026-08-22
- **Tranche :** `S-E01-1k` — la clôture de privilèges cesse d'être un littéral et devient une comparaison
- **Ferme :** `PF-246` (le dimensionnement d'une tranche rate les relations traversées), mécanise `PF-219`
- **Prolonge :** ADR-042 §D3 (une seule affirmation par fait de catalogue), ADR-045 (la suite adversariale),
  ADR-051 §D2 (le cliquet ensembliste qui NOMME), ADR-057 §D1 (la clôture est relation-profonde),
  ADR-058 §D5 (un `WHERE` exige `SELECT` sur ce qu'il lit)
- **Qualifie :** ADR-057 §D1 — la règle « une relation traversée est une table lue » cesse d'être une
  consigne de relecture et devient une propriété **vérifiée par la machine**

---

## Contexte

`APP_ROLE_REQUIRED_PRIVILEGES` (`apps/api/src/shared/prisma/tenant-scope.ts`) est la liste que
`appRoleVerdict` parcourt **au démarrage**. Elle est écrite à la main ; le code qu'elle décrit est écrit
séparément ; les deux ont déjà décroché **deux fois, mesurées** :

- `S-E01-1i` a dimensionné sa tranche à **trois** droits nouveaux et en devait **cinq**. Les deux manquants
  (`assessment`, `term`) étaient des cibles de RELATION qu'un `select` imbriqué traverse, pas des délégués
  racines.
- `S-E01-1j` a ensuite ajouté **sept** entrées relation-profondes, 30 → 37.

Le mode de défaillance est ce qui rend le défaut coûteux : une paire manquante n'est **ni une erreur de
compilation ni un test rouge**. C'est un `42501` à l'exécution, sur exactement les déploiements où la portée
locataire FONCTIONNE. Et une paire déclarée mais **non détenue** est pire : `appRoleVerdict` rend
`refused_unusable`, `transactionRunnerOrNull()` lève un 503, et **les quatre portails tombent ensemble**.

La règle de la routine s'applique littéralement : *deux listes tenues à la main = dérive silencieuse ; on
corrige en DÉRIVANT, jamais en ajoutant un littéral de plus.*

**Résultat du premier passage de la mécanisation : `guardian.SELECT`.** Trente-sept entrées relues à la main
sur cinq tranches ; la trente-huitième a été nommée par la machine en une exécution. Ce n'est pas une
anecdote, c'est la mesure du défaut.

---

## Décision

### §D1 — Un script CJS de gate LIT une constante TypeScript, comme du TEXTE, en échouant fermé

Le côté déclaré de la comparaison est **PARSÉ depuis la source**
(`scripts/lib/app-role-closure.js`, `parseAppRoleRequiredPrivileges(sourceText)`), jamais retapé.

Les deux autres routes sont des défauts, et il faut les nommer pour que personne ne les reprenne :

1. **`require('apps/api/dist/…/tenant-scope.js')`** — l'artefact existe dans l'arbre et les agents ne
   construisent jamais (GUARDRAILS §4). `dist` est donc **périmé par construction** : le gate comparerait sa
   dérivation à une liste que la source a déjà dépassée, et il serait VERT. C'est `PF-246` reproduit dans son
   propre correctif. Aucun chemin sous `apps/api/dist` n'est lu, et le gate spec l'assert.
2. **Retaper les 38 paires dans le script** — une TROISIÈME liste à la main. Deux, c'est la maladie ; trois
   n'est pas un remède.

Il n'existait **aucun précédent** de lecture de `.ts` depuis `scripts/*.js` (mesuré : zéro). C'est donc une
décision d'architecture, et c'est pour cela qu'elle est ici. Elle est permise parce qu'elle préserve la
**source unique** : une liste, LUE. `ts-node` ou une transpilation au moment du gate sont refusés — un gate
qui compile est un gate qui casse sur un cache froid.

**Anti-vacuité obligatoire (DNC-08).** Zéro entrée lue, un `Object.freeze(` introuvable ou non balancé, une
entrée sans `table`/`privilege`/`why`, une paire dupliquée, une raison vacueuse, ou moins de
`MIN_DECLARED_PAIRS` (30) paires : chacun est un problème **NOMMÉ** et le verdict est refusé. Un ensemble
déclaré vide ferait sinon tirer 38 `dead-entry` fantômes, ou passer à vide — les deux sont pires que rouge.

Deux pièges mesurés sur le vrai fichier justifient l'emploi du lexer partagé plutôt qu'un scan de guillemets :
les `why` portent des apostrophes typographiques et sont **concaténés sur plusieurs lignes** avec `+` (une
raison mesurée fait 397 caractères en quatre fragments), et les commentaires de la liste citent des filtres
Prisma comportant des accolades — un `indexOf('{')` naïf y a fabriqué **trois entrées fantômes**.

### §D2 — Le graphe modèle → table → relation vient de `schema.prisma`, et il est CONFRONTÉ au catalogue

`modelToTable`, construit depuis le catalogue vivant, ne porte **aucune** des 204 relations du schéma. Or une
relation traversée est une table LUE sous RLS. Le graphe est donc dérivé du schéma
(`scripts/lib/prisma-schema-graph.js`).

ADR-042 §D3 interdit **deux affirmations écrites à la main** d'un même fait de catalogue. Celle-ci n'en ajoute
pas une : c'est une DÉRIVATION, et les deux dérivations sont **comparées** (`compareModelToTable`). Un
désaccord est une défaillance NOMMÉE, jamais une préférence silencieuse pour un côté — cette préférence est
exactement ce qui a laissé `role_permission` décrocher en `S-E01-1b`.

Mesuré sur ce checkout : **54 modèles, 54 `@@map`**, zéro désaccord. La correspondance est donc TOTALE, et un
modèle sans `@@map` n'est pas un cas à tolérer : c'est un `model-without-map`, refusé.

Les **clés composées** (`@@unique([a, b])` → la clé de recherche synthétique `a_b`) sont modélisées : sans
elles, `where: { announcementId_userProfileId: … }` remontait comme un champ inconnu — un refus fail-closed
sur une simple recherche scalaire, deux fois sur le vrai corpus.

**Conséquence à connaître : `apps/api/prisma/schema.prisma` est désormais une ENTRÉE DE GATE.** Renommer un
`@@map` déplace ce contrôle.

### §D3 — Le déclencheur du stage s'élargit à `apps/api/src/modules/` et `scripts/lib/`

`scripts/ci-gate.sh` ne déclenchait le stage `tenant adversarial` que sur `apps/api/prisma/`,
`apps/api/src/shared/prisma/`, trois scripts et `.env`. **La seule classe de diff qui CHANGE la clôture est une
conversion de module**, et une conversion de module ne touche que `apps/api/src/modules/**`. Mesuré : la
tranche suivante (`alerts.service.ts`, 33 sites d'appel) aurait **sauté le stage entièrement**.

Un gate qui police les conversions de module et ne tourne sur aucune ne peut pas se déclencher. Le coût est
réel — un stage de 300 s porteur d'une base sur une part bien plus large des diffs — et c'est précisément
pourquoi cette ligne est une décision consignée plutôt qu'une retouche discrète de regex. `scripts/lib/`
rejoint le déclencheur pour la raison qui y avait fait entrer `tenant-scope-check.js` en `S-E01-1d` : les
parseurs purs du vérificateur y vivent maintenant.

### §D4 — `dead-entry` est ASYMÉTRIQUE avec `undeclared-pair`, et l'asymétrie est ENCODÉE

La comparaison est ensembliste dans les deux sens, mais les deux sens ne se valent pas :

- la complétude de la **dérivation** est bornée par ce qu'une analyse statique peut VOIR ;
- la complétude de la **déclaration** est bornée par ce qu'un humain a écrit.

Donc une paire dérivée absente de la liste (`undeclared-pair`) est un défaut de la DÉCLARATION et échoue. Mais
une entrée déclarée que la dérivation ne voit pas veut dire « le marcheur ne l'a pas vue » **au moins aussi
souvent** que « personne n'en a besoin ». Le finding s'appelle donc `dead-entry-advisory`, il **échoue** (il
doit être résolu), et son détail énonce la barre de retrait : **un négatif MESURÉ** — `REVOKE` sur une base
jetable et le handler du module toujours 200 — jamais le finding seul. Supprimer un droit sur la seule foi
d'un `dead-entry` serait une panne `42501` verte au démarrage, sur les quatre portails.

Corollaire fail-closed : **aucun `dead-entry` n'est réclamé tant qu'un fichier n'a pas brace-matché**.
`covers()` est fail-closed PAR FICHIER, donc un `.run(` égaré dans un docblock fait contribuer zéro à tout un
module et ferait passer ses paires pour mortes (`TOOL-39` a tiré exactement ainsi). On échoue **vers la
déclaration** — le côté sûr.

### §D5 — Le SELECT du parent d'une policy FK-dérivée est DÉRIVÉ, pas excusé

`20260813180000_tenant_rls_derived_policies` donne à cinq tables une policy dont le prédicat est
`EXISTS (SELECT 1 FROM public.<parent> p WHERE p.id = <enfant>.<fk> AND p.tenant_id = <GUC>)`, **évaluée comme
le rôle appelant**. Lire `announcement_receipt` exige donc `announcement.SELECT` **par la policy**, en plus de
ce que le site d'appel demande. Aucune dérivation par sites d'appel ne peut le voir.

Aujourd'hui la clôture est **accidentellement** correcte (`announcement.SELECT` est dérivable par ailleurs) ;
`import_row`, `branding` et `grade_revision` sont à une conversion de module de rendre cet accident portant.
La règle est donc dérivée — la table `(enfant, fk, parent)` est **parsée depuis la migration qui la crée** —
et jamais listée à la main.

### §D6 — Un seul lexer de délimiteurs, partagé

`matchingParen` et ses aides sont déplacés dans `scripts/lib/js-source-scan.js` et généralisés aux trois
paires `(`/`[`/`{`. Avec `(` à l'index d'ouverture, le comportement est **octet pour octet** celui qui était
livré, et `module.exports.matchingParen` nomme toujours la même fonction. Écrire un second matcher pour les
accolades aurait été la maladie de cette tranche elle-même : `TOOL-39` est au ledger parce qu'**un** matcher,
nourri d'un docblock à parenthèse non fermée, a réduit à zéro la couverture d'un fichier entier.

### §D7 — Aucun contournement (DNC-10)

Ni variable d'environnement, ni drapeau CLI, ni `SKIP_`, ni mode warn-only, ni plancher de ratio réglable
n'existe dans ce mécanisme. Les deux planchers de non-vacuité (30 paires déclarées lues,
`MIN_SCOPED_SITES_FOR_CLOSURE = 40` sites attribués `scoped`) sont des **MURS** : un plancher réglable est un
drapeau de contournement déguisé. La liste d'exceptions AC-6 est de la DONNÉE avec une raison par entrée,
soumise à la même garde anti-vacuité que `tenant-scope.ts:159-164` ; une exception doit dire **pourquoi la
dérivation ne peut pas voir la paire**, jamais « autoriser cette table ». Elle est **VIDE** sur le corpus
d'aujourd'hui, et c'est une mesure.

---

## Ce que la dérivation voit, et ce qu'elle refuse de voir

**L'attribution est POSITIONNELLE, et seul `scoped` compte.** Un grep `tx.` est FAUX : `tx` est le paramètre
de callback de la portée locataire **et** de `this.prisma.$transaction`, qui tourne sur la connexion du
PROPRIÉTAIRE et échappe à RLS. Mesuré : `remediation/booking.service.ts` ouvre un `$transaction` propriétaire
et y écrit deux fois sur `booking`. `booking.INSERT` / `booking.UPDATE` **ne sont donc pas dus**, et la liste a
raison de ne porter que `booking.SELECT`. `audit_log.INSERT` est le troisième fantôme, et c'est le pire :
le droit **est détenu** (mesuré), donc une entrée fantôme démarrerait au VERT et serait morte pour toujours —
la sonde de détention n'est PAS un filet de sécurité pour une mauvaise attribution (`TOOL-40`).

**Les clés d'argument forment un jeu FERMÉ.** `where` (avec `some`/`every`/`none`/`is`/`isNot`,
`AND`/`OR`/`NOT`), `select`, `include`, `orderBy`, `having`, `omit`, `_count` sont TRAVERSÉES ; `take`, `skip`,
`cursor`, `distinct`, `by`, `skipDuplicates`, `_sum`/`_avg`/`_min`/`_max`/`_all` sont inertes ; `data`,
`create`, `update` sont des charges d'écriture dont toute construction imbriquée
(`connect`, `connectOrCreate`, `createMany`, `disconnect`, `deleteMany`, `updateMany`, `upsert`) est
**REFUSÉE et NOMMÉE**. Grepé sur les cinq modules convertis : **zéro** aujourd'hui. Ce n'est donc pas un trou
vivant, c'est le PROCHAIN `PF-246`, et il coûte une entrée de jeu fermé à désamorcer. Toute autre clé est un
`unknown-argument-key` fail-closed : « traiter les clés que je connais et ignorer le reste » est exactement la
manière dont un `orderBy` relationnel — une JOINTURE, donc un SELECT sur la cible — devient invisible.

**Les arguments HISSÉS et EXPRESSIONNELS sont RÉSOLUS, pas ignorés.** 20 sites d'appel passent une constante
en `include:`/`select:` (dont huit `PLAN_INCLUDE` dans `remediation.service.ts`, déclaré ligne 21, HORS de
toute portée). Un marcheur en-ligne-seulement y voit zéro relation, puis la comparaison bidirectionnelle
déclare MORTES `student.SELECT` et `subject.SELECT` — deux droits correctement déclarés. Les constantes de
module sont donc résolues, ainsi que les expressions qui CONTIENNENT des littéraux d'objet
(`...(cond ? { … } : {})`, `xs.map((i) => ({ … }))`, tous deux mesurés). Une expression sans le moindre
littéral est NOMMÉE.

---

## Conséquences

**Positives.** La règle « une relation traversée est une table lue » est désormais **exécutée** au lieu d'être
relue. La liste reste écrite à la main — une RAISON ne se dérive pas — mais elle ne se relit plus seule. Le
prochain module converti apprend ses droits par mesure et non par inspection, ce qui rend la tranche suivante
(`alerts.service.ts`) moins chère ET plus sûre.

**Négatives, et assumées.** `schema.prisma` et le tableau de la migration FK-dérivée deviennent des entrées de
gate. Le stage de 300 s tourne sur une part bien plus large des diffs. Et le vérificateur reste **couplé à une
base vivante pour démarrer** (il sort `tooling_unavailable` sans PostgreSQL) alors que la comparaison de
clôture, elle, est **entièrement source-à-source** : c'est la seconde face de `TOOL-40`, et elle reste ouverte.

**Non déclenché, mesuré et non supposé.** Aucun changement de `schema.prisma`, aucune migration, aucune entrée
dans `scripts/restore-drill-baseline.json` : les **38** paires de la clôture élargie sont **détenues** par
`app_user` sur la base de la pile, `guardian` compris (`SELECT`, RLS active, 1 policy). G-AUTHZ, G-AUDIT et
G-TRUTH ne sont pas touchés — et `audit_log` reste **délibérément absent** de la clôture, ses écritures vivant
sur la connexion du propriétaire, hors de toute portée.

**G-PORTAL, par rayon de souffle plutôt que par quatre écrans.** `appRoleVerdict` parcourt la liste
GLOBALEMENT au démarrage. Une paire fausse refuse la DEUXIÈME connexion de l'application, donc `/admin`,
`/teacher`, `/parent` et `/student` échouent **simultanément et identiquement**. C'est une panne
d'infrastructure au démarrage, pas un état d'erreur par écran : lui dessiner un état vide laisserait croire
qu'elle se rattrape dans l'UI.
