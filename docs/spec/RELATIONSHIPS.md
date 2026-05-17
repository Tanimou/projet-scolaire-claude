# Modèle relationnel — Pilotage scolaire

> Document de référence pour comprendre comment les entités sont liées entre elles, comment les visualiser dans l'UI, et quels endpoints les exposent.

## Vue d'ensemble

```
Tenant (groupe scolaire / éditeur)
  └── School (établissement)
        ├── AcademicYear (année 2025-2026, 2026-2027…)
        │     └── Term (trimestre 1, 2, 3)
        ├── Cycle (Collège, Lycée, Primaire, Maternelle…)
        │     └── GradeLevel (6ème, 5ème, … Terminale)
        │           ├── SubjectCoefficient × Subject (matière × coef pour ce niveau)
        │           └── ClassSection (6eA, 6eB, …) ── par année
        │                 └── Enrollment ── Student (élève)
        ├── Subject (Math, Français… définies au niveau école)
        ├── Student (un élève appartient à une école — UN seul)
        └── Guardian (parent/responsable — peut être lié à N élèves)
              └── Guardianship (lien Guardian ↔ Student avec relation, contact principal, etc.)
```

## Règles métier

### 1. Une école contient plusieurs cycles
Un établissement peut comporter plusieurs cycles pédagogiques (ex. un groupe scolaire Collège + Lycée). Chaque cycle a son propre code (`college`, `lycee`), sa propre couleur, et ses propres niveaux.

**Modèle** : `School 1—N Cycle` (champ `cycleId` non-null sur Cycle).

### 2. Chaque cycle contient ses niveaux ordonnés
Un cycle Collège typique = 6ème, 5ème, 4ème, 3ème. Chaque niveau a un `orderIndex` qui détermine l'ordre d'affichage.

**Modèle** : `Cycle 1—N GradeLevel`.

### 3. Une classe est instanciée par niveau + par année
La même 6eA existe en 2025-2026 puis en 2026-2027 comme deux classes distinctes — c'est normal, ça permet de tracer la composition par cohorte. Une classe est définie par le **triplet (année scolaire × niveau × nom)**, unique en base.

**Modèle** : `ClassSection` a `academicYearId` et `gradeLevelId`. Contrainte unique `(academicYearId, gradeLevelId, name)`.

### 4. Un élève est rattaché à une école et inscrit dans des classes via Enrollment
- L'élève appartient à **une seule école** (`Student.schoolId`).
- L'élève peut avoir **plusieurs Enrollment** (un par année passée + un actif pour l'année courante).
- Une seule inscription `active` par année (vérifiée applicativement dans `EnrollmentsController.create`).
- Le « transfert » entre classes (même année) crée une nouvelle Enrollment et clôt l'ancienne avec `status='transferred_out'`.

**Workflow d'inscription** : depuis la fiche élève → onglet « Inscriptions » → sélection d'une classe active.

### 5. Les coefficients sont définis par (niveau × matière), pas par classe
Toutes les classes d'un même niveau (6eA, 6eB, 6eC) partagent les mêmes coefficients de matières. C'est la norme dans le système éducatif français.

**Modèle** : `SubjectCoefficient(gradeLevelId, subjectId, coefficient)`. Si absent, on retombe sur `Subject.defaultCoefficient`.

**Conséquence UI** : la page Class detail montre la liste des matières avec leur coefficient *hérité du niveau*, étiquette « personnalisé » si une valeur surchargée existe, sinon « défaut ».

### 6. Un parent peut être rattaché à plusieurs élèves
- `Guardian` représente la personne (mère, père, tuteur…).
- `Guardianship` est le lien Guardian ↔ Student avec `relationship`, `isPrimaryContact`, `canPickup`, `hasLegalCustody`, `status`.
- Un parent partagé entre deux enfants n'apparaît qu'une seule fois en base — pas de duplication.

## Endpoints clés

| Endpoint | Renvoie | Utilisé par |
|---|---|---|
| `GET /api/v1/school/structure?academicYearId=` | Arbre complet School → Cycles → Levels → Classes (avec compteurs vivants élèves/capacité) | `/admin/school/structure` |
| `GET /api/v1/school/structure/cycles/:id` | Détail d'un cycle avec niveaux + classes de l'année + matrice coef | (page future) |
| `GET /api/v1/classes` | Liste plate des classes (filtrable par année, niveau, cycle) | `/admin/classes` |
| `GET /api/v1/classes/:id` | Détail classe : hiérarchie + élèves inscrits + matières+coef effectifs | `/admin/classes/[id]` |
| `GET /api/v1/students/:id` | Élève + ses inscriptions (avec breadcrumb cycle/niveau/classe) + ses guardianships | `/admin/students/[id]` |
| `GET /api/v1/enrollments/roster/:classSectionId` | Roster simple d'une classe (alternative bas-niveau) | portail prof (Phase 4) |
| `GET /api/v1/subjects` + `GET /api/v1/subjects/coefficient-matrix` | Matrice des coefficients par (matière × niveau) | `/admin/subjects` |

## Workflow type — Inscription d'un nouvel élève

1. **Création** depuis `/admin/students/new` ou import CSV → l'élève existe dans l'école mais n'est pas inscrit.
2. **Inscription** depuis sa fiche → onglet « Inscriptions » → choisir une classe parmi celles de l'année active.
   - L'API vérifie : capacité non dépassée, pas déjà inscrit la même année, classe non fermée, année non archivée.
3. **Affichage** : sur la fiche élève + la liste élèves + la liste classes, on voit le breadcrumb **Cycle → Niveau → Classe** systématiquement.

## Workflow type — Transfert entre classes

1. Depuis la fiche élève → onglet « Inscriptions » → bouton « Transférer » sur l'inscription active.
2. Choisir une classe cible **de la même année scolaire**.
3. L'API ouvre une transaction : ferme l'ancienne (`status='transferred_out'`, `endReason`) + crée la nouvelle (`status='active'`).

## Comment l'UI rend tout cela visible

- **Dashboard admin** → carte « Structure école » qui pointe vers `/admin/school/structure` (vue arbre globale).
- **`/admin/school/structure`** → tree School → Cycles → Niveaux → Classes avec compteurs (élèves inscrits / capacité, taux de remplissage en couleur).
- **`/admin/classes`** → cards regroupées par **Cycle**, puis par **Niveau**, chaque card affiche enrollments/maxStudents + barre de remplissage.
- **`/admin/classes/[id]`** → page détail qui montre le breadcrumb cycle/niveau/classe, le roster d'élèves cliquables, la liste des matières applicables avec leur coefficient effectif.
- **`/admin/students/[id]`** → header montre le breadcrumb actif (Cycle X · Niveau Y · Classe Z), onglet « Inscriptions » liste l'historique avec contexte cycle/niveau pour chaque enrollment.

## Ce qui n'est pas (encore) géré

| À venir | Phase |
|---|---|
| Affectation Professeur ↔ Classe ↔ Matière (TeachingAssignment) | 4 |
| Évaluations, notes, publication | 4 |
| Cahier de texte | 5 |
| Présences | 5 |
| Communications école → parents | 5 |
