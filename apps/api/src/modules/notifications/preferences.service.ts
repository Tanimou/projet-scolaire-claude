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
  // E2-S1 — parent ↔ teacher messaging. A per-event kind (new message in a
  // thread), so it sits with the other per-event kinds, before the digest.
  'message',
  // E1-S4 — keep last so the digest reads as a distinct "summary" concept,
  // after the per-event kinds. Email-only opt-in (emailEnabled default false).
  'weekly_digest',
];

/** Display labels for the settings UI. */
export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  announcement: 'Annonces',
  alert: 'Alertes (suivi scolaire)',
  grade_published: 'Notes publiées',
  enrollment_status: 'Inscriptions',
  lesson_published: 'Cahier de texte',
  system: 'Messages système',
  message: 'Messagerie (parent ↔ enseignant)',
  weekly_digest: 'Récapitulatif hebdomadaire',
};

export const NOTIFICATION_KIND_DESCRIPTION: Record<NotificationKind, string> = {
  announcement: "Publications de l'école destinées à votre audience.",
  alert: "Détections automatiques du moteur (moyenne faible, absences, etc.).",
  grade_published: 'Quand une nouvelle note est publiée pour votre enfant.',
  enrollment_status: "Inscription confirmée, transfert, fin d'inscription.",
  lesson_published: 'Mises à jour du cahier de texte (incl. devoirs maison).',
  system: 'Messages techniques et administratifs.',
  message:
    "Quand un enseignant (ou un parent) vous envoie un nouveau message dans une conversation.",
  weekly_digest:
    'Un récapitulatif chaque lundi matin : tendance globale, nouvelles alertes, évaluations à venir et l’action recommandée. Envoyé par email uniquement.',
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
   * Batch variant of the in-app channel check used by `createMany` fan-out.
   * Given the (userProfileId, kind) pairs in a dispatch batch, returns the set
   * of `${userProfileId}|${kind}` keys whose in-app channel is *explicitly*
   * disabled. Pairs with no override row are absent from the result (default
   * in-app on), so callers keep them. One query per batch, deduplicated.
   */
  async disabledInAppKeys(
    pairs: ReadonlyArray<{ userProfileId: string; kind: NotificationKind }>,
  ): Promise<Set<string>> {
    if (pairs.length === 0) return new Set();
    const uniq = new Map<string, { userProfileId: string; kind: NotificationKind }>();
    for (const p of pairs) uniq.set(`${p.userProfileId}|${p.kind}`, p);
    const rows = await this.prisma.notificationPreference.findMany({
      where: {
        OR: [...uniq.values()].map((p) => ({
          userProfileId: p.userProfileId,
          kind: p.kind,
        })),
      },
      select: { userProfileId: true, kind: true, inAppEnabled: true },
    });
    return new Set(
      rows
        .filter((r) => !r.inAppEnabled)
        .map((r) => `${r.userProfileId}|${r.kind}`),
    );
  }

  /**
   * Batch variant for the *email* channel, symmetrical to `disabledInAppKeys`
   * but inverted: returns the set of `${userProfileId}|${kind}` keys whose
   * email channel is *explicitly enabled*. The email default is **off**, so a
   * missing override row means "no email" and is absent from the result — the
   * dispatcher emails only recipients who opted in. One query per batch.
   */
  async emailEnabledKeys(
    pairs: ReadonlyArray<{ userProfileId: string; kind: NotificationKind }>,
  ): Promise<Set<string>> {
    if (pairs.length === 0) return new Set();
    const uniq = new Map<string, { userProfileId: string; kind: NotificationKind }>();
    for (const p of pairs) uniq.set(`${p.userProfileId}|${p.kind}`, p);
    const rows = await this.prisma.notificationPreference.findMany({
      where: {
        OR: [...uniq.values()].map((p) => ({
          userProfileId: p.userProfileId,
          kind: p.kind,
        })),
      },
      select: { userProfileId: true, kind: true, emailEnabled: true },
    });
    return new Set(
      rows.filter((r) => r.emailEnabled).map((r) => `${r.userProfileId}|${r.kind}`),
    );
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
