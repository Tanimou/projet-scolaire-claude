# ADR-075 — « quelles demandes de rattachement attendent une décision ? » est UNE dérivation, et sa portée est l'ÉCOLE

- **Statut :** Accepté
- **Date :** 2026-08-26
- **Story :** `S-E03-5` (run 86) — [`docs/spec/features/v3-e03/stories/S-E03-5.md`](../spec/features/v3-e03/stories/S-E03-5.md)
- **Findings :** `PF-373` CLOSED · `PF-20` **advanced, NON fermé** · `PF-371` avancé · `PF-377`..`PF-379` recorded
- **Épique :** `V3-E03` — Canonical truth and query contracts (L0)
- **Prédécesseurs :** `ADR-041 §D2/§D3/§D4` (une définition importée jamais re-dérivée ; le libellé est ce qui
  rend un nombre honnête), `ADR-065 §D5` (une clé de portée conditionnelle est un fail-open),
  `ADR-067` (validation d'entrée d'énum dérivée de la liste canonique), `ADR-071` (une lecture échouée n'est
  pas une affirmation de domaine), `ADR-074` (`link-liveness.ts` — les deux premières portées nommées)

---

## 1. Le contexte, mesuré et non hérité

`PF-20` (« dashboard vs queue/rule totals ») a deux moitiés. Cette tranche traite la première — celle des
demandes de rattachement — et **laisse la seconde ouverte en la nommant** (`PF-378`, §4).

### 1.1 Le défaut : la file ne lisait pas la population qu'elle prétendait lire

Mesuré en source le 2026-08-26 :

| Surface | Ce qu'elle demandait au serveur | Ce que le serveur rendait |
|---|---|---|
| KPI « Demandes en attente » (`analytics.service.ts`) | `guardianship.count({ tenantId, status: 'pending' })` — **tenant entier** | un nombre |
| `/admin/enrollments` (la file où le CTA « Examiner » atterrit) | `GET /api/v1/guardians` | des lignes **`Guardian`** |

`Guardian` n'a **ni `status` ni `notes`**. La page déclarait pourtant à la main une forme de `Guardianship`,
et `api<T>()` castant sans valider, ses cinq onglets comparaient `undefined` à un littéral d'état. **Toujours
faux, pour tout tenant, depuis l'écriture de la page.** L'admin lisait « 28 en attente », cliquait, et
atterrissait sur *« Aucune demande dans cet onglet »* — une phrase qui n'est pas un zéro mais une
**explication** de zéro. C'est la moitié « 28 pending vs empty queue » de `PF-20`, et elle est structurelle.

Trois défauts secondaires vivaient sur le même chemin :

- `enrollments/page.tsx` envoyait `includePending=true` à un endpoint qui **ne déclare pas ce paramètre**
  (`guardians.controller.ts:93-99`) : accepté en silence, jamais lu, jamais refusé → enregistré en `PF-379`.
- La page dérivait ses cinq badges d'onglets d'un `.length` de page tronquée.
- Son `safe()` local écrasait `null` et `[]` en un seul état : un 403/404/500 se rendait en « Aucune
  demande » — la forme de `PF-346`, sur la page même que cette tranche répare.

### 1.2 `PF-373` : le substitut était pratiqué à trois endroits et avoué à un seul

`EnrollmentRequest` **n'existe pas** dans `schema.prisma`. Le produit compte les `Guardianship` en attente
comme substitut d'une « demande d'inscription ». Cet aveu vivait en commentaire au-dessus d'**un** des trois
sites (`analytics.service.ts:2471`) ; les deux autres l'appliquaient sans le dire, et la courbe `sparkline`
sous le KPI en pratiquait une **quatrième** variante.

### 1.3 La courbe et le nombre au-dessus d'elle ne posaient pas la même question

`sparkline()` acceptait `schoolId?` **optionnel** et posait ses clés de portée par quatre spreads
`...(schoolId ? { … } : {})`. Trois de ses quatre branches appliquaient l'axe école ; **la branche
`guardianship` le jetait purement et simplement**, derrière deux casts `as never`. Le nombre affiché était
tenant-wide, la courbe dessinée sous lui l'était aussi mais pour une autre raison, et rien ne le disait :
`PF-20` en miniature, sous le nombre même que cette tranche répare.

