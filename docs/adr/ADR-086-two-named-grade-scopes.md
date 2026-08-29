# ADR-086 — Les deux projections « les notes de cet enfant » sont DEUX PORTÉES NOMMÉES, pas une à unifier

- **Statut :** accepté
- **Date :** 2026-08-29 (run 102, `S-E03-3`)
- **Épique :** `V3-E03` — vérité canonique et contrats de requête
- **Findings :** `PF-05` *(avancée — résidu (i) DÉCHARGÉ par mesure, résidu (ii) avancé)* ·
  `PF-471`, `PF-472` *(relevées)*
- **Palier de preuve : B** — refactor à sémantique constante sur deux sites de lecture, prouvé
  RED-avant/GREEN-après par une spec qui lit la production. Pas de cliquet : voir §5, la fermeture
  est réclamée comme DEUX SITES, pas comme une classe.

## 1. Le contexte, et la prémisse qui était fausse

`S-E03-2 / AC-5` (run 81) devait adopter un `where` canonique — `published-grades.where.ts` — aux deux
projections du portail parent. Il a pris sa **branche STOP** : le `where` n'a pu être adopté ni à A ni à
B, donc il n'a été livré **nulle part**, et la divergence est restée épinglée dans une spec sans jamais
être traitée.

La raison de cet échec n'était pas un manque de temps. **La prémisse était fausse.** Un `where` unique ne
pouvait pas servir les deux, parce que les deux répondent à deux questions différentes :

