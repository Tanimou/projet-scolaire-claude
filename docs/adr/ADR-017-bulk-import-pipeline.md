# ADR-017: Bulk import CSV — pipeline upload → validate → preview → apply

**Status:** Accepted
**Date:** 2026-05-15

## Context

Pour onboarder rapidement une école, l'admin doit pouvoir importer en lot:
- Élèves
- Profs
- Classes
- Parents
- Notes (rare, mais utile pour migration depuis ancien outil)
- Présences (rare)

Risques:
- CSV malformé → corruption données
- Pas de preview → admin applique sans voir → désastre
- Pas de rollback → erreurs irréversibles

## Decision

**Pipeline 5-étapes versionné en `import_batch`:**

1. **Upload** — admin upload CSV; fichier stocké S3; `import_batch` créé avec `status='uploaded'`
2. **Validate** — worker parse + valide chaque ligne contre schéma Zod + business rules; `import_row` créé par ligne avec status `valid|invalid` + erreurs; batch passe `status='validated'`
3. **Preview** — admin consulte preview (10-100 lignes affichées + statistiques globales: total, valides, invalides, doublons, conflits)
4. **Choose mode** — admin choisit:
   - `all_or_nothing`: applique seulement si 100% valides
   - `skip_invalid`: applique les valides, ignore les invalides
5. **Apply** — worker exécute en transaction (avec savepoint si skip_invalid); insère/update entités; lie `import_row.created_entity_id`; batch `status='applied'`
6. **Rollback (24h)** — admin peut rollback les 24h suivantes; worker compense les changements; `status='rolled_back'`

## Sécurité
- Scan antivirus sur upload (ClamAV intégré Phase 7)
- Limite taille CSV (10 MB par défaut, configurable)
- Limite nombre lignes (10 000 par défaut)
- Throttling (1 import en cours max par école)
- Audit log obligatoire sur chaque batch

## Schémas Zod par type
Stockés dans `packages/contracts/src/imports/` partagés client/serveur.
Exemple Student:
```ts
const StudentImportSchema = z.object({
  external_ref: z.string().optional(),
  last_name: z.string().min(1).max(80),
  first_name: z.string().min(1).max(80),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  class_section_name: z.string().optional(),
  ...custom_fields // dynamiques selon definitions
});
```

## UI Admin
Wizard 4 étapes:
1. Choisir type (icônes)
2. Télécharger template CSV (lien) + upload votre CSV (drop zone)
3. Preview avec erreurs ligne-par-ligne, statistiques, mode all-or-nothing / skip
4. Confirmer → progression temps réel via SSE → résultat

## Consequences

**Facile:**
- Onboarding écoles rapide
- Erreurs visibles avant impact
- Rollback en cas de fausse manip

**Difficile:**
- Pipeline complexe à implémenter (mitigé par tests exhaustifs)
- Rollback de notes publiées implique audit `score_revision` (logique métier à clarifier dans `clarifications.md`)

## Action Items

1. [ ] Schémas Zod par type d'import dans `packages/contracts`
2. [ ] Worker `imports.processor` avec parsing streaming (papaparse)
3. [ ] UI wizard 4 étapes
4. [ ] Tests E2E par type d'import
5. [ ] Documentation utilisateur "Importer en lot" dans guide admin
