import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';

import { AlertsModule } from './modules/alerts/alerts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { ChildClaimsModule } from './modules/child-claims/child-claims.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { ExportsModule } from './modules/exports/exports.module';
import { GradesModule } from './modules/grades/grades.module';
import { GuardiansModule } from './modules/guardians/guardians.module';
import { HealthController } from './modules/health/health.controller';
import { IdentityModule } from './modules/identity/identity.module';
import { ImportsModule } from './modules/imports/imports.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { LessonsModule } from './modules/lessons/lessons.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ParentExportsModule } from './modules/parent-exports/parent-exports.module';
import { RemediationModule } from './modules/remediation/remediation.module';
import { SchoolStructureModule } from './modules/school-structure/school-structure.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { StudentPortalModule } from './modules/student-portal/student-portal.module';
import { StudentsModule } from './modules/students/students.module';
import { TeacherExportsModule } from './modules/teacher-exports/teacher-exports.module';
import { TeachingModule } from './modules/teaching/teaching.module';
import { KeycloakModule } from './shared/keycloak/keycloak.module';
import { PrismaModule } from './shared/prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    TerminusModule,
    PrismaModule,
    KeycloakModule,
    IdentityModule,
    SchoolStructureModule,
    SchoolsModule,
    ImportsModule,
    IntegrationsModule,
    CalendarModule,
    StudentsModule,
    GuardiansModule,
    EnrollmentsModule,
    TeachingModule,
    GradesModule,
    LessonsModule,
    AttendanceModule,
    AnnouncementsModule,
    AnalyticsModule,
    NotificationsModule,
    ExportsModule,
    ParentExportsModule,
    TeacherExportsModule,
    AlertsModule,
    MessagingModule,
    RemediationModule,
    StudentPortalModule,
    ChildClaimsModule,
    // Instrumentation en dernier : le middleware qu'il installe s'applique à
    // toutes les routes déclarées au-dessus (S-E02-13 / PF-56).
    MetricsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
