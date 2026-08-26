# ADR-074 — « ce lien parent↔enfant est-il vivant ? » est UNE dérivation, et les comptes portent une portée

- **Statut :** Accepté
- **Date :** 2026-08-26
- **Story :** `S-E03-3c` (run 85)
- **Findings :** `PF-358` CLOSED · `PF-12` advanced · `PF-372`..`PF-376` recorded
- **Épique :** `V3-E03` — Canonical truth and query contracts (L0)
- **Prédécesseurs :** `ADR-041 §D2/§D4` (une définition, importée jamais re-dérivée),
  `ADR-070` (`academic-year/`), `ADR-072` (`enrollment/`), `ADR-073` (`guardianship/child-link.ts`)

---

## 1. Le contexte, mesuré et non hérité

La ligne `PF-12` de `traceability/OPEN.md` énonçait sa propre condition de clôture :

> **Do not mark this row `closed` while the guardianship predicate has more than one home.**
> […] **The move that closes this row is `PF-358` + those four sites, in one slice.**

Cette tranche exécute ce mouvement. Elle **re-mesure d'abord**, et la mesure corrige la note
résiduelle du run 84 sur deux points — c'est `§A1`.

### 1.1 Trois prédicats pour une question, plus une quatrième forme sans prédicat du tout

Balayage de `apps/api/src`, `apps/worker/src`, `apps/web/src` et `packages/*/src`, le 2026-08-26 :

| Portée écrite | Sites de production | Exemples |
|---|---|---|
| `status: 'active'` | 12 | `student-access.service.ts:108` (ABAC parent), `alerts.service.ts:1029`, `announcements.service.ts:181`, `attendance.controller.ts:636`, `enrollments.controller.ts:446`, `assessments.controller.ts:339`, `lessons.controller.ts:230`, `classes.controller.ts:165`, `students.controller.ts:262`, `alerts-evaluator.service.ts:212`, `enrollment-xlsx.generator.ts:45`, `parent-digest-cron.service.ts:171` |
| `status: { not: 'revoked' }` | 2 | `guardians.controller.ts:108`, `students.controller.ts:385` |
| **aucun prédicat** (`_count`) | 3 | `students.controller.ts:276`, `guardians.controller.ts:116` et `:202` |

Les deux premières lignes ne posent **pas la même question**, et c'est le cœur du sujet : l'une
demande « ce parent garde-t-il cet enfant **maintenant** ? », l'autre « ce lien est-il **au
registre** ? », donc y compris une demande en attente de décision. **Les deux sont légitimes.** Ce
qui ne l'était pas, c'est qu'aucune ne portât de nom : le choix se faisait site par site, à la main,
et la troisième ligne devenait indistinguable d'un oubli.

### 1.2 Les deux contradictions, dont une opération admin impossible à terminer

**(a) Une seule charge utile se contredit elle-même.** `GET /guardians` renvoyait, **sur le même
objet**, `_count.guardianships` non filtré (`:116`) et le tableau `guardianships` filtré
`{ not: 'revoked' }` (`:118`). Un parent dont un rattachement a été révoqué s'affichait donc
« 2 rattachements » au-dessus d'une liste qui en montrait un. Ce n'est pas une divergence entre
deux écrans — c'est une contradiction **interne à une réponse**, la forme exacte que `PF-12` nomme.

**(b) Le remède que l'erreur prescrit ne pouvait jamais lever le blocage.**
`DELETE /guardians/:id` refusait tant que `_count.guardianships > 0`, **non filtré**, en répondant :

> « Ce parent est lié à des élèves. Révoquez d'abord les rattachements. »

Or révoquer un rattachement le passe à `revoked` — que ce compte **continuait de compter**.
L'utilisateur qui appliquait l'instruction à la lettre rebouclait indéfiniment ; la seule sortie
était de supprimer des lignes en base. **Ce n'est pas un défaut d'affichage, c'est une opération
d'administration structurellement impossible à mener à terme**, et c'est le défaut le plus concret
que la tranche ferme.

---

## 2. La décision

### D1 — Deux portées NOMMÉES, une troisième qui doit être DÉCLARÉE

`packages/contracts/src/guardianship/link-liveness.ts` énonce, une fois :

- **VIVANT** (`guardianshipLiveWhere()`, `isLiveGuardianship()`) — `status ∈ {active}`. Portée de
  tout contrôle d'accès et de tout comptage de « responsables » montré à un humain.
- **AU REGISTRE** (`guardianshipOnTheBooksWhere()`, `isGuardianshipOnTheBooks()`) —
  `status ∈ {active, pending}` : tout sauf terminé. Portée des écrans admin qui doivent voir ce
  qui reste à trancher.
- **TOUS LES ÉTATS** — licite, mais le site doit le **dire** :
  `GUARDIANSHIP_ALL_STATES_ARE_DELIBERATE`.

