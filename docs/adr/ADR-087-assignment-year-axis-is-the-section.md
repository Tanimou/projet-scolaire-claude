# ADR-087 — L'année d'une affectation se lit sur sa SECTION

**Statut :** accepté · **Run :** 103 (2026-08-29) · **Story :** `S-E03-13`
**Findings :** `PF-36` *(avancée)*, `PF-04` *(avancée)* · `PF-472` **FALSIFIÉE** · `PF-473`, `PF-474` *(relevées)*
**Palier de preuve : B** — conversion à sémantique constante sur huit sites, mesurée identique sur les
données réelles avant bascule. Pas de cliquet : la fermeture est réclamée comme HUIT SITES, jamais comme
une CLASSE — les ~15 lectures imbriquées qui restent sont nommées et tracées, pas glissées sous le tapis.

---

## D1 — Le fait de base : `TeachingAssignment` a deux axes d'année, et la base laisse les deux se contredire

`TeachingAssignment` porte `academic_year_id` **et** un `class_section_id` dont la section porte elle-même
`academic_year_id`. Il n'existe **aucune** clé étrangère composite `(class_section_id, academic_year_id)`
vers `class_section(id, academic_year_id)` : rien n'oblige les deux à s'accorder.

Ce n'est pas une lecture de schéma, c'est une **mesure**. Contre le Postgres du **conteneur**
(`docker exec pilotage_postgres`, la seule base qui compte — `localhost:5432` est le service Windows natif,
une autre base), dans une transaction annulée :

```
CONTROL_B_year_drift_rows_accepted | 1      ← la ligne dérivée est ACCEPTÉE
after_rollback_drift               | 0      ← et la transaction n'a rien laissé
```

`teaching-wall.where.ts` affirmait déjà cette possibilité en prose (`ADR-063 §D1`, second point). Personne
ne l'avait exécutée. Elle est maintenant un fait.

## D2 — Pourquoi la SECTION est l'axe canonique, et la colonne une simple dénormalisation

`ClassSection` est **épinglée** à une année : `academicYearId` non nul, et
`@@unique([academicYearId, gradeLevelId, name])` (`schema.prisma:457`, `:478`). Un `classSectionId`
**détermine donc déjà** l'année, fonctionnellement.

Le seul site d'écriture de production **dérive** la colonne de la section —
`teaching-assignments.controller.ts`, `academicYearId: cls.academicYearId`. La colonne est donc une copie
de la section, pas une seconde source. **Un axe dérivé qui peut contredire sa source n'est pas un axe :
c'est une copie non contrainte.**

Le vocabulaire existait déjà dans le dépôt — `ROSTER_YEAR_IMPLIED_BY_SECTION` (`S-E03-7` / `ADR-079`). Les
lectures d'affectations ne s'en servaient pas.

## D3 — Ce qui a été mesuré AVANT de convertir, et qui rend la bascule sûre

Les deux axes ont été **comptés** par année sur la base du conteneur :

| année | affectations (axe colonne) | affectations (axe section) | enseignants distincts (colonne / section) |
|---|---|---|---|
| 2021–2022 | 0 | 0 | 0 / 0 |
| 2022–2023 | 0 | 0 | 0 / 0 |
| 2023–2024 | 286 | 286 | 186 / 186 |
| 2025-2026 | 0 | 0 | 0 / 0 |

Delta **0** partout. La conversion est donc **à sémantique constante sur les données réelles**, et à
sémantique **corrigée** dès qu'une dérive existerait. C'est le seul ordre honnête : mesurer d'abord,
convertir ensuite.

## D4 — La décision

Les lectures d'affectations dérivent leur portée d'année d'**un** prédicat nommé,
`assignmentYearScopeWhere` (`apps/api/src/modules/teaching/assignment-year-scope.ts`), qui rend
`{ classSection: { academicYearId } }`.

**Huit sites de production** adoptés : `teachers.controller.ts` (`me/assignments`, `me/students`,
`:id/load`), `teaching-assignments.controller.ts` (`where` de page **et** `coverageWhere`),
`analytics.service.ts` (trois lectures directes).

Le prédicat est **total** : « aucune année » se décide une fois, ici, au lieu d'être ré-épelé en
`...(yearId ? { academicYearId: yearId } : {})` sur chaque site. Cinq littéraux recopiés étaient cinq
occasions de diverger — `DNC-01` dans sa forme la plus banale, le constat exact de `S-E03-3` sur les
projections parent.