---

## 2. La décision

### D1 — Un endpoint DÉDIÉ qui rend des lignes `Guardianship`, et non un aplatissement de `GET /guardians`

**Retenu :** `GET /api/v1/guardians/guardianships/pending-requests`
(`guardians.controller.ts:344`), rendant `{ data, total, totalsByStatus, page, pageSize, guardianshipScope }`.

C'est une **nouvelle forme de réponse**, donc une décision d'architecture, donc cet ADR. Les deux voies
rejetées le sont **par mesure, pas par coût** :

**(a) Aplatir la relation `guardianships[]` de `GET /guardians`.** Depuis `ADR-074`, cette relation est
filtrée par `guardianshipOnTheBooksWhere()` (`guardians.controller.ts:126`) : les liens `revoked` en sont
**exclus par le serveur**. L'onglet « Rejetées » resterait donc **structurellement vide après le fix** —
`DNC-06` déplacé d'un onglet sur cinq au lieu d'être retiré. Son `include` du `student` ne sélectionne pas
`enrollments`, donc la colonne « Classe souhaitée » resterait `—` sur toutes les lignes. Et son plafond de
**200 guardians** ne borne pas le nombre de *demandes* : le comptage resterait client, et l'accord
KPI ↔ file serait **impossible par construction** — or c'est exactement ce que `G-TRUTH` exige de démontrer.

**(b) Réutiliser `GET /guardians/guardianships/list`.** Son `where` est tenant-wide, **sans axe école** : la
file d'une école deviendrait celle du tenant entier — une régression de portée dans la tranche même qui
corrige une portée. Il n'a pas de `take`. Et il est gardé par `guardianships.read`, code que
`permissions.constants.ts:226`/`:260` accordent à `teacher` **et** à `parent`.

**Pourquoi `totalsByStatus` fait partie de la décision et non du confort :** des badges d'onglets comptant
une page tronquée sous un KPI comptant la base remplaceraient « 28 vs 0 » par « 28 vs 19 », c'est-à-dire une
contradiction **plus difficile à voir**. Le `groupBy` serveur est ce qui rend l'accord vérifiable, pas
seulement plausible.

**Pas de collision de routage :** `@Get(':id')` ne matche qu'un segment, et `guardianships/list` coexiste
déjà sous le même préfixe à deux segments.

### D2 — La portée est l'ÉCOLE, sur l'axe `student.schoolId`, et le KPI CHANGE DE VALEUR

Le KPI, l'aperçu du centre d'action, la courbe et la file sortent tous de
`guardianshipPendingRequestWhere({ tenantId, schoolId })`
(`packages/contracts/src/guardianship/link-liveness.ts` §2.7.4) : **la même portée des deux côtés, en un seul
appel**, pour qu'aucun site ne puisse en épeler la moitié.

**Pourquoi l'école plutôt que le tenant.** `adminDashboard({ tenantId, schoolId })` est un tableau de bord
*par école* ; ses six autres KPI le sont. « Demandes en attente » était **le seul des sept** à ne pas l'être :
un septième dénominateur sur la même grille de cartes. Un admin dont le contexte est l'école A ne doit pas se
voir annoncer les demandes de l'école B, puis atterrir sur une file qui ne les contient pas — ce serait
`PF-20` **reconstruit par le correctif**.

**Pourquoi `student.schoolId` plutôt que `guardian.schoolId`.** `Guardianship` ne porte pas de `schoolId`
propre (`schema.prisma:567-593`) ; les deux axes disponibles sont ceux de ses relations, et ils **peuvent
diverger** — `createGuardianship` refuse la création quand ils ne sont pas égaux, mais c'est un contrôle **à
l'écriture seulement** : rien n'empêche une mutation ultérieure de l'un des deux, ni une ligne importée
d'être déjà désalignée. Le choix n'est donc pas cosmétique.

C'est `student.schoolId` parce que : la décision que l'admin prend porte sur le rattachement d'un **enfant à
son établissement** ; `Student.schoolId` est l'axe de tous les autres KPI admin ; et `Guardian.schoolId` est
posé depuis le contexte de l'admin **créateur**, ce qui en fait un axe de *provenance*, pas de
*responsabilité*. **L'axe élève est l'invariant ; l'axe parent est un artefact de saisie.**

