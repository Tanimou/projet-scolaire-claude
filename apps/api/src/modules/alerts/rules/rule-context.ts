import type { AlertRule, Prisma } from '@prisma/client';

import type { PrismaService } from '../../../shared/prisma/prisma.service';

/** Args every rule evaluator receives. */
export interface RuleContext {
  prisma: PrismaService;
  rule: AlertRule;
  tenantId: string;
  schoolId: string | null;
  /** Active academic year id (resolved once, passed down). */
  academicYearId: string | null;
  /** Dedup window in days (evaluator-level constant, default 7). */
  dedupWindowDays: number;
}

/** What each rule must produce per detection. The evaluator persists the rows. */
export interface DetectedAlert {
  studentId: string;
  subjectId?: string | null;
  classSectionId?: string | null;
  title: string;
  body: string;
  recommendation?: string | null;
  context?: Prisma.InputJsonValue;
}
