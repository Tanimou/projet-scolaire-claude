import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Promote-an-alert request body (E7-S1).
 *
 * The parent supplies ONLY the alert id. The plan's `studentId` / `subjectId` /
 * baseline are derived SERVER-side from the alert (never client-supplied) —
 * exactly the E1-S3 meeting-request promotion discipline. Guardianship of the
 * alert's student is re-checked server-side via
 * `StudentAccessService.canAccessStudent` BEFORE any plan is created. `objective`
 * is an optional, kind, non-stigmatising label.
 */
export class PromoteRemediationPlanDto {
  @IsUUID()
  alertId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  objective?: string;
}