> **CONSÉQUENCE ASSUMÉE, ET C'EST LE POINT DE LA TRANCHE.** Le KPI « Demandes en attente » et sa courbe
> **changent de valeur pour tout tenant multi-écoles** : ils deviennent **plus petits**. Un opérateur qui
> compare le nombre d'avant-hier à celui d'aujourd'hui verra une baisse qui n'est pas une baisse d'activité.
> Ce n'est pas une régression : le nombre comptait une population que la file où son CTA envoie n'a jamais
> montrée. Pour un tenant mono-école, la valeur est inchangée.

**Les deux clés sont REQUISES** dans `GuardianshipPendingRequestScope` (`§2.7.2`). Un
`...(schoolId ? { student: { schoolId } } : {})` devient **inexprimable** (`TS2345`) plutôt que déconseillé :
Prisma laisse tomber une clé `undefined` en silence et la requête **s'élargit** — la forme fail-open
qu'`ADR-065 §D5` interdit, et celle qui a fait vivre ce défaut.

### D3 — `sparkline()` perd son `statusFilter` et gagne un `schoolId` REQUIS

Deux changements de signature sur `AnalyticsService.sparkline()` (`analytics.service.ts:3338`) :

1. **`schoolId: string` devient requis.** Il l'était déjà *en fait* : les neuf appelants le passent tous, et
   le typecheck le prouve. Le rendre requis est donc un no-op **prouvé** qui retire les quatre spreads
   conditionnels de portée.
2. **`statusFilter` est supprimé.** Un seul appelant le passait — la courbe des demandes en attente — et il
   bascule sur le prédicat canonique ; après conversion le paramètre avait **zéro appelant**. Le garder
   aurait été garder avec lui ses deux casts `as never`, par lesquels la perte silencieuse de `schoolId`
   dans la branche `guardianship` avait survécu à la relecture.

La branche `guardianship` dérive désormais de `guardianshipPendingRequestWhere()` : **la même jointure et le
même axe école que le nombre au-dessus d'elle.**

Le `catch` de `sparkline()` rend toujours une courbe plate sur lecture échouée — c'est la forme serveur de
`PF-346`, et **elle survit à cette tranche**, déclarée plutôt que découverte (§3). Ce qui change : elle cesse
d'être **silencieuse** (`logger.error` avec tenant, école et modèle). Sans cela, un `where` malformé rendrait
une courbe plate au lieu de rougir — le faux vert du run 81 sous une autre forme.

### D4 — La garde est `parents.read`, PAS `guardianships.read` : l'écart au brief, assumé

La story (`S-E03-5 §AC-2`) prescrivait `@RequiresPermission('guardianships.read')`. **Mesuré avant
d'écrire :** `permissions.constants.ts:226` accorde ce code à `teacher` et `:260` à `parent`. Or cette file
rend l'**email et le téléphone** de parents, plus des noms d'élèves. La poser sous ce code l'ouvrirait à deux
audiences qui ne l'ont pas aujourd'hui — c'est-à-dire **élargirait une autorisation** dans une tranche TIER B
qui n'a pas le droit d'en changer une.

`parents.read` est le code que porte **déjà** l'endpoint que cette file lit aujourd'hui
(`GET /guardians`, `:91`), il est admin-seul (`permissions.constants.ts:162`), et il gouverne déjà exactement
ces données. **La posture d'autorisation de la file est donc inchangée à la ligne près : personne ne gagne ni
ne perd l'accès.**

C'est un écart délibéré à un brief, tranché ici parce que c'est le seul endroit où un relecteur le verra.

### D5 — Le nombre porte sa portée, et c'est la vérification à l'œil nu

`GUARDIANSHIP_SCOPE_LABEL.awaitingDecision` (§2.6) est **la seule source** de la chaîne de portée. Elle est
rendue par le KPI (`analytics.service.ts:2899` via `KpiData.scope`), par la réponse de l'endpoint
(`guardians.controller.ts:434`, `guardianshipScope`) et par la carte de la file
(`enrollments/page.tsx`) — **importée, jamais recopiée**. `KpiData.scope` est additif et optionnel : un KPI
qui ne la déclare pas se rend exactement comme avant.

