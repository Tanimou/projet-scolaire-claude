import { Injectable, Logger } from '@nestjs/common';
import type { NotificationKind, NotificationPreference } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export const NOTIFICATION_KINDS: ReadonlyArray<NotificationKind> = [
  'announcement',
  'alert',
  'grade_published',
  'enrollment_status',
  'lesson_published',
  'system',
];

/** Display labels for the settings UI. */
export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  announcement: 'Annonces',
  alert: 'Alertes (suivi scolaire)',
  grade_published: 'Notes publiées',
  enrollment_status: 'Inscriptions',
  lesson_published: 'Cahier de texte',
  system: 'Messages système',
};

export const NOTIFICATION_KIND_DESCRIPTION: Record<NotificationKind, string> = {
  announcement: "Publications de l'école destinées à votre audience.",
  alert: "Détections automatiques du moteur (moyenne faible, absences, etc.).",
  grade_published: 'Quand une nouvelle note est publiée pour votre enfant.',
  enrollment_status: "Inscription confirmée, transfert, fin d'inscription.",
  lesson_published: 'Mises à jour du cahier de texte (incl. devoirs maison).',
  system: 'Messages techniques et administratifs.',
};

export interface PreferenceDto {
  kind: NotificationKind;
  label: string;
  description: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
}

export interface UpdatePreferenceArgs {
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
}

/**
 * Per-user notification preferences. Missing row → defaults (in-app on, email
 * off, push off). The settings UI always renders the full kind list by merging
 * defaults with the override rows.
 */
@Injectable()
export class NotificationPreferencesService {
  private readonly logger = new Logger(NotificationPreferencesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listForUser(args: {
    tenantId: string;
    userProfileId: string;
  }): Promise<PreferenceDto[]> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { tenantId: args.tenantId, userProfileId: args.userProfileId },
    });
    const byKind = new Map<NotificationKind, NotificationPreference>(
      rows.map((r) => [r.kind, r]),
    );
    return NOTIFICATION_KINDS.map((kind) => {
      const r = byKind.get(kind);
      return {
        kind,
        label: NOTIFICATION_KIND_LABEL[kind],
        description: NOTIFICATION_KIND_DESCRIPTION[kind],
        inAppEnabled: r?.inAppEnabled ?? true,
        emailEnabled: r?.emailEnabled ?? false,
        pushEnabled: r?.pushEnabled ?? false,
      };
    });
  }

  /**
   * Upsert one preference row (creates with defaults merged with the patch,
   * updates only the provided fields).
   */
  async update(args: {
    tenantId: string;
    userProfileId: string;
    kind: NotificationKind;
    patch: UpdatePreferenceArgs;
  }): Promise<PreferenceDto> {
    const existing = await this.prisma.notificationPreference.findUnique({
      where: { userProfileId_kind: { userProfileId: args.userProfileId, kind: args.kind } },
    });
    const merged = {
      inAppEnabled: args.patch.inAppEnabled ?? existing?.inAppEnabled ?? true,
      emailEnabled: args.patch.emailEnabled ?? existing?.emailEnabled ?? false,
      pushEnabled: args.patch.pushEnabled ?? existing?.pushEnabled ?? false,
    };
    const row = await this.prisma.notificationPreference.upsert({
      where: { userProfileId_kind: { userProfileId: args.userProfileId, kind: args.kind } },
      create: {
        tenantId: args.tenantId,
        userProfileId: args.userProfileId,
        kind: args.kind,
        ...merged,
      },
      update: merged,
    });
    return {
      kind: row.kind,
      label: NOTIFICATION_KIND_LABEL[row.kind],
      description: NOTIFICATION_KIND_DESCRIPTION[row.kind],
      inAppEnabled: row.inAppEnabled,
      emailEnabled: row.emailEnabled,
      pushEnabled: row.pushEnabled,
    };
  }

  /**
   * Used by future dispatchers to decide whether to deliver. In-app is the
   * channel we have today; email + push wait for R8.2.
   */
  async isEnabled(args: {
    userProfileId: string;
    kind: NotificationKind;
    channel: 'inApp' | 'email' | 'push';
  }): Promise<boolean> {
    const r = await this.prisma.notificationPreference.findUnique({
      where: { userProfileId_kind: { userProfileId: args.userProfileId, kind: args.kind } },
    });
    if (!r) return args.channel === 'inApp'; // defaults: in-app on, rest off
    switch (args.channel) {
      case 'inApp':
        return r.inAppEnabled;
      case 'email':
        return r.emailEnabled;
      case 'push':
        return r.pushEnabled;
    }
  }
}
