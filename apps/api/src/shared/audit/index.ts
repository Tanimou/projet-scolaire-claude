/**
 * S-E04-1 — public API of the shared audit area.
 *
 * Plain re-export barrel, no Nest module: `shared/audit/` is a pure-function
 * area like `shared/config/` and `shared/release/`. Every declaration lives in
 * `provenance.ts`; nothing is declared here, so the barrel can never become a
 * second home (which is what `shared/quality/audit-provenance-gate.spec.ts`
 * asserts).
 */
export {
  MAX_USER_AGENT_LENGTH,
  deriveAlertActorProvenance,
  deriveAuditProvenance,
  sanitiseInetOrNull,
  truncateUserAgent,
  type AuditActorProvenance,
  type AuditProvenance,
} from './provenance';
