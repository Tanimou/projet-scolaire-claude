import { z } from 'zod';

import { ALERT_RULE_CODE, ALERT_SEVERITY, RISK_LEVEL, TREND } from '../enums';

import { UuidSchema } from './common';

export const SubjectSnapshotSchema = z.object({
  subjectId: UuidSchema,
  subjectName: z.string(),
  subjectIcon: z.string().nullable(),
  coefficient: z.number(),
  average: z.number().nullable(),
  trend: z.enum(TREND),
  riskLevel: z.enum(RISK_LEVEL),
  lastGradeAt: z.string().nullable(),
});

export const StudentDashboardSchema = z.object({
  studentId: UuidSchema,
  studentName: z.string(),
  termId: UuidSchema,
  termName: z.string(),
  global: z.object({
    average: z.number().nullable(),
    maxScore: z.number(),
    trend: z.enum(TREND),
    riskLevel: z.enum(RISK_LEVEL),
    deltaVsPreviousTerm: z.number().nullable(),
    sampleSize: z.number().int(),
  }),
  subjects: z.array(SubjectSnapshotSchema),
  alerts: z.array(
    z.object({
      id: UuidSchema,
      ruleCode: z.enum(ALERT_RULE_CODE),
      severity: z.enum(ALERT_SEVERITY),
      message: z.string(),
      recommendation: z.string(),
      subjectName: z.string().nullable(),
      raisedAt: z.string(),
    }),
  ),
  recentGrades: z.array(
    z.object({
      id: UuidSchema,
      assessmentTitle: z.string(),
      subjectName: z.string(),
      score: z.number().nullable(),
      maxScore: z.number(),
      publishedAt: z.string(),
      trend: z.enum(TREND).nullable(),
    }),
  ),
  upcomingAssessments: z.array(
    z.object({
      id: UuidSchema,
      title: z.string(),
      subjectName: z.string(),
      scheduledAt: z.string(),
      type: z.string(),
    }),
  ),
});
export type StudentDashboard = z.infer<typeof StudentDashboardSchema>;
