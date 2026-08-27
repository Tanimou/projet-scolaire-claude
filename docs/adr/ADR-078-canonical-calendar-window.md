# ADR-078 — La fenêtre calendrier canonique : une seule déclaration, un fuseau DÉCLARÉ

- **Statut :** accepté
- **Date :** 2026-08-27
- **Tranche :** `S-E03-8` (V3-E03, L0)
- **Constatations :** `PF-40` (fermée), `PF-406` (ouverte puis corrigée ici — voir §D3), `PF-399`…`PF-405` (enregistrées, non corrigées)
- **Prolonge :** `ADR-070` (résolution canonique de l'année scolaire), `ADR-072` (inscription active canonique), `ADR-074` (vivacité de tutelle canonique), `ADR-077` (une collection persistée, pas une constante) — même discipline, autre vocabulaire : **une question, une dérivation**
- **S'appuie sur :** `S-E04-5` / `packages/contracts/src/audit/window.ts` (le fuseau vient de la donnée, il est renvoyé, il n'est jamais deviné)

---

## Contexte — sept réponses vivantes à une seule question

« Cet événement est-il dans le mois M ? » avait **sept** réponses sur `main`, toutes en
production, toutes différentes :

| Surface | Prédicat effectivement exécuté |
|---|---|
| `CalendarManager.tsx` (admin) | appartenance par `startsAt` SEUL |
| `PortalCalendarView.tsx` (grille parent + prof) | chevauchement, borne haute **fermée** à `23:59:59` (999 ms perdues) |
| `PortalCalendarView.tsx` (bande de KPI) | fenêtre ouverte sur `today`, pendant que la grille obéissait à `monthOffset` |
| `SchoolEventsPanel.tsx` ×2 | « à venir » redéclaré + `WEEK_MS` recopié |
| `CalendarPanel.tsx` (prof) | `getMonth() === getMonth()`, **sans comparer l'année** |
| `PortalCalendarView.tsx` (semaine) | `[lundi, lundi+7j]` comparé avec `<=` des deux côtés |

Conséquence observable : **le même congé était « de novembre » pour un parent et pas pour
l'admin**, et un compteur changeait tout seul après le chargement de la page — le SSR le
calculait sur l'horloge du conteneur, l'hydratation sur celle du visiteur, et React
remplaçait le nœud de texte en silence. C'est le défaut `A2 §5.5` de l'audit, et les quatre
mécanismes `A1`–`A4` de `PF-40`.

Cette ADR existe parce que la correction introduit **deux motifs transverses neufs**
(GUARDRAILS §2) :

1. un module de prédicats **sans dépendance** dans `packages/contracts`, importé
   **délibérément** par des composants `'use client'` ;
2. un **état résolu côté serveur qui traverse la frontière en prop** (`CalendarAnchor`),
   remplaçant des lectures d'horloge ambiantes.

Et parce qu'elle tranche quatre sémantiques qui, sans ce document, n'existeraient que dans des
commentaires de code — c'est-à-dire pas du tout, dès la prochaine relecture.

---

## D1 — Le domicile : `packages/contracts/src/calendar/`

**Décision.** Le prédicat vit dans `packages/contracts/src/calendar/window.ts`, sans aucune
dépendance (pas de `zod`, pas de React, pas de `lucide`), ré-exporté par le **barrel racine**.
Les composants clients l'importent par le **spécificateur nu** `@pilotage/contracts`.

**Ce qui a été mesuré, et non supposé.**