C'est `ADR-041 §D3` (« le libellé est ce qui rend un nombre honnête ») appliqué comme **mécanisme** : si deux
surfaces affichaient deux portées différentes, elles ne compteraient pas la même population et l'une des deux
mentirait — et cela se verrait sans outil. Une chaîne recopiée à la main aurait rendu la vérification fausse
au premier caractère près ; c'est la classe `PF-371`, et c'est pourquoi la page **importe la constante**.

### D6 — La section vit dans `link-liveness.ts`, PAS dans un cinquième module frère

`PF-365`/`PF-370` nomment déjà la prolifération de modules frères dans `packages/contracts` comme un défaut
ouvert dont la convergence est une décision d'`epic-spec`. La question « ce lien attend-il une décision
humaine ? » est une **troisième portée sur la même colonne** (`Guardianship.status`) que §2.2 et §2.3 : un
module séparé aurait ré-importé tout le vocabulaire de §2.1 pour n'ajouter qu'une quatrième liste à tenir en
face de la même énum Prisma.

La liste `GUARDIANSHIP_AWAITING_DECISION_STATUSES` est **positive** (`['pending']`), écrite en toutes lettres
et non dérivée par soustraction, pour la raison de `ADR-074 §D3` : un quatrième membre ajouté à
`GuardianshipStatus` ne doit pas entrer dans le KPI d'un directeur et dans sa file de travail par le seul
fait d'avoir été ajouté à une énum.

---

## 3. Ce que la tranche ne change PAS, énoncé plutôt que découvert

- **`GET /guardians` reste plafonné à 200 guardians** et `admin/guardians/page.tsx` continue de compter côté
  client → `PF-372`, dont le remède est une décision de forme de réponse sur une **autre** page.
- **Le `catch` de `sparkline()`** rend toujours trente points à zéro sur lecture échouée (§D3) — remède =
  un état d'indisponibilité porté jusqu'à la carte, donc un contrat de réponse, hors portée.
- **L'export CSV de la file ne porte que la page courante** : la lecture est paginée serveur et la page n'a
  pas les autres lignes. Le fichier **le dit** dans son en-tête (« N sur T »). Un CSV est durable et se
  partage ; le laisser affirmer implicitement l'exhaustivité aurait été la faute même du KPI.
- **La moitié « alertes » de `PF-20` est intacte** → `PF-378`. `PF-20` **avance et ne ferme pas**.
- **Les centres d'action non-admin** annoncent des `count` dérivés d'un `.length` borné → `PF-377`.
- **`GET /guardians` accepte des query params qu'il ne lit pas** → `PF-379`.

---

## 4. Les conséquences

**Positives.**
- Le KPI, la courbe, l'aperçu du centre d'action et la file **comptent littéralement la même population**,
  par le même constructeur — vérifié par un test d'accord (`pending-request-agreement.spec.ts`, T-1/T-2) et
  assis par un cliquet à sens unique (`guardianship-pending-request-derivation-gate.spec.ts`).
- `DNC-06` (« la file est structurellement vide ») est **retiré**, pas déplacé.
- Une lecture échouée sur `/admin/enrollments` rend `ReadErrorState`, jamais « Aucune demande » (`ADR-071`).
- Trois miroirs FE écrits à la main de `'pending' | 'active' | 'revoked'` disparaissent au profit de
  `GuardianshipLinkStatus` importé — `PF-371` avance.

**Négatives, assumées.**
- **Le KPI « Demandes en attente » change de valeur** pour les tenants multi-écoles (§D2). C'est le seul
  changement de comportement observable côté produit, et il est intentionnel.
- Une **nouvelle route** s'ajoute à la surface HTTP admin ; l'aggregate `/api/v1/analytics/*` reste la voie
  des *tableaux de bord*, cette route est celle d'une *file de travail paginée* — la distinction est
  celle qu'`GUARDRAILS §2` fait entre « dashboards read pre-aggregated » et une liste opérationnelle.
- `sparkline()` a une signature **plus stricte** : un appelant futur devra fournir `schoolId`. C'est le but.

---

## 5. Les alternatives écartées

