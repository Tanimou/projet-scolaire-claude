import { Injectable, Logger } from '@nestjs/common';
import type {
  NotificationCadence,
  NotificationKind,
  NotificationPreference,
} from '@prisma/client';

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
  // E7-S1 — remediation & tutoring. The enum value exists now; the booking
  // notifications (and thus a visible prefs channel) arrive in S2, so this kind
  // is intentionally NOT in NOTIFICATION_KINDS yet — only the label map (which is
  // exhaustive over NotificationKind) carries it.
  remediation: 'Soutien scolaire',
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
  remediation:
    'Quand un créneau de soutien est réservé ou confirmé pour votre enfant.',
};

export interface PreferenceDto {
  kind: NotificationKind;
  label: string;
  description: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  // E5-S2 — per-kind email cadence (instant | daily_digest | off). Default
  // `instant` for any kind with no override row (today's behaviour).
  cadence: NotificationCadence;
}

export interface UpdatePreferenceArgs {
  inAppEnabled?: boolean;
  emailEnabled?: boolean;
  pushEnabled?: boolean;
  cadence?: NotificationCadence;
}

/** Default cadence for a kind with no override row (= today's behaviour). */
export const DEFAULT_CADENCE: NotificationCadence = 'instant';

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
        cadence: r?.cadence ?? DEFAULT_CADENCE,
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
      cadence: args.patch.cadence ?? existing?.cadence ?? DEFAULT_CADENCE,
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
      cadence: row.cadence,
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
   *
   * `tenantId` is optional but the dispatcher always passes it, so the lookup is
   * tenant-scoped — defence-in-depth matching the worker cron sibling
   * (`dispatchAlertEmails`) and ADR-002 ("every query scoped by tenant_id").
   *
   * NOTE (E5-S2): this returns *email-enabled* keys regardless of cadence. The
   * per-event dispatcher (`dispatchEmails`) layers the FR-2 cadence gate on top
   * via `instantEmailKeys` so `daily_digest`/`off` suppress the per-event email.
   */
  async emailEnabledKeys(
    pairs: ReadonlyArray<{ userProfileId: string; kind: NotificationKind }>,
    tenantId?: string,
  ): Promise<Set<string>> {
    if (pairs.length === 0) return new Set();
    const uniq = new Map<string, { userProfileId: string; kind: NotificationKind }>();
    for (const p of pairs) uniq.set(`${p.userProfileId}|${p.kind}`, p);
    const rows = await this.prisma.notificationPreference.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
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
   * E5-S2 — the FR-2 *per-event email* gate. Returns the set of
   * `${userProfileId}|${kind}` keys that should receive an email **now**:
   * `emailEnabled = true` **and** `cadence = instant`. Keys on `daily_digest`
   * (bundled by the daily cron) or `off` (muted) are excluded; a missing row
   * defaults to `emailEnabled=false` so it is excluded too. One query per batch,
   * tenant-scoped (ADR-002), mirroring `emailEnabledKeys`.
   *
   * This is the cadence-aware replacement the dispatcher uses for "email now".
   */
  async instantEmailKeys(
    pairs: ReadonlyArray<{ userProfileId: string; kind: NotificationKind }>,
    tenantId?: string,
  ): Promise<Set<string>> {
    if (pairs.length === 0) return new Set();
    const uniq = new Map<string, { userProfileId: string; kind: NotificationKind }>();
    for (const p of pairs) uniq.set(`${p.userProfileId}|${p.kind}`, p);
    const rows = await this.prisma.notificationPreference.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        OR: [...uniq.values()].map((p) => ({
          userProfileId: p.userProfileId,
          kind: p.kind,
        })),
      },
      select: { userProfileId: true, kind: true, emailEnabled: true, cadence: true },
    });
    return new Set(
      rows
        .filter((r) => r.emailEnabled && r.cadence === 'instant')
        .map((r) => `${r.userProfileId}|${r.kind}`),
    );
  }

  /**
   * E5-S2 — the FR-2 *in-app* gate that supersedes `disabledInAppKeys` when
   * cadence is live. For the (userProfileId, kind) pairs in a batch, classifies
   * each into the in-app action the §1.2 truth table dictates:
   *  - `skip`        → no in-app row (cadence `off` wins, OR in-app channel off
   *                    while cadence is `instant`/absent — today's behaviour).
   *  - `hiddenSource`→ write a hidden (`readAt=now`) in-app row even though the
   *                    in-app channel is off, because cadence is `daily_digest`
   *                    AND email is opted in — the daily cron needs a durable
   *                    source (data-model §3.3). (If email is off the event is not
   *                    digest-eligible, so no hidden row is needed → normal skip.)
   * Pairs absent from BOTH sets get a normal visible in-app row (the default).
   *
   * Returned as two Sets of `${userProfileId}|${kind}` keys. One query per batch,
   * tenant-scoped.
   */
  async inAppPlan(
    pairs: ReadonlyArray<{ userProfileId: string; kind: NotificationKind }>,
    tenantId?: string,
  ): Promise<{ skip: Set<string>; hiddenSource: Set<string> }> {
    const skip = new Set<string>();
    const hiddenSource = new Set<string>();
    if (pairs.length === 0) return { skip, hiddenSource };
    const uniq = new Map<string, { userProfileId: string; kind: NotificationKind }>();
    for (const p of pairs) uniq.set(`${p.userProfileId}|${p.kind}`, p);
    const rows = await this.prisma.notificationPreference.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        OR: [...uniq.values()].map((p) => ({
          userProfileId: p.userProfileId,
          kind: p.kind,
        })),
      },
      select: {
        userProfileId: true,
        kind: true,
        inAppEnabled: true,
        emailEnabled: true,
        cadence: true,
      },
    });
    for (const r of rows) {
      const key = `${r.userProfileId}|${r.kind}`;
      if (r.cadence === 'off') {
        // off wins: never write an in-app row for this kind.
        skip.add(key);
      } else if (!r.inAppEnabled) {
        if (r.cadence === 'daily_digest' && r.emailEnabled) {
          // in-app off + daily_digest + email on → hidden source row so the cron
          // has a durable source (data-model §3.3).
          hiddenSource.add(key);
        } else {
          // in-app off + (instant | daily_digest-without-email) → no row (today's
          // behaviour; nothing is digest-eligible without email).
          skip.add(key);
        }
      }
      // inAppEnabled && cadence != off → normal visible row (not in either set).
    }
    return { skip, hiddenSource };
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
