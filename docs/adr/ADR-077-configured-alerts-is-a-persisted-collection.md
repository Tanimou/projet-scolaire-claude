# ADR-077 — « Alertes configurées » est une collection PERSISTÉE, pas une constante

- **Statut :** accepté
- **Date :** 2026-08-27
- **Tranche :** `S-E03-6` (V3-E03, L0)
- **Constatations :** `PF-20` (fermée), `PF-378` (fermée), `PF-346` (forme reproduite, corrigée ici), `PF-63` (fermée en passant), `PF-398` (ouverte — enregistrée, non corrigée)
- **Remplace / prolonge :** `ADR-071` (`read()` + `ReadErrorState`), `ADR-075` (discipline du `total` servi)

---

## Contexte — deux nombres corrects qui comptaient deux choses

`PF-20` était enregistrée comme « le tableau de bord contredit la file / les règles », et sa
moitié « demandes » a été fermée par `S-E03-5`. La moitié « alertes » se lisait, à l'écran,
**« 4 alertes configurées » sur `/admin/dashboard` en face de « 0 règle activée » sur
`/admin/alerts`**.

La mesure du 2026-08-27 a trouvé non pas un mauvais `count`, mais **l'absence de tout `count`** :

```ts
configuredAlerts: {
  label: 'Alertes configurées',
  value: AnalyticsService.DEFAULT_ALERT_RULES.length,   // ← la longueur d'une constante privée
}
```

Deux conséquences, et la seconde n'avait été vue par personne :

1. **Aucune lecture de la base ne pouvait contredire ce nombre.** Il ne consultait jamais les
   données. Il n'était donc ni juste ni faux : il était **hors sujet**. C'est le moteur réel du
   désaccord — `/admin/alerts` comptait les règles *activées*, et `AlertRule.enabled` vaut
   `@default(false)`, donc `0` sur un établissement neuf.

2. **La constante était une seconde liste du catalogue, et elle avait déjà dérivé.** Le catalogue
   canonique porte **huit** codes (enum `AlertRuleCode`) ; la copie de `analytics.service.ts` en
   portait **quatre**. `REPEATED_FAILURE`, `MISSING_ASSESSMENT`, `TEACHER_COMMENT_FLAG` et
   `IMPROVEMENT` manquaient. Le tableau de bord n'affichait donc pas seulement un nombre
   invérifiable : il affichait un nombre **faux**, et rien dans le code ne pouvait le signaler,
   puisque les deux listes ne se rencontraient nulle part.

Le docblock de la constante disait *« until R6 introduces the `AlertRule` model »*. **R6 l'a
introduit.** Le substitut a survécu à sa propre date de péremption — la façon dont ces constantes
meurent : personne ne relit une note qui a déjà été vraie.

---

## D1 — « configurées » désigne les règles ACTIVÉES dans cette école

**La question n'était pas technique.** « Configurées » peut vouloir dire *« combien de règles le
produit connaît »* (une constante) ou *« combien cet établissement en a activées »* (une collection
persistée). Les deux lectures sont défendables ; ce qui ne l'est pas, c'est de laisser deux écrans
en choisir une chacun sans le dire.

**Le schéma tranche.** `model AlertRule` existe, porte `enabled Boolean @default(false)`, est scopé
`@@unique([tenantId, schoolId, code])`, et `/admin/alerts` compte déjà `rules.filter(r => r.enabled)`
sous l'étiquette « Règles activées ». La population persistée est donc celle que l'utilisateur
manipule ; c'est elle que le KPI doit compter.

**Conséquence assumée : le nombre CHANGE de valeur.** Un établissement qui n'a activé aucune règle
passe de « 4 » à « 0 ». Ce n'est pas une régression, c'est la correction : « 4 » ne décrivait rien.

**Et la portée est ÉTIQUETÉE** (`ALERT_RULES_SCOPE_LABEL.enabled`, rendu par `KpiCard`), parce que
deux nombres honnêtes qui comptent des populations différentes se contredisent encore tant qu'aucun
ne dit ce qu'il compte — c'est `ADR-041 §D3` et `ADR-075 §D2`, appliqués une fois de plus.

---

## D2 — la dérivation est UNE, et le catalogue n'est plus tenu à la main

`alert-rule-population.ts` déclare la portée (`alertRuleScopeWhere`), le prédicat
(`enabledAlertRuleWhere`) et **la** dérivation (`countEnabledAlertRules`). `ensureRules`,
`listRules` et le KPI partagent désormais la même clause, ce qui est la seule raison pour laquelle
ils ne peuvent plus se contredire.

Le `?? null` sur `schoolId` n'est pas une coquetterie : `@@unique` traite `null` comme une valeur.
Écrire les lignes avec `null` puis les compter sans filtre rendrait deux nombres différents pour la
même école — le défaut d'origine, réintroduit par une autre porte.

**Le catalogue jugé est DÉRIVÉ de l'enum Prisma** (`Object.values($Enums.AlertRuleCode)`), jamais
recopié. Écrire les huit codes dans le cliquet créerait une troisième liste à tenir à la main, dans
le fichier même qui interdit la deuxième.

### L'invariant qui autorise une lecture à ne rien écrire

`ensureRules` matérialise les huit lignes **à la première ouverture** de `/admin/alerts`. Un tenant
qui n'a jamais ouvert la page n'a donc **aucune** ligne `alert_rule`. Compter les règles activées
reste pourtant correct dans les deux états — **par construction, pas par chance** : une règle non
matérialisée n'est pas activée, et une règle matérialisée l'est encore moins (défaut `false`). Les
deux mondes répondent `0`.

C'est pour cela que `countEnabledAlertRules` **ne matérialise rien** : une projection de lecture qui
écrirait pour pouvoir compter serait un effet de bord sur un `GET`. L'invariant est gelé par
`alert-rule-population.spec.ts`.