| Alternative | Pourquoi non |
|---|---|
| Aplatir `guardianships[]` de `GET /guardians` | Ne peut pas satisfaire `G-TRUTH` : onglet « Rejetées » structurellement vide, « Classe souhaitée » vide, comptage client (§D1 (a)) |
| Réutiliser `guardianships/list` | Tenant-wide, sans `take`, gardé par un code accordé à `teacher` et `parent` (§D1 (b)) |
| Modéliser `EnrollmentRequest` | C'est une migration de schéma et une décision d'`epic-spec` ; la tranche aurait cessé d'être TIER B. Le substitut est désormais **avoué une seule fois, là où il est défini** (§1.2) |
| Porter la portée par `guardian.schoolId` | Axe de provenance, pas de responsabilité, et divergent du reste du tableau de bord (§D2) |
| Retirer l'onglet « Rejetées » | `GUARDRAILS §5` : jamais retirer une fonctionnalité qui marche. L'endpoint accepte `?status=` **dérivé** de `GUARDIANSHIP_LINK_STATUSES` (`ADR-067`), jamais un littéral d'URL passé à Prisma |
| Garder `statusFilter` sur `sparkline()` « au cas où » | Zéro appelant après conversion, et il transportait avec lui les deux casts `as never` qui masquaient la perte de `schoolId` (§D3) |
| Fermer `PF-20` | Interdit : la moitié « alertes » vit (`PF-378`), et un cliquet l'assied explicitement |

---

## Annexes — ce que la tranche a appris en se trompant

### A1 — Une chaîne de portée recopiée est une vérification qui ment

`§D5` fait de l'égalité de trois chaînes la preuve visuelle de l'accord de portée. La première écriture de la
page **recopiait** la chaîne à la main dans une constante locale — et la copie différait de l'original par
**une apostrophe** (`'` U+0027 contre `’` U+2019). Les trois surfaces affichaient donc des libellés
*différents* sous un docblock affirmant qu'ils étaient identiques : le mécanisme de vérification était le
premier à s'être cassé, en silence, avant même d'avoir servi. La page **importe** désormais
`GUARDIANSHIP_SCOPE_LABEL.awaitingDecision`. C'est `PF-371` observé sur la tranche qui prétendait le faire
reculer — et la raison pour laquelle `§D5` dit « importée, jamais recopiée » plutôt que « identique ».

### A2 — L'ADR d'une tranche n'est pas un sous-produit de la tranche

Ce document a été écrit **après** que dix-neuf sites de production l'eurent cité par numéro et par section
(`ADR-075 §D1`, `§D2`, `§D3`) alors qu'il n'existait pas. Chacune des trois décisions était argumentée — mais
**à l'intérieur du fichier qui la prenait**, donc invisible à quiconque ne lisait pas ce fichier, et
irrécupérable par la tranche suivante. Un docblock justifie une ligne ; il ne remplace pas une décision
d'architecture. `GUARDRAILS §2` traite cet écart comme bloquant, et c'était le bon appel.

### A3 — Un résidu se retourne, il ne se supprime pas

Le cliquet de `S-E03-3c` portait un test affirmant que `analytics.service.ts` **contenait encore** le littéral
`status: 'pending'`, comme garde d'anti-vacuité sur `PF-373`, avec la note : *« ce test échouera le jour où
elle disparaîtra — ce qui est le signal de mettre `PF-373` à jour, et non de supprimer ce test »*. Ce jour est
arrivé. Le test est **inversé** (`guardianship-liveness-derivation-gate.spec.ts:609`) : la famille existe
toujours, mais elle est *dérivée*. Le supprimer aurait été la sortie que sa propre note interdisait, et aurait
rendu la conversion invisible au prochain lecteur de ce fichier.

### A4 — Un brief peut poser une prémisse fausse, et la mesure l'emporte

`§D4` : la story prescrivait `guardianships.read`. La lecture de `permissions.constants.ts` a montré que ce
code est accordé à `teacher` et `parent`, donc que l'appliquer aurait **élargi** une autorisation. L'écart est
tranché dans cet ADR plutôt que noté en commentaire, parce qu'un écart au brief qui ne se lit que dans le code
n'est pas un écart tranché : c'est un écart oublié.
