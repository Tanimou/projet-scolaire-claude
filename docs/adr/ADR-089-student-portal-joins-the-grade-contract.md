# ADR-089 — Le portail ÉLÈVE rejoint le contrat canonique des notes, et son jeu de NOTATION gagne la fenêtre d'année qu'il n'a jamais eue

- **Statut** : accepté
- **Date** : 2026-08-29
- **Tranche** : `S-E03-15` (run 105)
- **Findings** : `PF-338` fermée · `PF-05` avancée · `PF-04` avancée · `PF-480`, `PF-481`, `PF-482`, `PF-483` levées
- **Épique** : `V3-E03` — vérité canonique et contrats de requête
- **Palier de preuve** : **B** — projection de lecture ; aucune autorisation touchée, aucun code de réponse modifié

---

## Le contexte, tel qu'il a été MESURÉ et non hérité

La ligne `PF-05` (« la page des notes du parent rend zéro ») ne tient plus, depuis le run 102,
que sur **un seul résidu** énoncé en toutes lettres : *« six projections restent six »*, soit
`PF-337` (l'axe des permissions) et `PF-338` (les deux projections que le portail élève tient
et qui se contredisent).

`PF-338` décrivait deux `where` dans un seul fichier, divergeant sur trois axes :
l'absence, la valeur zéro, l'année scolaire. **La lecture du code au Step 2 a confirmé le
défaut et l'a trouvé plus large que la ligne ne l'enregistrait.**

| | site | statut | absence | valeur | **année** |
|---|---|---|---|---|---|
| **C** | `student-portal.service.ts:195` — `GET /student/grades` | littéral recopié | gardée | gardée | **aucune** |
| **D** | `student-portal.service.ts:682` — retombée vive de `subjectTrends` | littéral recopié | écartée | `not: null` | **aucune** |
| — | `student-portal.service.ts:648` — branche instantané | — | — | — | **aucune** |

Le troisième site n'était pas dans la ligne. Il l'est maintenant.

### Le fait qui a décidé de la tranche

```
grep -rn "resolveActiveAcademicYear(" apps/api/src --include=*.ts | grep -v spec
```

rend des sites dans `alerts`, `analytics`, `imports`, `integrations`, `school-structure`,
`students` et `school-performance-drilldown` — et **aucun** dans `student-portal`.

Le portail élève était **le seul des quatre sans aucune conscience d'année scolaire**, pendant
que le portail parent fenêtre les siennes depuis toujours (`scoringWindowGradesWhere`, dont
l'`academicYearId` est REQUIS et dont le commentaire dit qu'« une moyenne inter-années n'est la
moyenne de personne »).

**Conséquence, et c'est pourquoi cette tranche fait avancer `PF-04` et pas seulement `PF-338` :**
dès qu'un élève porte des notes sur deux années, `/student/dashboard` et `/parent/dashboard`
affichent une moyenne par matière DIFFÉRENTE pour le MÊME enfant. C'est la définition de
`PF-04` — des comptes incompatibles entre portails — entre deux portails montrant la même
personne.

---

## La décision

1. **C adopte `gradeRecordWhere`.** `/student/grades` est le pendant élève de `/parent/grades` :
   il LISTE, il ne NOTE pas. Il garde les absences — `isAbsent` descend dans la ligne rendue — et
   ne se fenêtre sur aucune année, parce qu'un relevé tronqué à l'année courante n'est plus un
   relevé. Troisième adoption du contrat.
2. **D gagne la fenêtre d'année**, et c'est le seul des trois sites qui corrige un défaut au lieu
   de déplacer un littéral. Son `where` est **asserté égal** à `scoringWindowGradesWhere({ … })`
   par la spec d'accord, mais il est écrit **EN CLAIR et non par un appel** : le gate
   `tenant adversarial` a **refusé** l'appel, et il avait raison. Voir « Le gate a refusé, et il
   avait raison » ci-dessous.
3. **La branche instantané filtre la même année résolue.**
4. **L'année est résolue par le résolveur canonique**, dans la portée qui porte déjà la lecture
   d'instantanés — pas dans une portée à elle.
5. **Sans année active, `subjectTrends` rend `[]`** et n'émet aucune lecture de notes.

### Le gate a REFUSÉ, et il avait raison — `PF-483`

La première écriture de D était `where: scoringWindowGradesWhere({ … })`, exactement comme
l'adoptant A. Le gate a répondu :

```
[unknown-field-in-argument] `where.academicYearId` n'est ni un champ de `Grade`
ni un opérateur Prisma que cet ensemble fermé modélise.
```

