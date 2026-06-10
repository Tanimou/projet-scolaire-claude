import { IsIn } from 'class-validator';

/**
 * Request body for `PATCH /remediation/plans/:id/close` (E7-S6) — the kind plan
 * completion verb. `resolution` discriminates the celebratory "objectif atteint"
 * (`met`) from the administrative "clôturé sans suite" (`closed`). The flip is
 * from-status-guarded server-side (`open` → met|closed) so a concurrent
 * double-close yields exactly one success + one deterministic 409 (ADR-020 idiom).
 * Completion is reversible (`PATCH .../:id/reopen`), so this is never a trap.
 */
export class CloseRemediationPlanDto {
  @IsIn(['met', 'closed'])
  resolution!: 'met' | 'closed';
}
