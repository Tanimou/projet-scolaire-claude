/**
 * Re-export the import handler contract from the shared `@pilotage/imports-core`
 * package (E11-S1). The handler tree + apply/rollback engine were relocated there
 * so the API (validate path) and the worker (async apply path) consume ONE
 * implementation byte-for-byte (architect ADR-024 R4 — no forked engine, and the
 * worker never imports `apps/api`).
 *
 * Kept as a thin re-export so existing in-module imports
 * (`./handler.types`) and any external references stay valid.
 */
export type {
  ImportContext,
  ApplyContext,
  RollbackContext,
  ImportCaches,
  RowError,
  ValidationResult,
  AppliedEntity,
  ImportTemplate,
  ImportHandler,
} from '@pilotage/imports-core';