**Ce n'était pas un faux rouge, et le contourner aurait été une faute.** `AC-9 S-E01-1k` DÉRIVE
la clôture de privilèges du boot-probe en marchant les relations que chaque lecture **sous
portée** traverse : sous RLS, une relation traversée est une table **lue**, donc une paire
(table, privilège) que le boot-probe doit couvrir. Le `where` de D traverse
`assessment -> teachingAssignment`. **Derrière un appel de fonction, le marcheur ne peut pas les
voir** — la clôture serait partie sans ces deux paires, et le boot-probe aurait cessé de couvrir
ce que cette requête lit réellement.

**Pourquoi l'adoptant A y échappe, et pourquoi ce n'est pas à son crédit :** il lit sur
`this.prisma`, donc **hors portée**, et seules les lectures attribuées `scoped` sont marchées.
Ce n'est pas que son appel soit lisible ; c'est qu'il n'est pas regardé.

**Le défaut du marcheur, énoncé parce qu'il est plus grave que le refus qu'il a produit.** Face à
un appel, le marcheur prend l'**argument** pour le `where`. L'argument est le jeu d'**options** du
helper, pas la clause qu'il produit. D'où un faux refus quand une option n'est pas un champ — le
cas ci-dessus — mais aussi, et c'est la moitié dangereuse, un **faux accord silencieux** quand les
options se trouvent être des champs : `gradeRecordWhere({ tenantId, studentId })` est marché
**sans erreur** alors que le marcheur lit le mauvais objet. Il tombe juste ici seulement parce que
ce `where`-là ne traverse aucune relation. Un helper dont les options coïncident avec des champs
**et** qui traverserait une relation produirait une clôture incomplète sans rien faire rougir.