### D2 — « Au registre » est DÉRIVÉ, jamais écrit

`{ not: 'revoked' }` et `{ in: ['active','pending'] }` ne sont équivalents que tant que
`GuardianshipStatus` compte trois membres. Écrire `['active','pending']` en littéral créerait une
**seconde liste à tenir à la main** face à `schema.prisma:170-174` — le couple qui a déjà coûté à ce
dépôt un 503 sur quatre portails (`academic_year.SELECT`, run 59). La constante est donc dérivée par
soustraction de l'état terminal, et un test du cliquet **compare le vocabulaire du contrat à l'énum
Prisma lue dans `schema.prisma`**, des deux côtés, plutôt que de relire le code.

### D3 — L'asymétrie entre les deux portées est délibérée

`GUARDIANSHIP_LIVE_STATUSES` est une liste **positive** ; `GUARDIANSHIP_ON_THE_BOOKS_STATUSES` est
**dérivée par soustraction**. Un quatrième état ajouté à l'énum entrerait donc automatiquement dans
« au registre » (ce qui préserve exactement la sémantique de `{ not: 'revoked' }` qu'il remplace)
mais **jamais** dans « vivant ». Le défaut sûr des deux portées penche du même côté : **ne pas
élargir un accès parce qu'une énum a grandi.**

### D4 — Un marqueur dans le code, pas une allowlist dans le cliquet

Une lecture non filtrée reste licite : la fiche d'un parent et l'écran de gestion des rattachements
**doivent** montrer les liens révoqués. Le défaut n'a jamais été « une lecture non filtrée », c'est
« une lecture non filtrée **indistinguable d'un oubli** ». Ces deux sites déclarent donc leur
intention **dans leur propre code**, là où un relecteur la voit. Une allowlist de fichiers dans le
cliquet aurait produit l'inverse — et serait l'une des trois sorties interdites
(`academic-year-resolution-gate.spec.ts:20-32`).

### D5 — Le garde de suppression est AU REGISTRE, pas VIVANT

Volontairement plus large que la portée d'accès : un lien `pending` est une décision humaine encore
en vol, et supprimer le parent sous elle la ferait disparaître sans qu'elle ait été tranchée.

### D6 — Le `where` rend un tableau MUTABLE, et ce n'est pas un relâchement

`EnumGuardianshipStatusFilter` déclare `in?: GuardianshipStatus[]` — mutable. Un
`readonly GuardianshipLinkStatus[]` y est refusé (`TS2322`), sur les deux applications ; **le
typecheck l'a dit avant que quiconque ne le suppose.** Les constantes restent `readonly` — c'est là
que l'immuabilité compte, puisqu'elles sont partagées — et chaque constructeur **copie** (`[...]`),
donc rend un tableau frais. Aucun appelant ne peut muter la liste canonique par le `where` qu'il
vient de recevoir, ce qu'un `as` aurait permis en silence.

### D7 — `ParentGuardianshipLinkStatus` cesse d'être une quatrième copie

`child-link.ts` (ADR-073) déclarait `'pending' | 'active' | 'revoked'` en littéral, sous un docblock
qui l'annonçait déjà comme une dette. Elle **aliase** désormais `GuardianshipLinkStatus`. Le nom est
conservé : il est importé par `child-claims.service.ts` et lu dans deux signatures publiques.

---

## 3. Ce que la tranche ne change PAS, énoncé plutôt que découvert

1. **Aucune autorisation n'est modifiée.** `guardianshipLiveWhere()` rend exactement le
   `status: 'active'` que les sites ABAC épelaient. La conversion est **sans effet sémantique**, et
   c'est la seule raison pour laquelle elle est permise dans une tranche qui n'a pas le droit de
   toucher une portée d'accès. L'assertion d'égalité exacte de
   `student-access.service.spec.ts` le pin, **renforcée** plutôt que relâchée : la portée attendue y
   est écrite en toutes lettres ET confrontée au prédicat du produit, si bien qu'un élargissement
   futur de `VIVANT` ferait échouer ce test **sur la frontière ABAC parent**.
2. **Les gardes d'état-de-départ des mutations restent en clair.** Les trois `status: 'pending'` de
   `withdraw()` / `approve()` / `rejectClaim()` sont de la concurrence optimiste, pas des lectures
   de vivacité. Le cliquet ne juge que les opérations de LECTURE : la catégorie est reconnue **par
   construction**, il n'y a aucun nom en exception.
3. **La famille `pending` de l'analytique n'est pas rabattue** (`PF-373`).

---

## 4. Les conséquences

**Positives.** Une opération admin cesse d'être impossible à terminer (`§1.2 b`). Un compte cesse de
contredire la liste qu'il surmonte (`§1.2 a`). Un enfant cesse d'afficher « 2 responsables » quand
l'un a été retiré. Le vocabulaire du lien est **mesuré** contre `schema.prisma` au lieu d'être cru.

**Coûts, énoncés.** Un troisième module frère dans `packages/contracts` — `PF-370` reste ouverte, et
`§A2` explique pourquoi ce n'est pas résolu ici. Deux réponses gagnent un champ `guardianshipScope`
(additif). Le cliquet a une portée qu'il faut lire : **R-A ne voit pas les relations imbriquées**,
et c'est R-C qui les couvre — cette limite a été **découverte par la preuve rouge**, pas supposée
(`§A3`).

---

## 5. Les alternatives écartées

- **Une seule portée, « non révoqué », partout.** Rejetée : élargirait la portée ABAC parent des
  liens `active` aux liens `pending` — une modification d'autorisation, interdite par la story.
- **Laisser les `_count` non filtrés et corriger l'affichage.** Rejetée : déplacerait la
  contradiction de la base vers le processus, la leçon exacte de `dedupKey()` (`ADR-068 §3`).
- **Convertir aussi la famille `pending` de l'analytique.** Rejetée : changerait un KPI sans rien
  fermer. Enregistrée (`PF-373`).
- **Une allowlist dans le cliquet pour les deux vues de gestion.** Rejetée — voir `D4`.

---

## Annexes — ce que la tranche a appris en se trompant

### A1 — La note résiduelle du run 84 était fausse sur deux sites, et c'est pourquoi on re-mesure

Elle rangeait `student-access.service.ts:192` et `digest-aggregate.service.ts:60` parmi les sites
qui « hand-write the guardianship predicate ». **Les deux sont des prédicats d'INSCRIPTION**
(`Enrollment.status`), pas de tutelle. Trois colonnes distinctes — `Guardianship.status`,
`GuardianshipClaim.status`, `Enrollment.status` — ont été confondues au moins une fois dans le
registre. Enregistré en `PF-374`. La leçon est celle du ledger : **une note résiduelle est une
piste, jamais une mesure** ; elle se re-vérifie avant d'être exécutée. Le balayage a d'ailleurs
trouvé **~20 sites** là où la note en annonçait cinq.

### A2 — Le troisième module frère, et pourquoi la convergence n'est toujours pas ici

`academic-year/`, `enrollment/`, `guardianship/child-link.ts` et maintenant `link-liveness.ts`.
`ADR-041 §D4` demandait UN registre. La règle d'`ADR-072 §A6` est **reconduite sans changement** :
la famille tient, parce que ces modules ne partagent délibérément pas de forme et que collapser
maintenant reviendrait à inventer la forme du registre sur un échantillon. `PF-365` / `PF-370`
restent ouvertes, et la décision appartient au run `epic-spec` dû à `V3-E03`.

### A3 — Le cliquet avait un angle mort, et c'est la preuve ROUGE qui l'a montré

Premier jet : deux règles. R-A (lectures `prisma.guardianship.*`) et R-B (`_count` non filtré). En
rendant `students.controller.ts` à son état d'avant la tranche, **R-B a signalé le `_count`
(`:276`) et R-A n'a rien vu du `guardianships: { where: { status: 'active' } }` quatorze lignes plus
haut** — parce que ce n'est pas un appel `prisma.guardianship.*`, c'est une **relation** lue depuis
`student`. Or la **majorité** des sites de cette tranche sont de cette forme. R-C a donc été ajoutée.

La preuve rouge finale, sur trois fichiers rendus à leur état antérieur : **11 contraventions,
réparties sur les trois règles.** Sans elle, le cliquet aurait été vert en ne couvrant qu'un tiers
de sa classe déclarée — vert, et rassurant, et faux.

### A4 — Une assertion peut être fausse là où le module est juste

Le premier jet du cliquet assenait `expect(home).not.toContain('@prisma/client')` sur le module
contractuel. **Rouge** — parce que le docblock **cite** `@prisma/client` pour expliquer pourquoi il
n'en dépendra jamais. L'assertion a été resserrée sur une **importation** (`/^\s*import\s[^\n]*'@prisma\/client'/m`),
pas sur une occurrence de chaîne. C'est la règle maison appliquée à la lettre : *une assertion rouge
peut être MON erreur, pas celle du code* — ne jamais ajuster le code pour satisfaire une assertion
non relue.

### A5 — Un script de conversion peut réparer un site et casser un import

Le script mécanique employait `.replace()` pour insérer l'import « après » un import existant : il
l'a **remplacé**, supprimant `resolveActiveAcademicYear` de quatre fichiers qui s'en servent. Repéré
en **relisant le diff**, pas en faisant confiance au « converted » qu'il imprimait. Et une seconde
fois : trois fichiers ont été rendus à `HEAD` pour la preuve rouge alors qu'**un seul** avait été
sauvegardé — deux éditions ont dû être refaites. Les deux incidents disent la même chose : *un outil
qui rapporte un succès rapporte l'exécution de son intention, jamais la justesse de son effet.*
