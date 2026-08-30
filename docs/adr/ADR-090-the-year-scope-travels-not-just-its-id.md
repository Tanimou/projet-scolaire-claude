# ADR-090 — La PORTÉE de l'année voyage, pas seulement son id ; et la vétusté est RAPPORTÉE, jamais CHOISIE

- **Statut** : accepté
- **Date** : 2026-08-30
- **Tranche** : `S-E03-16` (run 106)
- **Findings** : `PF-15` — axe « la vétusté est calculée puis jetée » **fermé** · `PF-328` moitié containment **ré-allouée en `PF-484`** · `PF-484`, `PF-485`, `PF-486` levées
- **Épique** : `V3-E03` — vérité canonique et contrats de requête
- **Palier de preuve** : **B** + **cliquet obligatoire** — diff purement additif ; aucune autorisation, aucun code de réponse, aucune migration, aucune population touchés
- **Voisins** : `ADR-070` (résolution canonique de l'année) · `ADR-085` (une seule année active par école) · `ADR-089` (le portail élève rejoint le contrat des notes)

---

## Le contexte, tel qu'il a été MESURÉ et non hérité

`packages/contracts/src/academic-year/resolve-academic-year.ts` **décore** chaque résolution :
`name`, `startDate`, `endDate`, `status`, `viaFallback`, `containsReferenceDate`, `isStale`,
`staleByDays`, `activeCount`. Et `apps/api/src/modules/school-structure/school-context.service.ts`
— **le service que traversent les quatre portails**, appelé sur quasiment chaque requête
authentifiée — les **jetait tous** :

```ts
return { tenantId, schoolId, activeAcademicYearId: ay?.id ?? null };
//                                                  ^ tout le reste de `ay` mourait ici
```

La vétusté était donc **exposée au contrat et INEXISTANTE dans le système**. C'est le défaut de
forme du run 105 (`ADR-089`) répété une couche plus haut : *une valeur présente au contrat,
abandonnée au site qui compte.*

### Le fait qui a décidé de la tranche

Mesuré le **2026-08-30** par `docker exec pilotage_postgres psql -U pilotage -d pilotage`
(⚠ `localhost:5432` est le PostgreSQL **natif Windows**, une AUTRE base : toute mesure passe par
`docker exec`) :

| tenant | année `active` | fin | contient le 2026-08-30 ? | vétuste de |
|---|---|---|---|---|
| `58d4ca12…` | « 2025-2026 » | 2026-07-05 | **NON** | **56 jours** |
| `53fe06f3…` | « 2023–2024 » | 2024-07-05 | **NON** | **786 jours** |

**0 des 2 tenants vivants, soit 100 %, affichaient des chiffres portant sur une année scolaire
terminée, et aucune surface ne le disait.** Ce qui consommait la vétusté : **deux `logger.warn`**
(`alerts.service.ts:929`, `alerts-evaluator.service.ts`), et **zéro fichier `.tsx`**. Le signal
existait, écrit dans un journal que personne n'ouvre.

Ampleur mesurée de la surface : **60** sites appellent `SchoolContextService`, **45** lisent
`activeAcademicYearId` — **la quasi-totalité comme FILTRE** —, **5** l'émettent dans une réponse
HTTP, **3** pages web le consomment sans jamais nommer l'année.

### Le brief en nommait QUATRE. Il y en avait CINQ.

Le cinquième site d'émission est `structure.controller.ts` — `GET /structure/cycles/:id`,
`return { ...cycle, activeAcademicYearId }`. Il n'apparaît dans aucun grep ancré sur la ligne
parce qu'il vit dans un **spread**. Ce n'est pas une étourderie du brief : c'est le mode de
défaillance que le cliquet de cette tranche existe pour rendre impossible (« deux listes à la
main = dérive silencieuse », run 59 ; « 14 écrit, 6 réels », run 104). **Le plafond a été MESURÉ
en forçant la tolérance à zéro et en LISANT la liste imprimée**, jamais recopié d'une prose.

---

## La décision

### D1 — Le champ nouveau s'appelle `activeAcademicYear`, et l'ancien SURVIT

`activeAcademicYearId` **n'est pas remplacé**, il est préservé à l'octet près. Deux raisons, la
seconde étant la plus forte :

1. 45 sites le lisent comme filtre et 3 pages web le typent : le remplacer ferait un diff
   transverse de 48 sites, donc Tier A, donc non prouvable en un run.
2. **La révertibilité.** Un diff purement additif se révoque en une commande sans laisser
   d'appelant orphelin. C'est ce qui autorise Tier B.

Le nom sans suffixe est délibéré : `activeAcademicYear` se lit « l'année », `activeAcademicYearId`
se lit « l'id de l'année ». Aucun ne peut être pris pour l'autre à la relecture.

### D2 — La forme transportée est un **DTO de fil**, pas le type domaine

`ResolvedAcademicYear` porte `startDate: Date` / `endDate: Date`. Sérialisé par Nest, un `Date`
devient une **chaîne ISO**. Rendre `ResolvedAcademicYear` tel quel donnerait un type TypeScript
qui **ment sur le fil** : un consommateur web typecheckerait vert et appellerait
`.toLocaleDateString()` sur une `string` — `TypeError` à **chaque** requête, les deux pages cibles
étant `force-dynamic`, donc jamais attrapée au build. Un `DNC-06` posé de nos propres mains reste
un `DNC-06`.

D'où `packages/contracts/src/academic-year/academic-year-scope.ts` :
`AcademicYearScope` (dates en `string`) + `toAcademicYearScope`, **mapper pur, total, sans
horloge** — la date de référence a déjà été consommée par le résolveur, et
`hermetic-spec-writers-gate` couvre ce dossier.

Deux choix de projection, écrits parce qu'ils sont des décisions et non des détails :

- **`schoolId` n'est PAS transporté.** La réponse le porte déjà ailleurs ; un second porteur du
  même fait serait la divergence que `V3-E03` referme.
- **Le mapper écrit champ par champ, jamais `{ ...resolved, startDate: … }`.** Un spread ferait
  fuiter `schoolId` dans le contrat sans que personne ne l'ait décidé. Une projection se DÉCLARE.

### D3 — Le mapping se fait **UNE fois**, dans `SchoolContextService`

`forTenant` / `forUser` rendent `activeAcademicYear: AcademicYearScope | null` ; les cinq
contrôleurs font un **passe-plat** et rien d'autre. `forUser` déléguant à `forTenant`, les deux
chemins — dont la branche « école préférée valide » — sont couverts par construction.

**Zéro requête supplémentaire** : `ay` est la ligne déjà en main, seul `.id` en sortait. Si le
mapping vivait dans les contrôleurs, le cliquet devrait vérifier un *appel de fonction* au lieu
d'une *présence de clé* — et `PF-483` (run 105) établit qu'un argument derrière un appel devient
invisible au marcheur. **Une règle de FORME sur une clé est robuste ; une règle sur un appel ne
l'est pas.**

### D4 — La portée décrit l'année **ACTIVE**, jamais l'année **SÉLECTIONNÉE**

Décision prise à l'écriture et non prévue par la spec : deux des cinq sites servent des surfaces
qui portent un **sélecteur d'année** (`GET /structure` a `selectedYearId`,
`GET /teachers/me/assignments` a `yearId`). `activeAcademicYear` y décrit l'année **active de
l'établissement**, pas celle dont la réponse porte les chiffres.