| Question | Mesure |
|---|---|
| `apps/web` a-t-il un runner unitaire ? | **Non** — ni jest ni vitest, seulement Playwright. Un module posé là ne **peut pas** avoir de preuve comportementale. |
| Un composant client importe-t-il DÉJÀ une **valeur** de `@pilotage/contracts` ? | **Oui.** `apps/web/src/app/admin/audit/audit-labels.ts` (module neutre) ré-exporte les valeurs `auditActionTone`, `classifyAuditAction`… et `AuditDetailDrawer.tsx` (`'use client'`, ligne 1) les consomme. Le barrel est dans le graphe du bundle navigateur **depuis `S-E04-2` / `PF-14`**. |
| Import par sous-chemin (`@pilotage/contracts/calendar`) ? | **Impossible sans changer l'outillage.** `apps/api` est en `moduleResolution: "Node"` (node10), qui **ignore** la table `exports` ; et le dépôt n'a aujourd'hui aucun import de sous-chemin. `packages/contracts/package.json` n'est donc pas modifié. |
| Les tests liront-ils la source ou `dist/` ? | La **source** : `apps/api/jest.config.js` mappe `^@pilotage/contracts$` vers `packages/contracts/src/index.ts`. |

**Alternatives écartées.** `apps/web/src/lib/` — intestable. `packages/ui` — pas de runner non
plus, et un prédicat métier n'est pas un composant de design system.

**Prose de production corrigée dans le même diff.** `EnrollmentsPageTabs.tsx:20-28` affirmait
qu'importer une **valeur** de contracts dans un composant client était « ce qu'aucun composant
client du dépôt ne fait aujourd'hui ». C'était **mesurablement faux** depuis `S-E04-2`. La
clause de fait est retirée ; le raisonnement propre à ce fichier (préférer une dérivation
serveur là où elle existe déjà) est conservé. Deux commentaires de production qui affirment des
conventions contradictoires sont exactement la dérive que cet epic existe pour tuer.

**Coût assumé.** Le barrel racine — donc `zod` et les dix sous-modules — entre dans le bundle
navigateur. C'est **préexistant** (`audit-labels.ts`) et mesuré ici pour la première fois :
`PF-401`. Le remède est une table `exports` par sous-chemin, bloquée par le
`moduleResolution: "Node"` d'`apps/api` : c'est un chantier d'outillage, pas une correction de vue.

---

## D2 — La sémantique du mois : CHEVAUCHEMENT, sur intervalle SEMI-OUVERT

**Décision.** Un mois `M` contient un événement **ssi** `[startsAt, endsAt]` intersecte
`[début de M, début de M+1)` :

```ts
start < window.endMs && end >= window.startMs
```

La borne haute est **exclusive**. La borne fermée à `23:59:59` qu'elle remplace amputait chaque
mois de ses **999 dernières millisecondes** ; une borne de semaine testée avec `<=` des deux
côtés comptait **deux fois** un événement démarrant lundi 00:00 pile.

**CONSÉQUENCE ASSUMÉE, écrite noir sur blanc.** Des vacances du **28/10 au 10/11** sont comptées
**une fois dans octobre ET une fois dans novembre**. L'appartenance mensuelle n'est donc **PAS
une partition** : `Σ(comptes mensuels) > total`.

Ce n'est pas un double comptage, et **toute assertion future « les mois doivent faire le total »
est fausse par construction**. « Combien d'événements **concernent** novembre » et « combien
**commencent** en novembre » sont deux questions ; une grille mensuelle pose la première, et le
KPI posé au-dessus d'elle doit poser exactement la même, sans quoi l'écran se contredit à 40 px
d'intervalle.

**Alternative écartée.** L'appartenance par `startsAt` seul (le prédicat admin) fait une
partition propre — et fait disparaître un congé de la Toussaint de la grille de novembre, où la
grille le **dessine pourtant**. Un compte qui contredit le rendu qu'il surmonte est pire qu'un
compte non additif.

---

## D3 — L'ancre : résolue une fois, côté serveur, dans le fuseau **DÉCLARÉ** de l'école

**Décision.** Toute l'arithmétique part d'une valeur plate et sérialisable :

```ts
CalendarAnchor = { nowMs: number; tzOffsetMinutes: number }
```

résolue **une fois par requête** dans un composant serveur (les cinq pages hôtes sont
`force-dynamic`), et traversant la frontière **en prop**. Dans le module canonique : aucun
`Date.now()`, aucun `new Date(` d'arité ≠ 1, aucun `getMonth` / `getDate` / `getDay` local — que
des **millisecondes absolues**. Propriété qui en découle, et qui rend `AC-4` prouvable sans
navigateur : **la même ancre rend des bornes identiques quel que soit le fuseau du processus qui
l'évalue**, donc SSR et hydratation calculent le même nombre, au caractère près.

