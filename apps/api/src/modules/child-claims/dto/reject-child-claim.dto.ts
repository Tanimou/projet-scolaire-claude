import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Reason-required reject body — `POST /admin/child-claims/:id/reject` (E9-S2).
 *
 * A blank / whitespace-only / missing reason is rejected by the validation pipe
 * → 400 (FR-4 / AC-6). Mirrors the contract `RejectChildClaimRequestSchema`
 * (`reason: string.trim().min(1).max(500)`) and the `EndEnrollmentDto.reason`
 * `@MaxLength(500)` precedent. The reason is stored on `GuardianshipClaim.decisionReason`,
 * captured in the append-only audit `after`, and surfaced to the parent (factual,
 * non-stigmatising) on the status strip + the reject notification.
 */
export class RejectChildClaimDto {
  // Trim BEFORE validation (the contract's `.trim().min(1)` order) so a whitespace-only
  // reason ("   ") is seen as empty by @IsNotEmpty → 400, never stored as an empty
  // decisionReason on the rejected claim / append-only audit.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