| | A — le jeu de NOTATION | B — le RELEVÉ |
|---|---|---|
| Code | `AnalyticsService.parentDashboard` | `GradesController.studentGrades` |
| Sert | `/parent/dashboard`, `/parent/subjects`, `/parent/children/[id]/report`, `/admin/students/[id]` | `/parent/grades`, `/parent/documents` |
| Fait | calcule des moyennes | liste des lignes |
| Absences | **écarte** (une absence n'a pas de valeur) | **garde** |
| Année | **fenêtre** sur l'année de reporting | **toutes** |

**L'axe (b) tranché par le code appelant, pas par une opinion.** `/parent/grades` affiche aux absences un
badge « Abs » (`apps/web/src/app/parent/grades/GradeRow.tsx:87`) et offre un filtre
`performance === 'absent'` (`page.tsx:321`). Les écarter « pour faire converger » aurait **supprimé une
fonctionnalité vivante**. C'est le contrôle qui manquait au run 81 : la convergence était traitée comme
un but en soi, sans lire ce que la page fait des lignes.

## 2. La décision

**Ne pas unifier. NOMMER, DÉRIVER, et DÉCLARER la différence.**

`packages/contracts/src/grades/published-grades-where.ts` exporte deux constructeurs — `scoringWindowGradesWhere`
(A) et `gradeRecordWhere` (B) — et **une** constante `PUBLISHED_GRADE_STATUSES`. Les deux sites de
production les appellent au lieu de recopier des littéraux.

Ce que cela change, exactement : **rien du comportement**, et **tout de la dérive**. Avant, deux littéraux
vivaient à deux endroits et pouvaient s'éloigner l'un de l'autre sans que rien ne rougisse — `DNC-01`, la
divergence KPI/registre, dans sa forme la plus banale. Après, l'unique axe où les deux **doivent**
s'accorder (le statut) vient d'une seule constante, et les deux axes où elles diffèrent **légitimement**
sont énumérés dans le module, avec la raison produit de chacun.

**Le module n'affirme donc pas que la divergence a disparu.** Il la rend **déclarée au lieu
qu'accidentelle**. Une tranche future qui voudrait vraiment la supprimer devra le faire contre une
description écrite de ce qu'elle casse.

## 3. Deux fail-open rendus INEXPRIMABLES au passage

1. **`academicYearId` est REQUIS** sur A, jamais optionnel. Un `academicYearId?` aurait permis d'exprimer
   « le jeu de notation, toutes années confondues » — le jeu de personne, et une cinquième projection.
   C'est la forme d'`ADR-065 §D5` : un paramètre optionnel qui **élargit** la requête quand il manque.
2. **Les deux spreads conditionnels de B sont partis.** `...(termId ? … : {})` et `...(seePrivate ? {} : …)`
   sont remplacés par des paramètres explicites. Le défaut de `includeUnpublished` est le **plus
   restrictif** : un appelant qui oublie le drapeau obtient la vue famille, jamais la vue privée.

`tenantId` et `studentId` sont validés non vides, comme `candidateEnrollmentWhere` le fait déjà — la règle
du dossier d'accueil, pas un idiome de plus.

## 4. La preuve, et son axe faible dit franchement

- **RED-avant / GREEN-après, exécuté dans les deux sens.** `49/49` vert sur l'arbre corrigé. Puis une
  dérive d'UNE ligne injectée dans `gradeRecordWhere` (`where.isAbsent = false`) : **6 échecs**, dont
  `parent-grade-projection-agreement.spec.ts`, qui capture les clauses **depuis la production** en
  exécutant le vrai code au-dessus d'un double Prisma. C'est le contrôle qui compte : il prouve que la
  spec voit le site de production, pas une copie.
- **Régression :** `188/188` sur `modules/grades` + `modules/analytics`. `pnpm typecheck` **13/13**.
- **Axe faible, nommé :** aucun test d'intégration ne distingue A de B, et il ne le peut pas — voir §5.
  L'équivalence est donc prouvée au niveau du `where`, pas au niveau d'une réponse HTTP.

## 5. Le résidu (i) de `PF-05` est DÉCHARGÉ — par une mesure, et la réponse n'est pas celle attendue

Le registre portait depuis quatre runs : *« la divergence de comptage A/B est **non démontrée sur la
seed** »*. Trois runs l'ont héritée sans la lever. Elle est levée ici, et **la raison pour laquelle
personne n'y arrivait est que c'est impossible** :

`scripts/parent-grade-projection-divergence-probe.sql`, exécutée contre le conteneur
(`docker exec pilotage_postgres`, `database=pilotage`), mesure sur **420 notes réelles** :

```
students_with_grades | total_b | total_a | axis_absent | axis_year | students_diverging
                 420 |     420 |     420 |           0 |         0 |                  0
```

**Zéro divergence — parce que la seed est DÉGÉNÉRÉE.** 420 notes pour **420 élèves distincts**, soit
**exactement une note par élève** ; **zéro** absence ; **zéro** `draft` ; **une seule** année scolaire pour
la totalité des 2463 inscriptions et des 16 évaluations. Les quatre axes de divergence sont
**structurellement inexerçables** par cette fixture.

**Un zéro rendu par un instrument incapable de mesurer autre chose ne vaut rien**, donc le contrôle
négatif : `…-control.sql` injecte, dans une transaction, une absence et une note d'une autre année, puis
re-mesure avec **la même arithmétique** et annule. Les compteurs bougent —
`b=3, a=1, axe_absence=1, axe_année=1` — et l'état après `ROLLBACK` est vérifié identique (420 notes, 0
absence). **La sonde discrimine ; le zéro est un fait sur la SEED, pas sur l'instrument.**

Le résidu est donc déchargé dans sa forme honnête : *la divergence est réelle dans le code, et aucune
donnée locale ne peut l'exhiber*. C'est enregistré comme **`PF-471`**, parce que c'est un fait sur la
capacité de preuve de tout l'épique `V3-E03`, pas sur cette tranche.

## 6. Ce qui n'a PAS été fait

- **Aucune reconstruction d'image.** Disque hôte à **7,9 Go libres** ; un build en consomme ~3 et la
  consigne durable est de ne pas descendre sous ~5 Go. Les sondes tournent donc en SQL pur via
  `docker exec` contre l'image en place : elles interrogent **la base**, pas le code applicatif modifié —
  c'est précisément pourquoi l'équivalence est portée par jest. La pile est laissée **debout et saine**,
  comme trouvée.
- **Aucun cliquet.** La fermeture est réclamée comme **deux sites nommés**, pas comme une classe : il
  existe d'autres lectures de notes ailleurs (enseignant, élève, gradebook) que cette tranche ne touche
  pas et ne prétend pas avoir canonicalisées. Un cliquet aurait affirmé une portée que la tranche n'a pas.
  Palier B, clause 2 de la table des paliers.
- **`PF-05` n'est PAS fermée.** Le résidu (ii) — « six projections restent six » — est **avancé** (les deux
  du portail parent sont désormais dérivées d'un contrat) et non levé : `PF-337` et `PF-338` restent
  ouvertes.