### D3.1 — Le fuseau se DÉCLARE. Il ne se devine pas. (`PF-406`)

La première rédaction de cette tranche exposait, dans le module canonique :

```ts
export function resolveCalendarAnchor(now: Date): CalendarAnchor {
  return { nowMs: now.getTime(), tzOffsetMinutes: -now.getTimezoneOffset() };
}
```

C'est-à-dire le fuseau **du processus**. Or :

* `infra/docker/Dockerfile.web` part de `node:22-alpine` et **aucun `TZ`** n'est posé dans
  `infra/docker-compose.yml`, `infra/docker-compose.prod.yml` ni dans un `.env` → le conteneur
  `web` livré est en **UTC**, donc `tzOffsetMinutes === 0` en production ;
* l'école est à `Europe/Paris` — `School.timezone` et `Tenant.timezone` portent ce défaut dans
  `schema.prisma`, et `apps/web/src/lib/ics.ts` écrit déjà `X-WR-TIMEZONE:Europe/Paris` ;
* les événements « toute la journée » sont persistés depuis l'horloge du **navigateur** de
  l'admin : `CalendarManager.tsx` écrit `new Date(YYYY-MM-DDT00:00:00).toISOString()`.

**Ce que cela produisait**, sur les trois portails à la fois : un congé du 10 au 14 novembre
saisi à Paris est stocké `2026-11-09T23:00:00.000Z` ; sous un décalage de `0`, `localDayNumber`
le ramène au **9 novembre**. La grille, la pastille « À venir » et la tuile « PROCHAIN »
affichaient donc le congé **un jour trop tôt**. Et un férié isolé du 1er novembre (stocké
`2026-10-31T23:00Z → 2026-11-01T22:59:59Z`) satisfaisait le prédicat de chevauchement
**d'octobre ET de novembre** — la conséquence assumée de D2 déclenchée par une erreur, pas par
la réalité du calendrier.

Le plus important : **avant la tranche, l'hydratation corrigeait cette valeur en silence** avec
l'horloge (correcte) du visiteur. La tranche retire cette correction — c'est son but — et
**gelait donc l'erreur**. Le `docblock` de `CalendarAnchor` promettait par ailleurs « l'heure
locale de **l'école** » : le code ne l'a jamais tenue. C'est `PF-406`.

**La correction, et sa portée exacte.**

1. `resolveCalendarAnchor(now)` est **supprimé**. Le module canonique n'expose plus qu'un
   constructeur d'ancre à deux composantes **déjà résolues** (`calendarAnchorOf`) : deviner un
   fuseau n'y est plus seulement interdit, c'est **inexprimable**.
2. La résolution vit dans `packages/contracts/src/school-time/anchor.ts` —
   **hors** du module canonique, parce qu'elle exige `Intl` **et** un import, tous deux
   interdits par le cliquet R4 :
   `resolveCalendarAnchorInZone(now: Date, timeZone: string)`. Le fuseau est un identifiant
   **IANA explicite** ; le décalage est lu **à l'instant `now`**, donc l'heure d'été est correcte
   au moment du rendu (Paris rend `+60` en janvier, `+120` en juillet).
3. Elle réutilise la machinerie IANA **déjà écrite et déjà éprouvée** de
   `packages/contracts/src/audit/window.ts` (`assertKnownTimezone`, `zoneOffsetMinutes`, promue
   publique ici). Deux implémentations du décalage d'un fuseau, ce seraient deux réponses
   possibles à « quelle heure est-il à l'école » — la classe de défaut exacte que ces deux
   tranches ferment. Un fuseau inconnu du runtime **lève**, il n'est jamais replié en silence sur
   UTC (`DNC-08`, et un repli muet ici reproduirait le défaut sous une forme indétectable).
4. Le cliquet R4 interdit désormais `getTimezoneOffset` dans le module canonique. Il ne
   l'interdisait pas — la première version **passait le cliquet**, et il a fallu une revue
   humaine. C'est l'ambiant le plus dangereux du lot : les autres accesseurs rendent un champ
   civil faux, celui-ci décale **toutes** les bornes.
