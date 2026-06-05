import { IsUUID } from 'class-validator';

/**
 * Parent self-service bulletin request body (E4-S2).
 *
 * The parent supplies ONLY the child + the term. The `classSectionId` is
 * NEVER accepted from the client — the server derives it from the child's
 * active enrollment for the term's academic year (anti-IDOR / anti scope
 * override). Guardianship of `studentId` is re-checked server-side via
 * `StudentAccessService.canAccessStudent` before any job is created.
 */
export class CreateParentBulletinDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  termId!: string;
}
