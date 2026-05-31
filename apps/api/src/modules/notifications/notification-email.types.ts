import type { NotificationKind, NotificationSeverity } from '@prisma/client';

/**
 * Payload enqueued on the `notifications-email` BullMQ queue by the API and
 * consumed by `apps/worker`. Kept in sync with the worker's local mirror
 * (`apps/worker/src/modules/notifications-email/notification-email.types.ts`),
 * exactly like `ExportJobPayload` is mirrored for the exports queue.
 *
 * The content fields are a snapshot of the in-app notification, so the worker
 * needs no DB round-trip to render the email.
 */
export interface NotificationEmailJob {
  tenantId: string;
  /** Recipient email address (UserProfile.email). */
  to: string;
  /** Display name for the greeting, falls back to the email locally. */
  recipientName: string;
  /** BCP-47 locale, e.g. `fr-FR`. */
  locale: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  /** App-relative deep link, e.g. `/parent/grades?studentId=...`. */
  link: string | null;
  sourceType: string | null;
  sourceId: string | null;
}