5. Les cinq pages hôtes appellent `resolveSchoolCalendarAnchor()`
   (`apps/web/src/lib/school-calendar-anchor.ts`) et ne connaissent **aucun fuseau**.

### D3.2 — Ce que la correction ne fait PAS encore : la source multi-locataire

`schoolCalendarTimezone()` lit `SCHOOL_TIMEZONE` (défaut : `Europe/Paris`, **le même** que
`School.timezone` / `Tenant.timezone` et que le `X-WR-TIMEZONE` des exports ICS). C'est un
fuseau **de déploiement**, pas un fuseau **de locataire**.

Il faut le dire sans le maquiller : le modèle multi-tenant (`ADR-002`) admet deux écoles dans
deux fuseaux, et un fuseau de déploiement ne sait pas les distinguer. La source correcte est
`Tenant.timezone`, résolue côté serveur et **renvoyée** par une lecture que les trois portails
atteignent — exactement la discipline que `S-E04-5` a posée pour l'audit (`filters.timezone`,
renvoyé, jamais accepté du client).

Pourquoi ce n'est pas fait ici : aucune lecture atteignable par un **parent** ou un **prof** ne
porte le fuseau aujourd'hui (`/api/v1/schools` est administratif ; `/api/v1/me` et
`/api/v1/branding/me` ne le portent pas). L'exposer est une tranche **backend** — DTO, contrôleur,
requête — et `AC-9` de `S-E03-8` interdit explicitement de toucher un contrôleur ou un DTO.
Le résidu est enregistré (`PF-406`, volet 2) et le code est écrit pour que ce jour-là
**un seul fichier change** : `apps/web/src/lib/school-calendar-anchor.ts`.

Ce que le correctif gagne malgré cette limite : l'écran d'aujourd'hui devient **juste** au lieu
d'être faux d'une heure, et le fuseau devient une **entrée nommée** au lieu d'un accident
d'environnement — c'est-à-dire quelque chose qu'un test peut interroger, ce que
`-getTimezoneOffset()` n'était pas.

### D3.3 — Ce qui reste figé : `PF-402`

`tzOffsetMinutes` est **figé** pour la durée de la requête. Une borne de mois peut donc être
décalée d'une heure de part et d'autre d'un changement d'heure d'été. Effet **nul** sur des
événements `allDay` (le jour civil ne bouge pas), non nul en principe. Le remède exact — une
échelle de bornes précalculée côté serveur — est hors périmètre. **`PF-402` décrit uniquement
cette dérive DST ; il ne couvrait pas, et n'a jamais couvert, le décalage de `PF-406`.**

**Alternative écartée : poser `TZ=Europe/Paris` sur le service `web`.** Elle corrige le
conteneur livré et rien d'autre : elle laisse `next dev` faux sur toute machine hors de Paris,
elle est invisible depuis le code, elle n'est testable par aucun test, et elle **épingle le
déploiement entier à un fuseau** sans même le dire dans le code. Un réglage d'infrastructure ne
peut pas porter une règle métier.

---

## D4 — La bande de KPI OBÉIT au filtre, et NOMME sa population

**Décision.** Les tuiles de KPI de `PortalCalendarView` comptent la population **filtrée**, et
le libellé porte le filtre actif (`TOTAL` → `AFFICHÉS`, avec la portée nommée).

**Pourquoi.** La rangée de puces est à 40 px de la bande et porte **déjà** les comptes non
filtrés (« Tous · N », puis le compte de chaque type). Le registre « population entière » existe
donc juste en dessous : une bande immobile n'ajoutait aucune information, elle apprenait
seulement à l'utilisateur que la moitié de son écran ignore le filtre qu'il vient de poser.
**Rien n'est perdu ; seul change quel nombre porte quel mot.**