---

## D3 — la page cesse de confondre « vide » et « cassé », et de rendre un échantillon comme un total

Trois défauts sur `admin/alerts/page.tsx`, tous de la même famille :

1. **`safe()` local.** Les cinq lectures retombaient sur `?? []`, si bien qu'un 403, un 404 ou un
   500 devenait l'ensemble vide, rendu deux écrans plus bas en **« Aucune règle configurée »** — une
   panne présentée à l'administrateur comme un fait sur son établissement. C'est `PF-346` mot pour
   mot. Remplacé par `read()` + `ReadErrorState` (`ADR-071`), avec une **voie d'échec qui ne rend
   aucun chiffre**.

   Les six lectures sont traitées **ensemble** : les quatre KPI se lisent côte à côte sur une seule
   grille, donc en rendre trois et remplacer le quatrième par `0` fabriquerait le désaccord
   numérique de `PF-20` *à l'intérieur d'un même écran*.

2. **`highOpen` comptait une page `limit=100`** deux lignes sous un `openCount` qui utilisait déjà le
   `total` servi. Dès la 101ᵉ alerte ouverte, la même carte affichait un total exact au-dessus d'un
   échantillon présenté comme un décompte. Un filtre `severity` a été ajouté à
   `GET /alerts/instances` — **dérivé de l'enum Prisma**, pour ne pas créer ici la liste jumelle que
   cet ADR condamne — et la page lit `?status=open&severity=high&limit=1`, dont seul le `total` est
   utilisé.

3. **Le compte des « ignorées »** avait le même défaut ; il lit maintenant `dismissedResp.data.total`.

---

## D4 — le cliquet juge du CODE, pas de la prose

`alert-rule-catalogue-gate.spec.ts` **retire les commentaires avant de juger**. Sans cela, la
première prose qui *explique* le défaut — y compris celle laissée au-dessus du KPI corrigé, qui cite
la constante pour dire qu'elle est partie — devient un contrevenant. Un cliquet qui rougit sur sa
propre explication se fait relâcher dans le mois, et il se fait relâcher **pour une bonne raison**,
ce qui est la pire façon de perdre une règle.

Le retrait est volontairement grossier : il n'a pas à comprendre TypeScript, seulement à ne pas
juger de la prose. Son erreur possible est le faux **négatif** (une chaîne contenant `//` masque sa
fin de ligne), jamais le faux positif — et un contrôle positif prouve que la règle voit encore.

---

## Ce que cette tranche NE ferme pas — `PF-398`, énoncé plutôt que découvert plus tard

En s'exécutant sur tout le dépôt, le cliquet a mesuré **dix** endroits qui énumèrent le catalogue à
la main. Trois sont des foyers légitimes. **Sept sont sous `apps/web/src/`** et récrivent la liste en
union de littéraux, sans aucun lien de compilation avec l'énum, alors que `ALERT_RULE_CODE` existe
dans `@pilotage/contracts` et que le web l'importe déjà ailleurs :

`app/admin/alerts/actions.ts`, `app/parent/recommendations/{types.ts,page.tsx,RecommendationsFilters.tsx,alert-next-steps.ts}`,
`components/meeting-requests/{types.ts,MeetingRequestList.tsx}`, plus deux pages parent à trois codes.

Un neuvième code ajouté à l'énum laisserait ces fichiers **verts et faux** — exactement l'état où
`DEFAULT_ALERT_RULES` a vécu jusqu'à aujourd'hui. `R-A` s'arrête donc avant `apps/web`, **et la
restriction est écrite dans le cliquet plutôt que réalisée en silence** : une portée rétrécie sans
trace se relit plus tard comme « tout est couvert ». Un test dédié *mesure* la dette web et la
chiffre, pour qu'elle ne puisse pas se lire comme « rien à signaler ».

`PF-398` porte la conversion. Elle n'est pas faite ici : sept fichiers web sont une tranche à part
entière, et la faire maintenant gonflerait une tranche qui ferme une constatation de feuille de
route en une réécriture transverse.

---

## `PF-63`, fermée en passant, et pourquoi c'était en portée

Les quatre nouveaux tests de comportement appellent `adminDashboard`, qui échouait déjà pour une
**autre** raison : sept tests étaient au baseline (`known-test-failures.json`) sur
`Cannot read properties of undefined (reading 'getTime')`, avec `V3-E03` désigné propriétaire.

La cause était dans la **fixture**, pas dans le service : le mock servait une seule forme de ligne à
deux lectures différentes du même délégué — la structure d'école lit des sections complètes, la
sparkline émet `select: { createdAt: true }` puis trie sur `createdAt.getTime()`. On discrimine
maintenant sur la **forme de l'argument**, jamais sur un compteur d'appels, comme le délégué
`academicYear` voisin le faisait déjà.

Ce n'est pas un élargissement de portée opportuniste : sans ce correctif, **l'évidence de `PF-20`
était inexécutable**. Les sept entrées ont été retirées du baseline — le cliquet ne tourne que dans
un sens, et une entrée qui passe doit disparaître, pas rester.

---

## Conséquences

- Le KPI « Alertes configurées » **change de valeur** sur tout établissement n'ayant pas activé ses
  règles : `4` → `0`. Plus petit, et vrai.
- `GET /api/v1/alerts/instances` accepte `severity` (`low|medium|high`), validé par `ParseEnumPipe` —
  une valeur inconnue est un `400`, jamais un filtre silencieusement absent (`ADR-067 §D3`).
- `/admin/alerts` rend un état d'erreur explicite au lieu de chiffres à zéro quand une lecture échoue.
- Toute réintroduction d'un catalogue codé en dur côté API/worker/packages est un rouge.
