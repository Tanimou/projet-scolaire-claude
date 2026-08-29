# ADR-088 — L'axe d'année des affectations ferme comme une CLASSE, et il est mesuré sur la pile qui tourne

- **Statut :** accepté
- **Date :** 2026-08-29
- **Tranche :** `S-E03-14` (run 104)
- **Findings :** `PF-36` (avancée), `PF-474` (portée précisée), `PF-476` … `PF-478` (levées)
- **Succède à :** `ADR-087` (`S-E03-13`, run 103), qu'il ne contredit pas mais dont il corrige le MODE DE PREUVE
- **Gates :** `G-TRUTH`, `G-PORTAL`, `G-TENANT` (assis, non modifié), `G-DNC`
- **Palier de preuve :** **B** — projection de lecture, aucun changement de code de réponse ni de permission. Le
  cliquet est néanmoins livré, parce que la tranche revendique une fermeture de **CLASSE** et non de site
  (Step 5, règle 2).

---

## 1. Le contexte, et le défaut de la tranche précédente

`ADR-087` a converti **huit** lectures d'affectations de l'axe **COLONNE**
(`teaching_assignment.academic_year_id`) vers l'axe **SECTION** (`class_section.academic_year_id`), et a prouvé
chacune par un test *behavioural* nommant son endpoint. Huit tests, huit sites, **énumérés à la main**.

Une **neuvième** lecture existait : `analytics.service.ts` → `teacherReports` → `GET /analytics/teacher-reports`,
la page « Rapports » du portail enseignant. Elle portait encore le littéral d'axe colonne
`...(academicYearId ? { academicYearId } : {})`.

**Ce n'est pas une étourderie, et la nommer ainsi ferait rater la leçon.** C'est le mode de défaillance déjà
enregistré au run 59 — *« deux listes à la main = dérive silencieuse »* : **une suite qui énumère des sites ne peut
pas, par construction, échouer sur le site qu'elle a omis.** Elle était verte, à 100 %, sur un arbre où le défaut
qu'elle décrit était vivant. Le remède n'est pas plus de vigilance ; c'est de **dériver** l'ensemble des sites
depuis les sources.

## 2. La conséquence était observable, et elle a été OBSERVÉE

Les deux axes peuvent diverger : il n'existe aucune clé étrangère composite
`(class_section_id, academic_year_id)` — `PF-473`, mesuré au run 103 et re-vérifié ici par exécution.

`scripts/teacher-year-axis-agreement-probe.js` installe une affectation dont la colonne contredit sa propre
section, mint de vrais jetons Keycloak et interroge l'API. **Avant la conversion**, `/teachers/me/assignments`
(axe section) et `/analytics/teacher-reports` (axe colonne) rendaient des **ensembles de classes différents** au
même enseignant. Deux surfaces d'un même portail en désaccord sur *« quelles classes j'enseigne cette année »* :
la forme exacte de `PF-36`.

## 3. La décision

### D1 — La neuvième lecture passe par le foyer canonique

`assignmentYearScopeWhere(academicYearId)` — inchangé, non élargi. Le mur de tenant et celui de l'enseignant sont
**assis par un test**, pas espérés : une conversion d'axe qui perdrait `tenantId` échangerait un défaut de vérité
contre une fuite de tenant.

### D2 — La liste tenue à la main est remplacée par un cliquet DÉRIVÉ

`apps/api/src/shared/quality/assignment-year-axis-derivation-gate.spec.ts` parcourt `apps/api`, `apps/worker` et
tous les `packages/*/src`, parse chaque source en AST et classe **toutes** les lectures `teachingAssignment`.

- **R1 — tolérance zéro.** Une lecture dont le `where` nomme `teacherProfileId` ne peut pas poser l'année sur la
  colonne. C'est la famille que `PF-36` gouverne.
- **R2 — plafond décroissant.** Le reste de la classe : les lectures appariées à une **inscription**.

**Le classifieur suit les spreads, et ce n'est pas un raffinement.** La forme qui a survécu à `S-E03-13` est un
spread *conditionnel*. Un classifieur ne regardant que les propriétés écrites en clair serait passé à côté du
site même qu'il existe pour attraper — et serait sorti **vert**.

### D3 — R2 est un plafond parce que la conversion franchirait une frontière d'autorisation

