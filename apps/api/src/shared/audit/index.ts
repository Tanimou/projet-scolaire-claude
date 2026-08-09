/**
 * S-E04-1 — public API of the shared audit area.
 *
 * Plain re-export barrel, no Nest module: `shared/audit/` is a pure-function
 * area like `shared/config/` and `shared/release/`. Every declaration lives in
 * `provenance.ts` (role/portal + the sanitisers) or in `client-hints.ts`
 * (S-E04-3's single extraction seam); nothing is declared here, so the barrel
 * can never become a second home (which is what
 * `shared/quality/audit-provenance-gate.spec.ts` asserts).
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

export {
  AUDIT_FORWARD_TOKEN_ENV,
  NO_CLIENT_HINTS,
  PILOTAGE_CLIENT_IP_HEADER,
  PILOTAGE_CLIENT_USER_AGENT_HEADER,
  PILOTAGE_FORWARD_HEADERS,
  PILOTAGE_FORWARD_TOKEN_HEADER,
  configureAuditClientHints,
  extractAuditClientHints,
  normaliseClientAddress,
  parseForwardedChain,
  resetAuditClientHintsPolicy,
  type AuditClientHints,
  type AuditClientHintsPolicy,
  type ClientHintsRequest,
} from './client-hints';

// S-E04-6 — the in-transaction write seam. Re-exported, never declared here:
// `audit-provenance-gate.spec.ts` asserts this barrel holds no declaration of
// its own, so it can never become a second home.
export {
  AUDIT_WRITE_FAILED_MESSAGE,
  writeAudit,
  type AuditTransactionClient,
  type AuditWriteInput,
} from './write-audit';