Il ne porte **que** l'année. Jamais `tenantId` : l'axe tenant reste exigé explicitement par chaque appelant
(`ADR-032 §D5` — sous `degraded_no_app_url` la connexion propriétaire échappe à ses propres policies RLS,
et la clause de tenant est la seule chose qui filtre). Un prédicat qui porterait les deux inviterait à
oublier le tenant quand l'année est absente.

**Le module est une FEUILLE de type** — il n'importe que le type `Prisma`, aucun décorateur, aucun
provider. C'est ce qui autorise `analytics/` à l'importer depuis `teaching/` sans créer d'arête de module
Nest, exactement l'argument qui a placé `teaching-wall.where.ts` où il est.

## D5 — `PF-472` est FALSIFIÉE, et cette tranche naît de sa falsification

Le run 102 avait relevé `PF-472` : `@@unique([teacherProfileId, classSectionId, subjectId])`, sans
`academicYearId`, empêcherait un enseignant de reprendre la même matière dans la même classe l'année
suivante — « la continuité inter-années est inexprimable ».

**C'est faux, pour la raison même qui rend l'axe section canonique** (§D2) : « la même classe » sur deux
années sont **deux lignes `class_section` distinctes**, donc deux `classSectionId` distincts, donc deux
lignes que la clé d'unicité n'oppose pas. Contrôle exécuté dans la même transaction annulée : la section de
l'année précédente **et** l'affectation jumelle sont toutes deux acceptées (`INSERT 0 1`, `INSERT 0 1` ;
trois lignes pour le couple enseignant × matière).

La leçon vaut plus que la correction : `PF-472` a été inférée d'une **fixture qui refusait de s'insérer**,
et la cause a été attribuée sans être exécutée. Le run 102 en tirait que `PF-471` (la seed mono-année)
était causée par le schéma. **Elle ne l'est pas** — le schéma autorise la seconde année. `PF-471` reste
donc ouverte sur sa vraie cause, qui est la **seed**, pas la contrainte.

## D6 — Ce que cette tranche ne fait PAS, et pourquoi c'est écrit ici plutôt que découvert plus tard

1. **Elle ne pose pas la clé étrangère composite.** Faire converger les lectures retire la divergence des
   **nombres** ; seule la contrainte retire la divergence des **données**. Tant qu'elle n'est pas posée, un
   import, une seed ou un correctif SQL à la main peuvent encore écrire une colonne fausse. Migration
   expand/contract, rollback énoncé, entrée obligatoire dans `scripts/restore-drill-baseline.json` :
   **`PF-473`**, sa propre tranche `G-MIGRATION`.
2. **Elle ne touche pas les ~15 lectures IMBRIQUÉES** de la forme
   `assessment: { teachingAssignment: { academicYearId } }` — mesurées à 18 occurrences sur 12 fichiers,
   dont 3 spécifications, réparties dans `analytics/`, `alerts/rules/` et `grades/`. Elles lisent le même
   axe colonne et sont donc exposées à la même dérive : **`PF-474`**.
3. **Elle ne re-mesure aucun compte d'enseignant à travers les quatre portails.** `PF-36` reste donc
   `open`, **avancée** : un axe de divergence est retiré par construction sur huit sites, les comptes
   eux-mêmes ne sont toujours pas comparés portail à portail. C'est aussi le résidu (iii) de `PF-04`, et il
   n'est pas entamé ici.

## D7 — La preuve, et son axe faible

`apps/api/src/modules/teaching/assignment-year-axis.spec.ts` — **fichier neuf**, aucune spec existante
retouchée pour obtenir le rouge. Il n'affirme rien sur un littéral recopié : il **exécute** les vrais
contrôleurs avec un Prisma espion et lit les `where` que la production construit. `8/8`, plus `185/185` en
régression sur `modules/teaching` + `modules/analytics`, typecheck `10/10` projets.

**Le contrôle qui compte :** une ligne remise à `academicYearId: activeAcademicYearId` sur
`teachers.controller.ts:434` rend **exactement** le test `GET /teachers/:id/load` ROUGE, et lui seul. La
spec voit donc le site, pas une copie.

**Axe faible, nommé :** aucune assertion HTTP. L'équivalence est prouvée au niveau du `where` construit et
au niveau des comptes SQL, jamais au niveau d'une réponse de bout en bout — la même limite que `S-E03-3`,
pour la même raison (`PF-471` : la seed ne porte qu'une année peuplée, donc aucun test d'intégration ne
peut distinguer les deux axes sur les données livrées).
