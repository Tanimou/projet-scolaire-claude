# ADR-085 — Au plus UNE année scolaire `active` par école, garantie par la base

- **Statut :** accepté
- **Date :** 2026-08-29
- **Tranche :** `S-E03-12` (run 101)
- **Findings :** `PF-04` résidu (ii) — *avancé* · `PF-328` moitié multiplicité — *fermée* · `PF-329` — *désamorcée, pas fermée*
- **Gates :** G-MIGRATION, G-TRUTH, G-PORTAL, G-DNC
- **Palier de preuve :** A (migration)

## Le contexte, tel qu'il était écrit — et l'endroit où il était faux

`PF-04` (« incompatible counts across portals », P0) reste ouverte sur trois résidus. Le deuxième est cité
mot pour mot dans son registre :

> `PF-328` — with no "at most one active year" invariant, two active years remain **possible**, and the
> resolver now picks one *deterministically* rather than *correctly*.

Et la ligne `PF-328` elle-même expliquait pourquoi personne ne l'avait fermée :

> **Both candidate invariants FAIL on existing data**, which is exactly why this is a decision and not a
> migration.

**Cette phrase est vraie pour un invariant et fausse pour l'autre, et c'est toute la tranche.** Mesuré ce jour
contre le Postgres du **conteneur** (`docker exec` ; `localhost:5432` est une AUTRE base, native Windows, vide) :

| Invariant candidat | Tenu par les données ? | Sort |
|---|---|---|
| **CONTENANCE** — l'année `active` contient aujourd'hui | **NON** — les deux années `active` sont TERMINÉES (2026-07-05, 2024-07-05) | reste ouvert, intact |
| **UNICITÉ** — au plus une année `active` par école | **OUI** — chaque école en a exactement une | **fermé par cette ADR** |

Les deux moitiés avaient été traitées comme un seul blocage. Seule la contenance demande une décision de
donnée (« que veut dire `active` pour une année finie ? »). L'unicité ne demandait qu'une mesure.

## La décision

Poser un **index unique partiel** — migration `20260829120000_academic_year_one_active_per_school` :

```sql
CREATE UNIQUE INDEX IF NOT EXISTS academic_year_one_active_per_school
  ON academic_year (school_id) WHERE status = 'active';
```

Et nommer, dans `academic-years.controller.ts`, la violation que cet index rend désormais possible, pour
qu'une course rende un **409** plutôt qu'un 500.

**Cette migration n'invente aucune règle.** La règle existait déjà, voulue et implémentée : les deux seuls
écrivains applicatifs (`create` et `update`) basculent déjà les autres années en `closed` dans la même
transaction, et les deux semences créent exactement une année `active` par école. Ce qui manquait était la
garantie — la règle vivait uniquement dans du code écrit à la main, sur chaque chemin d'écriture, pour
toujours.

## Le nombre qui porte la décision

`PF-329` dit que le tableau de bord parent fenêtre ses chiffres sur l'année de l'**inscription**, alors que
tout autre portail lit l'année `active` de l'**école**. La question évidente — « combien d'enfants cela
touche-t-il ? » — n'avait jamais été posée. Réponse, mesurée :

| | Enfants divergents |
|---|---|
| Données réelles, aujourd'hui | **0 sur 2464** |
| Sous contrôle négatif : une seconde année `active` postérieure injectée dans l'école peuplée, puis `ROLLBACK` | **2463 sur 2463** |

La divergence ne croît pas : elle **bascule d'un coup sur toute la population** dès qu'une seconde année
`active` existe. La seconde année active est donc le **détonateur** de `PF-329`, et cet index est ce qui le
rend inatteignable par cette voie.

C'est aussi ce qui justifie de ne PAS avoir inversé l'axe du portail parent, ce que la ligne `PF-329`
proposait comme direction. `S-E03-3c` avait déjà mesuré pourquoi : l'année `active` des deux tenants étant
TERMINÉE, canonicaliser la clé de fenêtrage **viderait** la page pour exactement les enfants qu'elle sert.
Cette ADR ne tranche donc pas « quel axe est autoritaire » — elle supprime le seul déclencheur mesuré du
désaccord et laisse la question sémantique ouverte, avec son coût désormais chiffré.

## Ce que cette ADR ne décide pas

1. **La moitié CONTENANCE de `PF-328` reste ouverte.** Rien ici n'exige qu'une année `active` contienne
   aujourd'hui, et les deux années actives sont finies. Cette moitié demande une décision de donnée et n'est
   pas préjugée. **`PF-328` n'est donc pas fermée.**
2. **`PF-329` n'est pas fermée.** Le mécanisme à deux axes vit toujours dans `analytics.service.ts` : la
   projection parent résout `canonicalYear` pour ce qu'elle **affirme** et `windowEnrollment.academicYearId`
   pour ce qu'elle **fenêtre**. Il est désamorcé, pas retiré.
3. **`PF-04` n'est pas fermée.** Son résidu (i) (`PF-329`) et son résidu (iii) (« rien ne compare un compte
   réel à travers les quatre portails ») restent ouverts. Seul (ii) est discharged.

## Alternatives écartées

- **Une contrainte `UNIQUE (school_id, status)`** — exprimable dans `schema.prisma`, donc tentante. Écartée :
  elle interdirait aussi **deux années `closed`**, or `seed-demo.ts` en crée deux. Vérifié par contrôle
  positif : sous l'index partiel, une seconde année `closed` reste acceptée.
- **Un `CHECK` de contenance dans la même migration** — écarté : c'est l'invariant qui ÉCHOUE sur les données.
  Le poser `NOT VALID` puis corriger les deux lignes revient à laisser une tranche choisir un gagnant pour des
  violations existantes, ce que la ligne `PF-328` interdit explicitement.
- **`CREATE INDEX CONCURRENTLY`** — impossible : Prisma enveloppe chaque migration dans une transaction. Sans
  objet ici (4 lignes, et per Step −1 il n'existe aucun déploiement de production).
- **Ne rien faire tant que la décision de donnée n'est pas prise** — c'est ce qui a tenu `PF-328` fermée à
  clé pendant que sa moitié tenable attendait une mesure de trente secondes.

## Le piège que cette tranche a failli poser

Le mapping 409 devait reconnaître la violation. L'orthographe naturelle est de tester le **nom de l'index**.
Mesuré contre un vrai PostgreSQL, Prisma rend :

```
code: 'P2002'   meta: { modelName: 'AcademicYear', target: ['school_id'] }
```

— la **liste de colonnes**, jamais le nom de l'index. Un prédicat branché sur le nom compile, se lit bien, et
**ne se déclenche jamais**. Il aurait produit exactement le faux vert que `feedback_landed_is_not_ran` décrit :
un remède présent dans le diff, absent à l'exécution.

Le prédicat exige donc une cible à **exactement un élément** valant `school_id` — ce qui le distingue aussi de
`academic_year_school_id_name_key`, sur `(school_id, name)`, qui rend une cible à deux éléments et possède
déjà son propre 409. `one-active-academic-year-gate.spec.ts` épingle les deux formes, et la version vaine a
été installée puis exécutée pour vérifier qu'elle **rougit** le cliquet.

## Retour arrière

```sql
DROP INDEX IF EXISTS academic_year_one_active_per_school;
```

Une commande, sans perte de donnée : la migration est purement expansive (un index, aucune colonne ajoutée,
renommée ou supprimée, aucune donnée réécrite). Il n'y a pas de phase *contract* à planifier.
