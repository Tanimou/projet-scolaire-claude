# ADR-084 — Une note de ZÉRO est une note, et `PF-339` est FALSIFIÉE

- **Statut :** accepté
- **Date :** 2026-08-29 (run 99)
- **Tranche :** `S-E03-2b` — `V3-E03` (vérité canonique et contrats de requête)
- **Findings :** `PF-05` *(avancée — résidu 3 sur 3 levé)* · `PF-339` *(**falsifiée**, pas corrigée)*
- **Voisins :** `ADR-068 §1.1` (l'invariant que rien n'énonce) · `ADR-071` (`S-E03-2`) · `DNC-01`

---

## 1. Le contexte, et la phrase qu'il faut lire en entier

Le registre portait `PF-339` en **P1** depuis le run 81, dans ces termes :

> `analytics.service.ts:977` — `if (!g.value) continue` **supprime une note légitime de ZÉRO** de toutes les
> surfaces adossées à la projection A, y compris le tableau de bord north-star.

La ligne `PF-05` la nommait comme **l'un des trois résidus** qui l'empêchent de fermer. Trois runs l'ont lue et
aucun ne l'a exécutée : c'était une affirmation de lecture, jamais une mesure.

Ce run avait un Postgres vivant — le premier depuis huit runs — donc la question a été **tranchée par exécution**.

## 2. La décision : `PF-339` est FALSIFIÉE telle qu'écrite

`Grade.value` est `Decimal? @db.Decimal(5,2)`. Prisma rend un `Prisma.Decimal`, c'est-à-dire un **objet**, et tout
objet est vrai en JavaScript. Donc `!Decimal(0)` vaut `false` et **le zéro était CONSERVÉ**.