**Ce qui a été fait, et ce qui ne l'a pas été.** Le `where` de D est écrit en clair au site sous
portée pour que la traversée redevienne visible, et l'égalité avec le contrat est **assertée** par
la spec d'accord. **Aucune exception n'a été réclamée, et le gate n'a pas été touché** — l'affaiblir
pour faire passer un diff est le seul interdit absolu. Le remède réel (résoudre un helper pur, ou
à défaut **refuser** tout `where` non littéral au lieu d'en deviner un — le refus est sûr, la
devinette ne l'est pas) est une tranche d'outillage à part, enregistrée en `PF-483` **P1**.

**Ce que la réduction coûte, énoncé plutôt que passé sous silence :** D perd l'impossibilité *structurelle* de
diverger du contrat, et la remplace par une assertion *exécutée*. C'est un affaiblissement réel de
la garantie, accepté en connaissance de cause parce que l'alternative — rendre invisible au gate
une traversée de tables sous RLS — est pire.

**Contrôle exécuté après la réduction :** `tenant-adversarial-check.js` sort **0**, et son log est
**identique à celui de `main` à l'octet près**, hormis le nom horodaté de la base scratch.

### Pourquoi la résolution est APPARIÉE à la lecture d'instantanés

Première écriture : une portée dédiée. Le test `G-TENANT` existant a compté **5 ouvertures au
lieu de 4** et a eu raison de le faire — une portée de plus est une transaction interactive de
plus sur le chemin chaud du tableau de bord. Les deux instructions répondent à UNE question
(« les figures par matière de cet élève, pour l'année en cours ») et deux instructions restent
sous le budget de trois d'`ADR-049 §D4`. Le compte est **resté à 4**.

C'est un cas où une assertion existante a corrigé la conception plutôt que d'être mise à jour
pour lui obéir.

### Pourquoi `value: { not: null }` n'est PAS repris dans le `where`

Le contrat ne l'exprime pas : l'axe (c) est un axe d'ACCORD — les deux jeux gardent le zéro,
`PF-339` ayant été **falsifiée par exécution** (`ADR-084`). La boucle de D porte déjà
`if (!subj || g.value == null) continue`. La garde survit là où elle discrimine, sans
réintroduire dans le `where` un cinquième axe que le contrat vient d'unifier.

### Ce qui reste DIFFÉRENT, et qui est VOULU

C et D divergent toujours sur l'absence et sur l'année. C'est le même verdict que pour A et B,
pour les mêmes raisons produit, et la spec l'**asserte** au lieu de le déplorer. La divergence
est DÉCLARÉE ; elle n'est pas supprimée.

---

## La preuve, et sa limite exacte

### Exécutée

- **Contrôle ROUGE exécuté** : les deux `where` remis à leur forme d'avant → **5 tests rouges**,
  nommant précisément les assertions d'année. Restauré ensuite.
- `35/35` sur `src/modules/student-portal` (26 existants + 9 nouveaux).
- `2554/2554` sur `analytics`, `grades`, `teaching` et `shared/quality` (68 suites) — tous les
  cliquets du dépôt inclus.
- `typecheck` 13/13.

### La limite, énoncée plutôt que passée sous silence

**Le contrôle rouge n'a PAS rougi les assertions de C, et c'est un fait sur l'instrument.**
Un littéral `['published','revised']` correctement recopié produit une valeur *égale* à celle du
contrat : aucune comparaison de VALEUR ne peut distinguer « la copie a disparu » de « la copie
est juste ». Or « la copie a disparu » est exactement ce que `PF-338` demande, puisqu'une copie
juste aujourd'hui dérivera demain sans rien faire rougir (`DNC-01`).

La preuve est donc portée au niveau de la **SOURCE** : une assertion vérifie qu'aucun statut de
note n'est écrit à la main dans ce producteur, commentaires exclus. **Elle a immédiatement
trouvé une TROISIÈME copie** que la comparaison de valeurs ne pouvait pas voir — l'union de
types `g.status as 'published' | 'revised'` du mappeur de lignes, désormais
`as PublishedGradeStatus`. C'est la justification empirique de l'assertion, pas son ornement.

**Cette assertion est bornée à CE fichier**, parce que la tranche revendique **DEUX SITES
NOMMÉS et non une CLASSE**. Un cliquet à l'échelle du dépôt, avec l'allowlist dérivée que cela
suppose, appartient à la tranche qui fermera la classe. Le dire ici évite qu'une lecture future
prenne une assertion mono-fichier pour une garantie globale.

### Sonde live : NON EXÉCUTÉE

Aucune sonde HTTP n'a été lancée contre la pile. La raison est mesurée et non supposée :
`PF-478` a établi que la seed porte **une seule année scolaire** pour la totalité des
inscriptions et des évaluations. Une sonde sur cette seed ne pourrait pas distinguer une surface
fenêtrée d'une surface qui ne l'est pas — elle rendrait un **vert vacant**, exactement le
faux-vert du run 81. Le mécanisme est prouvé par le contrôle rouge exécuté ci-dessus.
Suivi comme résidu de `PF-478`.

---

## Ce que cette tranche NE ferme pas

- **`PF-05` reste `open`** sur `PF-337` — l'axe des PERMISSIONS (`students.read`, `grades.read`,
  `grades.read.self` pour un seul datum). C'est une question de surface d'autorisation à travers
  les portails, donc Tier A, et la fondre dans une tranche de vérité en ferait une tranche
  d'autorisation.
- **`PF-04` reste `open`** : un mécanisme de divergence de moins, mais rien ici ne compare un
  compte réel à travers les quatre portails.

## Findings levées — RECORD, DON'T FIX

- **`PF-480` (P2 `[evidence]`)** — `academic-year-resolution-gate.spec.ts` prouve qu'aucune
  lecture ne résout l'année HORS du résolveur canonique. C'est **vacuement vrai** d'une lecture
  qui n'en résout AUCUNE. Ce point aveugle est ce qui a laissé le portail élève livrer quatre
  projections aveugles à l'année pendant que le gate restait vert.
- **`PF-481` (P2 `[data-model]`)** — `StudentSubjectSnapshot` porte
  `@@unique([studentId, subjectId, termId])`, **sans `academicYearId`**, alors que le modèle
  possède la colonne et un index `[tenantId, studentId, academicYearId]`. L'instantané de la
  seconde année entre donc en collision avec celui de la première. Le filtre d'année ajouté ici
  rend la lecture correcte ; il ne répare pas la contrainte.
- **`PF-482` (P3 `[truth]`)** — la fenêtre d'année d'une note passe par
  `assessment.teachingAssignment.academicYearId`, l'axe COLONNE dont `S-E03-13`/`S-E03-14` ont
  sorti les lectures d'affectations portées par un enseignant. Le cliquet du run 104 ne juge que
  les lectures dont le MODÈLE est `teachingAssignment` : une lecture de `grade` portant l'axe
  colonne imbriqué lui est invisible. Non modifié ici — ce serait diverger de l'adoptant A
  (`analytics.service.ts`) au sein du contrat même que cette tranche adopte.

## Retour arrière

Un `git revert` du squash suffit. Aucun changement de schéma, aucune migration, aucun drapeau.