Les six sites R2 ne sont pas des affichages : ce sont des **gardes d'appartenance** (messagerie, remédiation,
alertes, drain de snapshots). Ils décident si un enseignant peut écrire à un parent ou proposer une remédiation.
Les convertir change la population d'un mur d'autorisation — une modification d'**AUTHZ déguisée en correction de
comptage**. C'est exactement ce que `class-roster-size-derivation-gate.spec.ts` refuse de faire pour
`student-access.service.ts`, et pour la même raison. Ils sont **comptés, jamais exemptés**.

### D4 — Le plafond est un plafond, jamais un plancher

Leçon du run 95. Un cliquet ne doit pas épingler un plancher sur une classe que la feuille de route fait
**rétrécir** : la tranche qui traiterait `PF-474` serait punie pour avoir fait ce qu'il fallait. L'anti-vacuité
est donc portée par des **fixtures synthétiques** que le classifieur doit reconnaître — jamais par un comptage de
sites de production.

### D5 — Le plafond a été MESURÉ, et le premier chiffre était faux

Le premier jet portait `R2_CEILING = 14`, repris de la prose de `PF-474` et **jamais confronté à l'arbre**. Forcer
le plafond à `0` et lire la liste imprimée donne **6** sites réels. Un plafond au-dessus de la population aurait
laissé passer **huit récidives en silence** : un cliquet décoratif. **Un plafond se mesure, il ne se devine pas.**

Les six : `alerts.service.ts:771` et `:787`, `messaging.service.ts:108` et `:166`,
`remediation.service.ts:931`, `snapshot-drain-cron.service.ts:1011`.

## 4. La portée du cliquet, déclarée plutôt que sous-entendue

Le classifieur ne lit que le `where` de **premier niveau**. Les filtres d'affectation **nichés** dans une relation
(`assessment: { teachingAssignment: { academicYearId } }`) lui échappent **par construction**. `PF-474` en
dénombre ~15 au total ; ce plafond en gouverne **6**. La différence n'est pas une exemption, c'est une **portée** —
écrite pour que personne ne lise « 6 » comme « il n'en reste que 6 ». Levée en `PF-477`.

## 5. Ce qui a été EXÉCUTÉ, et ce qui ne l'a pas été

**Exécuté :**

- le **contrôle ROUGE du cliquet** contre la vraie source d'avant-correctif, restaurée depuis l'index git : R1
  nomme **exactement** `analytics.service.ts:4199 (findMany)`, et rien d'autre. Le cliquet discrimine ;
- le **contrôle ROUGE de la spec behavioural**, même méthode, même restauration ;
- le **contrôle de divergence en base**, `BEGIN … ROLLBACK` contre le Postgres du conteneur : injecter un élève
  dans une seconde section du même enseignant fait diverger cumul et distinct, **58 contre 57** — le mécanisme
  « 46 vs 43 » de l'audit, reproduit ;
- la **mesure de la graine** : les quatre dérivations s'accordent aujourd'hui (57/57/57/57) et les 2463
  inscriptions sont **toutes** `active`.

**Le fait le plus important de ce run, et il est désagréable :** l'image `pilotage-scolaire-api` qui tournait
datait du **2026-08-25**, soit **quatre jours avant** la fusion de `S-E03-13` (2026-08-29 19:18). Toute lecture
« live » prise contre elle mesurait du code périmé — et la première passe de la sonde l'a révélé en rendant un
résultat que ni l'ancien ni le nouveau code n'expliquait. **`landed: true` n'est pas `deployed: true` ;
l'âge de l'image est une donnée de la preuve, pas un détail d'intendance.** Levé en `PF-476`.

## 6. Ce que cette tranche ne prouve pas

- Elle ne rend pas la dérive **inexprimable en base** : c'est la clé étrangère composite `PF-473`, sa propre
  migration `G-MIGRATION`, non posée.
- Elle ne re-mesure pas les valeurs 43/46/48 et 25/26 de l'audit **telles quelles** : la graine actuelle ne les
  contient pas, et fabriquer des nombres pour les faire coïncider serait une invention. Ce qui est établi, c'est
  que les surfaces **s'accordent sur une même fixture**, y compris sur la condition divergente.
- `PF-36` reste donc **`open`, avancée**, sur les axes `PF-473`, `PF-474` et l'asymétrie de portée d'année entre
  `getLoad` et `teacherDashboard` (`PF-413`).