Poser « 2025-2026 · terminée il y a 56 jours » en tête d'un arbre qui montre 2023–2024 mettrait
**deux portées contradictoires sur un même écran** — `DNC-01`. Le consommateur ne rend donc le
badge en position « portée de la page » que lorsque les deux coïncident ; sinon le badge redescend
à côté d'une phrase qui **nomme les deux années**, et son sujet devient l'établissement, pas le
tableau.

⛔ **Et la portée de l'année sélectionnée n'est PAS fabriquée côté client.** `isStale` et
`containsReferenceDate` s'y recalculeraient sur une horloge de navigateur, c'est-à-dire une
**deuxième dérivation** du fait unique que cette tranche existe pour arrêter de perdre.

### D5 — ⛔ INTERDICTION ABSOLUE : ne jamais SÉLECTIONNER sur `containsReferenceDate` ni `isStale`

Sur les données mesurées, **0 des 2 années actives ne contient aujourd'hui**. Un filtre, un tri,
un `?? fallback` ou un `if (!isStale)` quelque part sur ce chemin **viderait les quatre portails**.
Ce n'est pas une précaution : c'est le résultat mesuré au run 80, re-mesuré au run 101, re-mesuré
aujourd'hui.

`ADR-070` porte déjà la règle au niveau du résolveur. **`ADR-090` la promeut en règle de
PRODUIT** : *le containment est une propriété RAPPORTÉE ; il ne devient un critère de sélection
que le jour où quelqu'un tranche ce que « active » signifie pour une année terminée.* C'est
`PF-484`, ce n'est pas une tranche de vérité, et rien ne doit l'improviser en chemin.