Mesuré, pas déduit — `scripts/grade-zero-value-probe.js`, contre `database=pilotage server=172.18.0.10` (le
conteneur, **pas** `localhost:5432` qui est l'autre base, native Windows), sur 420 notes réelles :

```
ok  P0  positive control — live database reached, and it holds grades
        database=pilotage server=172.18.0.10/32 grade rows=420
ok  P1  PF-339 FALSIFIED — `!g.value` KEEPS a Decimal zero
        value=0 -> ctor=i typeof=object raw=0 !value=false (false ⇒ kept)
ok  P2  LATENT hazard REAL — `!Number(g.value)` DROPS the same zero
        Number(value)=0 !Number(value)=true (true ⇒ dropped silently)
ok  P3  NEW predicate keeps 0 in BOTH representations and still drops NULL
ok  P4  negative control — transaction rolled back, no row mutated
PROBE: PASS — 5/5
```

**La sévérité descend, et la ligne se ferme quand même** — exactement le mouvement d'`ADR-068 §1.1`, et pour la
même raison : ce n'est pas une requalification d'étiquette, c'est une mesure. `PF-339` passe `open P1` →
`falsified`. Elle n'est **pas** écrite `closed` : rien n'a été réparé, une affirmation a été réfutée. Ne pas la
« corriger » à la hausse plus tard sur relecture du seul énoncé.

## 3. Pourquoi le code a changé quand même

Parce que le zéro survivait **par accident**.

La sûreté reposait entièrement sur un invariant que **rien dans le code n'énonçait** : que la valeur atteint la
boucle *non convertie*. Or `analytics.service.ts` fait **déjà** `Number(g.value)` à deux autres endroits du même
fichier (l. 834, l. 1297). Le jour où une valeur numérisée traverse l'une de ces quatre boucles — un DTO
intermédiaire, un `$queryRaw`, un aller-retour JSON, une projection partagée — `!0` supprime le zéro **en
silence**, et la ligne `PF-339` redevient vraie sans qu'une seule de ces boucles ait été touchée.

C'est la forme d'`ADR-068 §1.1`, mot pour mot : *la seule chose qui gardait le code correct était un invariant que
rien dans le code n'énonçait.*

Le même fichier portait par ailleurs **deux idiomes pour le même test** : quatre sites en `!g.value` et quatre
sites en `g.value === null || g.value === undefined`. Classe « deux listes tenues à la main » : la divergence est
déjà présente, seul l'accident de représentation la rendait inoffensive.

**Décision :** les quatre sites adoptent le prédicat explicite **déjà employé par leurs quatre sites frères** —
la règle du dossier d'accueil, pas un idiome de plus.

| Site | Méthode | Surface |
|---|---|---|
| `analytics.service.ts:1160` | `parentDashboard` | `/parent/dashboard`, `/parent/subjects`, `/parent/children/[id]/report`, `/admin/students/[id]` |
| `:1235` | `parentDashboard` | évolution par trimestre, mêmes surfaces |
| `:1612` | `parentDashboard` | rang par matière et rang général de la classe |
| `:3415` | `schoolPerformance` | `overall` + `byCycle` du tableau de bord **admin** |

Trois des quatre sont **dans la projection A elle-même**, celle dont `PF-05` parle. Le quatrième porte un KPI
d'établissement.

## 4. Ce que le défaut aurait coûté, chiffré

Sur la fixture minimale du spec — une note de **0** et une note de **20** :

| | vérité | avec `!g.value` sur une valeur numérisée |
|---|---|---|
| `sampleSize` | 2 | 1 |
| `successRate` | 50 % | **100 %** |
| `overall` | 50 % | **100 %** |

Le prédicat ne dégrade pas le KPI : il l'**invente**. Une note nulle est exactement la note qui devrait faire
baisser un taux de réussite, et c'est la seule que la forme fautive retire des **deux** côtés de la fraction.
C'est la divergence que `DNC-01` interdit.

## 5. Le cliquet, et pourquoi il est obligatoire ici

La fermeture est réclamée comme **CLASSE** (« la forme est interdite »), pas comme quatre sites. Le palier de
preuve impose alors un cliquet, quel que soit le tier.

`grade-zero-value.spec.ts` scanne `apps/api/src` et `apps/worker/src` — corpus **dérivé** de `git ls-files`,
jamais une allowlist littérale — et interdit `!<identifiant>.value` sur du code **décommenté** (le cliquet juge
du code ; sans cette précaution il rougirait sur le commentaire de la l. 1153 qui cite la forme interdite —
c'est la leçon `PF-366`).

Trois contrôles de non-vacuité, parce qu'un cliquet vert sur zéro fichier est vert par construction :

1. le corpus contient réellement > 100 fichiers **et** le fichier incriminé ;
2. le détecteur **rougit** sur une violation injectée ;
3. le détecteur **rougit sur le fichier de production RÉEL reconstitué d'avant la tranche** (≥ 4 violations).
   C'est le témoin le plus fort disponible : un cliquet qui ne rougit pas sur le défaut qu'il prétend geler ne
   garde rien.

## 6. Conséquences

- `PF-05` perd **un** de ses trois résidus, et le perd *avec une preuve exécutée*. Les **deux autres tiennent** et
  la ligne reste `open` : (a) la divergence de comptage A/B toujours non démontrée sur la seed, (b) six
  projections toujours six (`PF-337`, `PF-338`). L'unification A/B reste le travail de `S-E03-3`.
- Aucun changement de comportement sur les données d'aujourd'hui : la base ne contient **aucune** note à `0` ni à
  `NULL` (mesuré : `value=0: 0`, `value=null: 0` sur 420 lignes). C'est une **immunisation**, pas une réparation,
  et le PR le dit dans ces termes.
- `sumOnTwenty` est accumulé dans `schoolPerformance` et **jamais rendu** — accumulateur mort repéré en passant,
  enregistré et non corrigé (RULE 0 clause 6).

## 7. Ce qui n'a PAS été fait, dit franchement

- **Aucune reconstruction d'image.** Le disque hôte est à **5,1 Go libres** ; sous ~5 Go un build casse la pile,
  et une pile cassée coûte plus cher qu'un rebuild non fait. La sonde tourne donc contre l'image en place, via
  `docker cp` + `docker exec` — elle n'exerce que le client Prisma et le schéma, pas le code applicatif modifié,
  et cette limite est la raison pour laquelle la moitié comportementale est portée par jest et non par la sonde.
- **Aucune assertion sur les trois sites de `parentDashboard` par un test de bout en bout.** La moitié
  comportementale est prouvée sur `schoolPerformance`, la plus petite des deux méthodes ; les trois autres sites
  sont couverts par le **cliquet**, c'est-à-dire comme classe et non comme comportement. Dit ainsi plutôt que
  laissé à supposer.
