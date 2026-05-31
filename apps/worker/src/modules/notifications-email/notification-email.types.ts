import type { NotificationKind, NotificationSeverity } from '@prisma/client';

/**
 * Mirror of `apps/api/src/modules/notifications/notification-email.types.ts`.
 * Kept in sync by hand (same pattern as `ExportJobPayload`) so the consumer
 * stays decoupled from the API package.
 */
export interface NotificationEmailJob {
  tenantId: string;
  to: string;
  recipientName: string;
  locale: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link: string | null;
  sourceType: string | null;
  sourceId: string | null;
}