La forme des props du badge **est** l'application de cette règle : il reçoit un **verdict** déjà
décidé côté serveur, jamais des lignes ni un `endDate`. Une prop `endDate` le forcerait à
recalculer la vétusté dans `packages/ui`, **hors des racines de marche du cliquet** — donc
strictement pire que le bug d'origine.

### D6 — `packages/ui` ne gagne **aucune** dépendance

`packages/ui` ne dépend pas de `@pilotage/contracts` et **ne commence pas ici** : ce serait une
décision d'architecture nouvelle, donc un ADR séparé, donc hors tranche. `AcademicYearScopeBadge`
déclare sa propre interface structurelle `AcademicYearScopeInput`, compatible par structure avec
`AcademicYearScope` — le patron déjà en place pour `EnrollmentStatusBadge` et `MfaStatusBadge`. Le
compilateur vérifie la compatibilité au site d'appel, dans `apps/web`, qui dépend des deux
paquets.

Une nuance load-bearing y est inscrite : `startDate` / `endDate` sont typés `string | Date` et
**jamais `Date` seul**. Le serveur tient des `Date`, le fil transporte des chaînes ; un type qui
n'admettrait que `Date` compilerait au vert et jetterait `getTime is not a function` à
l'exécution.

### D7 — Le vocabulaire de portée a **SIX** états, et deux d'entre eux sont des corrections

`academicYearScopeState()` — une seule dérivation, exportée, qu'aucune surface ne re-décide :
`current` · `last_day` · `stale` · `outside` · `none` · `unavailable`.

Deux ne sont pas des raffinements cosmétiques :

- **`unavailable` ≠ `none`.** `null` est une **réponse** (« l'API a résolu : aucune année
  active ») — un fait métier, avec une suite administrative. `undefined` est une **absence de
  champ** : fenêtre de déploiement glissant (`web` et `api` sont deux services compose distincts),
  ou lecture échouée avalée par `safe()`. Les faire converger peindrait « Aucune année active »,
  c'est-à-dire **un échec de lecture rendu comme un fait métier** — l'erreur qu'`EnrollmentStatusBadge`
  a déjà nommée et fermée.
- **`last_day`.** `startDate`/`endDate` sont des colonnes `@db.Date`, donc minuit UTC, et le
  résolveur compare à un instant mur : le 5 juillet à 00:00:01Z, une année finissant le 5 juillet
  rend déjà `isStale: true` avec `staleByDays: 0`. Tant que les deux seuls consommateurs étaient
  des `logger.warn`, c'était du bruit de journal ; promu à un BADGE, cela afficherait « terminée
  il y a 0 jours » **le jour même de la fin** — une contre-vérité produite par la tranche censée
  dire la vérité sur la portée. **Le résolveur n'est pas touché** (il reste juste sur son propre
  prédicat) ; c'est le rendu qui refuse de sur-affirmer.

### D8 — `G-MIGRATION` non déclenché, et c'est le cœur du design

Aucune modification de `schema.prisma`, aucune migration, aucun SQL. C'est ce qui rend la tranche
révertible en une commande et la maintient en Tier B. Toute pulsion d'ajouter une contrainte de
containment est `PF-484` et doit être **écrite au registre, pas codée**.

### D9 — Aucun `WARN` par requête dans `SchoolContextService`

Ce service tourne sur quasiment chaque requête authentifiée : un `logger.warn` par requête
noierait les deux signaux basse fréquence existants. Le signal humain de cette tranche est **le
badge**, pas un journal de plus.

---

## Le cliquet — pourquoi il est obligatoire, et ce qu'il est

`apps/api/src/shared/quality/academic-year-scope-emission-gate.spec.ts`.

**Il est obligatoire parce que `PF-15` ferme comme une CLASSE** (Step 5 règle 2) : la ligne ne dit
pas « ces cinq réponses », elle dit « la vétusté n'est nulle part ». Sans cliquet dérivé, la
sixième réponse écrite le mois prochain rouvrirait la ligne **en silence**.