**Décision jointe, qu'aucun critère d'acceptation ne couvrait — enregistrée ici pour cette
raison.** La tuile mensuelle suit désormais le mois **navigué**, pas le mois courant : son
libellé bascule de « CE MOIS-CI » à « **MOIS AFFICHÉ** » dès que `monthOffset !== 0`. Sans ce
basculement, naviguer vers décembre laissait une tuile intitulée « CE MOIS-CI » afficher le
compte de décembre — la divergence `A2` reconstituée à l'identique. Un futur relecteur qui
retrouve « MOIS AFFICHÉ » sans cette ligne le lira comme une régression.

---

## L'exemption de `FreshnessChip` NE SE TRANSFÈRE PAS — le test en quatre points

`FreshnessChip.tsx:66-76` lit `new Date()` au rendu et se rafraîchit toutes les 30 s. C'est
**légitime**, et c'est pourquoi il faut écrire pourquoi ça ne l'est pas ailleurs : sans ce test,
le prochain lecteur généralise l'exemption et rouvre `A4`.

Un affichage dépendant de l'horloge du lecteur est admissible **ssi les quatre points sont
vrais** :

1. il est **`aria-hidden`** — il n'entre pas dans le nom accessible ;
2. il porte **`suppressHydrationWarning`** — la divergence SSR/client est déclarée, pas subie ;
3. il **REFORMULE** une valeur faisant autorité rendue **ailleurs dans le même composant** — la
   puce porte déjà l'état et l'horodatage ; le suffixe relatif n'apprend rien de neuf ;
4. il **se rafraîchit par dessein**, à cadence fixe et visible.

`formatRelativeTime` (`packages/ui/src/lib/format.ts`) est le formateur de ce cas, et de ce cas
seulement.

Un KPI calendrier ne coche **aucun** des quatre : il est **dans** le nom accessible, il n'a
**aucun jumeau faisant autorité** à l'écran, il ne se rafraîchit pas par dessein — et un nombre
qui change après le chargement y est **indiscernable** d'un changement de données. C'est
précisément ce qui rendait `A4` grave plutôt que cosmétique.

---

## Conséquences

**Acquis.**

- Une seule déclaration de « dans la fenêtre », « à venir », « cette semaine », « ce mois-ci ».
  Admin, prof et parent ne peuvent plus se contredire sur un congé.
- Plus aucun compteur calendrier ne dépend de l'horloge **ni du fuseau** d'un lecteur — visiteur
  **ou** conteneur.
- Le prédicat a une **preuve comportementale exécutable** (`apps/api/src/shared/quality/
  calendar-window.spec.ts`) : chaque cas montre le nouveau prédicat répondre X et l'ancien,
  **figé en dur dans le fichier**, répondre non-X sur la même entrée.
- Un **cliquet à sens unique** (`calendar-window-derivation-gate.spec.ts`, R1–R4) empêche la
  réapparition silencieuse : corpus **dérivé** d'une marche de `apps/web/src` filtrée par
  prédicat de contenu, commentaires **blanchis** avant parsing, appariement sur l'AST, contrôle
  positif sur le fichier de production **tel qu'il était avant** la tranche.

**À payer.**

- `Σ(comptes mensuels) > total`, définitivement et par dessein (D2).
- Le barrel `@pilotage/contracts` reste dans le bundle navigateur (`PF-401`).
- Le fuseau est encore **de déploiement**, pas **de locataire** (`PF-406`, volet 2).
- La dérive DST d'une heure reste ouverte (`PF-402`).
- `pnpm --filter @pilotage/contracts build` est un **pré-requis de land** : les consommateurs
  runtime passent par `dist/`, que le runner de tests ne reconstruit pas.

**Ce que cette ADR interdit désormais.**

- Redéclarer une fenêtre, un « à venir » ou une appartenance au mois hors du module canonique.
- Lire une horloge ou un fuseau **ambiant** — `Date.now()`, `new Date()`, `getTimezoneOffset()` —
  pour alimenter une surface calendrier, côté client **comme** côté serveur.
- Rendre la longueur d'une liste tronquée comme un total (`capList` expose `total`, jamais
  `items.length` — classe fermée sous `PF-20`, ré-enregistrée sous `PF-377`).
