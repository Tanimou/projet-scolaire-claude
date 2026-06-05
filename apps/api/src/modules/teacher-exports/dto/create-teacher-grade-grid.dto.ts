import { IsOptional, IsUUID } from 'class-validator';

/**
 * Teacher class grade-grid request body (E4-S3).
 *
 * The teacher supplies ONLY their `teachingAssignmentId` (one teacher × one
 * class × one subject) + an optional `termId`. The `classSectionId` is NEVER
 * accepted from the client — the server derives it from the teaching assignment
 * after re-checking the caller currently OWNS that assignment (anti-IDOR /
 * anti scope-override). A teacher must never be able to export an arbitrary
 * class section they do not teach.
 */
export class CreateTeacherGradeGridDto {
  @IsUUID()
  teachingAssignmentId!: string;

  @IsOptional()
  @IsUUID()
  termId?: string;
}