- **Corpus DÉRIVÉ du nom** : tout `*.controller.ts` sous `apps/api/src` — jamais une liste.
- **Classifieur AST** (`typescript`, `require` non gardé, `DNC-08` : si l'outil s'évapore, la
  suite meurt au CHARGEMENT plutôt que de dégénérer en « rien à vérifier »). Il suit les
  littéraux d'objet, les propriétés abrégées, **les spreads de littéraux**, **les deux branches
  des ternaires** et les parenthèses, profondeur bornée. **Sans le suivi des spreads, ce cliquet
  sortirait vert sur 4/5 et AURAIT L'AIR juste.**
- **Violation** ⇔ un `return` de méthode décorée HTTP porte `activeAcademicYearId` **sans**
  `activeAcademicYear`. **Tolérance ZÉRO** — aucun des cinq sites n'est un mur d'autorisation, ni
  ne demande de décision sémantique ; un plafond serait un confort, pas une prudence.
- **`MANUAL_ALLOWLIST` existe, est NOMMÉE, et EXPÉDIE VIDE** — une assertion le vérifie. Aucune
  variable d'environnement, aucun `SKIP_*` / `ALLOW_*`.
- **La restriction du corpus à `apps/api/src` est PROUVÉE, pas affirmée** : une assertion vérifie
  que **zéro** décorateur de route existe hors `apps/api/src` — une classe qui vaut 0 et doit le
  rester. C'est ce qui distingue cette mono-racine de la paresse que
  `academic-year-resolution-gate` dénonce : la classe « projection de réponse HTTP » ne peut
  structurellement pas exister dans `apps/worker` (processeurs BullMQ) ni dans `packages/*` (ni
  Nest, ni routes).
- **Anti-vacuité par FIXTURES** (5, passées directement au classifieur, extension `.txt` pour
  qu'aucun runner ne les compile), **jamais par un comptage de sites de production** : le nombre
  de contrevenants est exactement la classe que la tranche fait tomber à zéro, et un plancher
  dessus serait satisfait par le correctif **puis par la mort du cliquet** (leçon du run 95). Les
  seuls planchers de production sont des planchers de **MARCHE** (`MIN_CONTROLLER_FILES = 30`) —
  des grandeurs qui ne rétrécissent pas.

**La discrimination qui protège `packages/imports-core/src/caches.ts` est structurelle — suffixe
de fichier **+** décorateur de méthode — et jamais une allowlist.** Ce cache est le chemin
d'**ÉCRITURE** de l'import, où la valeur est persistée ; lui exiger un objet de portée serait
absurde et produirait un faux rouge qu'on « corrigerait » par une exception. C'est `PF-486` :
**enregistré, pas pardonné**.

### Ce que ce cliquet NE prouve PAS

Il prouve une **FORME dans les sources**. Que la pile qui tourne rende vraiment `isStale: true`
avec un `staleByDays` recoupé en SQL est porté par la **sonde live** ; que la portée soit
**affichée** est porté par le badge et la revue de diff. **Trois affirmations, trois mécanismes ;
les confondre serait `DNC-06`.**

---

## `G-PORTAL` : c'est **2 portails sur 4**, et le dire est une exigence

| portail | badge ? | pourquoi |
|---|---|---|
| **ADMIN** | **OUI** — `/admin/school/structure` | la surface où le désaccord est le plus visible : effectifs, taux de remplissage, totaux d'une année finie |
| **TEACHER** | **OUI** — `/teacher/classes` | « mes classes » est une affirmation d'année |
| **PARENT** | **NON** | aucune surface parent ne consomme un des cinq sites d'émission ; le bilan imprimable **nomme** déjà l'année (`S-E03-3`, run 82) mais ne dit pas qu'elle est terminée depuis 786 jours. Résidu **`PF-485`** |
| **STUDENT** | **NON** | `student-portal` résout son année par le résolveur canonique depuis `ADR-089` mais n'émet aucun objet de portée. Résidu **`PF-485`** |

`apps/web/src/app/admin/teachers/[id]/page.tsx` **reçoit** le champ et **ne l'affiche pas** : la
page est déjà portée par un enseignant nommé, un troisième badge n'y ajouterait aucune preuve. Le
type est aligné pour que le champ ne soit pas perdu en silence. **Déclaré, pas oublié.**

---

## Ce que cette tranche NE ferme pas

- **`PF-484` (P1)** — `academic_year` ne porte **aucun invariant de containment**, et 0/2 tenants
  le respecteraient. Reprend la moitié containment de `PF-328` (dont la moitié multiplicité est
  fermée depuis `ADR-085`, index re-vérifié sur le conteneur le 2026-08-30). Un `CHECK` refuserait
  **les deux lignes vivantes** : il faut un expand/contract **et** une décision de produit.
  **Bloque toute sélection sur `containsReferenceDate`, partout.**
- **`PF-485` (P2)** — les portails PARENT et STUDENT ne portent pas le badge. Les y amener demande
  de convertir des endpoints qui ne passent pas par `SchoolContextService` — un diff d'une autre
  nature.
- **`PF-486` (P3)** — le chemin d'ÉCRITURE de l'import transporte `activeAcademicYearId` sans
  portée (`caches.ts:174`, `imports.processor.ts:202`), et la valeur y est **persistée**. Hors
  corpus du cliquet **par construction**. Un import qui écrit dans une année terminée depuis 786
  jours est un vrai sujet — un sujet d'IMPORT, avec ses propres preuves. Voisin de `PF-334`, pas
  identique.

`PF-15` ferme donc sur l'axe « la vétusté est calculée puis jetée », **et sur lui seul** : l'axe
invariant est `PF-484` et reste ouvert. Ne pas lire cette ligne comme un `closed` sans résidu.

---

## L'état de la preuve, énoncé sans arrondir

Cet ADR est écrit **au land, avant que le journal de run ne soit clos**. Il nomme donc les
mécanismes et leur état réel — `landed: true` n'est pas `ran: true`.

| # | preuve | mécanisme présent dans l'arbre | exécution |
|---|---|---|---|
| 1 | `school-context-year-scope.spec.ts` | oui — `forTenant`/`forUser`, les deux branches de `forUser`, `staleByDays` comparé à la valeur **calculée par le résolveur** et jamais à un littéral recopié (leçon du run 105), `startDate`/`endDate` assertés `string` | contrôle **rouge-avant / vert-après** à exécuter et à NOTER site par site |
| 2 | `academic-year-scope-emission-gate.spec.ts` | oui — dérivé, tolérance zéro, allowlist vide assertée | contrôle rouge contre `origin/main` restauré, qui doit **nommer exactement** les cinq sites et rien d'autre |
| 3 | 5 fixtures d'anti-vacuité | oui — `offending`, `offending-spread`, `offending-ternary`, `compliant`, `non-http` | passées **directement** au classifieur |
| 4 | `school-context-tenant-scope.spec.ts` (existant, `G-TENANT`) | `tenantId` reste un paramètre **requis** du résolveur au site `SchoolContextService` — la correction du run 80 ne régresse pas | doit rester vert **sans modification** ; s'il faut le toucher, c'est le diff qui est faux |
| 5 | `pnpm typecheck` | — | **exit 0, 13/13 tâches turbo**, 0 occurrence de `error TS` ; `git diff --check` exit 0 |
| 6 | sonde live | ici la seed **DISCRIMINE** (contrairement au cas `PF-478`) : `isStale === true` et `staleByDays ≥ 56` sont une observation réelle, pas un vert vacant | ⚠ **à exécuter avec l'ÂGE DE L'IMAGE écrit à côté de la mesure** — l'image `api` précédait le code de 1 h 54 au moment de la spec (`PF-476`), et `migrator` partage `Dockerfile.api` (`PF-479`, P0). Contrôle positif obligatoire (`activeAcademicYearId === activeAcademicYear.id`, un `200` nu n'affirme qu'une coïncidence — run 81) + contrôle négatif SQL sur le conteneur. **Si elle ne tourne pas : écrire `probe NOT EXECUTED — <raison mesurée>`, jamais la déclarer verte** |

**Le rebuild est l'affaire de la session orchestratrice sous le lock, jamais d'un agent**
(GUARDRAILS §4).

---

## Retour arrière

Un `git revert` du squash suffit. Aucun changement de schéma, aucune migration, aucun drapeau,
aucun appelant orphelin : c'est exactement la propriété que `D1` a été choisi pour préserver.
