import { z } from 'zod';

import {
  AVAILABILITY_KIND,
  BOOKING_STATUS,
  REMEDIATION_PLAN_STATUS,
  TUTOR_COST_KIND,
  TUTOR_TYPE,
} from '../enums';

import { UuidSchema } from './common';

/**
 * Remediation & Tutoring loop — E7.
 *
 * Closes the cahier's action loop: an alert's recommendation promotes into a
 * tracked `RemediationPlan`, the parent books a school-curated tutoring resource
 * from a read-only catalogue, and a calm progress strip (S3) measures the
 * improvement against the captured baseline. These DTOs are the contract for the
 * parent-facing surfaces shipped in S1 (promotion + read-only catalogue); the
 * booking write contract lands in S2.
 *
 * `TutorCostKind` is a DISPLAY LABEL only — never a price (ADR-018 finance
 * isolation). `BookingStatus` is declared here so the S2 booking surface and the
 * S4 teacher inbox share one source of truth, even though S1 ships no booking write.
 */

// ---------------------------------------------------------------------------
// Promote an alert → RemediationPlan (parent, idempotent, guardianship-ABAC)
// ---------------------------------------------------------------------------

/**
 * Request body for `POST /remediation/plans`. The parent passes ONLY the alert
 * id — `studentId`/`subjectId`/`targetRuleCode` and the baseline are derived
 * server-side from the alert (never client-supplied), exactly the E1-S3
 * meeting-request promotion discipline. `objective` is an optional, kind,
 * non-stigmatising label the parent may set.
 */
export const PromoteRemediationPlanDtoSchema = z.object({
  alertId: UuidSchema,
  objective: z.string().trim().max(280).optional(),
});
export type PromoteRemediationPlanDto = z.infer<typeof PromoteRemediationPlanDtoSchema>;

/**
 * A remediation plan as surfaced to the parent. Carries the diagnosis (subject +
 * the originating alert), the captured baseline figure the S3 strip frames the
 * trend against, and lightweight session counts (always 0 in S1 — no booking
 * write yet, kept in the shape so S2/S3 need no contract change).
 */
export const RemediationPlanDtoSchema = z.object({
  id: UuidSchema,
  status: z.enum(REMEDIATION_PLAN_STATUS),

  studentId: UuidSchema,
  studentName: z.string(),

  subjectId: UuidSchema,
  subjectCode: z.string().nullable(),
  subjectName: z.string().nullable(),

  /** The originating alert (the diagnosis), or null if it was since deleted. */
  alertId: UuidSchema.nullable(),

  /** Optional kind objective the parent set. */
  objective: z.string().nullable(),

  /** Subject average captured at promotion time (the strip baseline), or null. */
  baselineAvg: z.number().nullable(),
  /** Subject trend delta captured at promotion time (signed, /20), or null. */
  baselineTrendDelta: z.number().nullable(),

  /** Booking session counts (0 in S1 — booking writes arrive in S2). */
  sessionsPlanned: z.number().int().nonnegative(),
  sessionsDone: z.number().int().nonnegative(),

  createdAt: z.string(),
  closedAt: z.string().nullable(),
});
export type RemediationPlanDto = z.infer<typeof RemediationPlanDtoSchema>;

// ---------------------------------------------------------------------------
// Read-only catalogue (parent) — published, subject-filtered tutors + open slots
// ---------------------------------------------------------------------------

/**
 * A bookable availability slot as surfaced in the read-only catalogue. S1 lists
 * a tutor's active slots (browse only) — no booking verb yet. `kind` discriminates
 * a repeating weekday slot from a single dated one-off; the UI renders whichever
 * fields the kind populates.
 */
export const CatalogueSlotDtoSchema = z.object({
  id: UuidSchema,
  kind: z.enum(AVAILABILITY_KIND),
  weekday: z.number().int().min(0).max(6).nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  capacity: z.number().int().positive(),

  // ---- E7-S2: live booking availability (additive-optional so the S1 page keeps
  // compiling; the server now populates these). The catalogue renders bookable /
  // "Complet" state WITHOUT an N+1 — both are computed in one grouped Booking query.
  /** capacity − active bookings on the resolvable next instance. */
  remainingSeats: z.number().int().nonnegative().default(0),
  /** The resolved next dated instance for this slot (ISO), or null if none resolvable. */
  nextSessionAt: z.string().nullable().default(null),
  /** This caller's own existing active booking id on the next instance (idempotency hint), or null. */
  myBookingId: UuidSchema.nullable().default(null),
});
export type CatalogueSlotDto = z.infer<typeof CatalogueSlotDtoSchema>;

/**
 * A tutoring resource as surfaced in the read-only catalogue: published, within
 * the parent's tenant, and matching the diagnosed subject. `costKind` is a label
 * only (never a price). Carries its active open slots (bounded include, no N+1).
 */
export const CatalogueTutorDtoSchema = z.object({
  id: UuidSchema,
  type: z.enum(TUTOR_TYPE),
  costKind: z.enum(TUTOR_COST_KIND),
  displayName: z.string(),
  blurb: z.string().nullable(),
  subjectIds: z.array(UuidSchema),
  slots: z.array(CatalogueSlotDtoSchema),
});
export type CatalogueTutorDto = z.infer<typeof CatalogueTutorDtoSchema>;

/** Aggregate response for `GET /remediation/catalogue?subjectId=`. */
export const RemediationCatalogueDtoSchema = z.object({
  subjectId: UuidSchema,
  subjectName: z.string().nullable(),
  tutors: z.array(CatalogueTutorDtoSchema),
});
export type RemediationCatalogueDto = z.infer<typeof RemediationCatalogueDtoSchema>;

// Re-export the booking-status enum tuple at the DTO layer so downstream slices
// (S2 booking, S4 teacher inbox) import it alongside the plan/catalogue DTOs.
export const BOOKING_STATUS_VALUES = BOOKING_STATUS;

// ---------------------------------------------------------------------------
// E7-S2 — Booking (parent verb, concurrency-guarded). See ADR-020.
// ---------------------------------------------------------------------------

/**
 * Request body for `POST /remediation/bookings`. The parent passes ONLY the plan,
 * the availability slot, and the concrete dated `sessionAt` instance (plus an
 * optional kind note) — `studentId`/`tutorId`/`schoolId` are derived SERVER-side
 * (planId → plan.studentId; availabilityId → availability.tutorId), exactly the
 * S1 "parent passes only the alert id" discipline.
 *
 * `sessionAt` is validated against the slot server-side (one_off: must equal the
 * slot's `startsAt`; recurring_weekly: must fall on the slot weekday at startTime)
 * and re-canonicalised before the write so two parents booking "the same instance"
 * compute byte-identical keys — a mismatch is a deterministic 422, never a 500.
 */
export const CreateBookingDtoSchema = z.object({
  planId: UuidSchema,
  availabilityId: UuidSchema,
  sessionAt: z.string().datetime(),
  note: z.string().trim().max(280).optional(),
});
export type CreateBookingDto = z.infer<typeof CreateBookingDtoSchema>;

/** The created/read booking shape returned by the booking verbs. */
export const BookingDtoSchema = z.object({
  id: UuidSchema,
  planId: UuidSchema,
  tutorId: UuidSchema,
  tutorName: z.string(),
  availabilityId: UuidSchema,
  studentId: UuidSchema,
  sessionAt: z.string(),
  status: z.enum(BOOKING_STATUS),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type BookingDto = z.infer<typeof BookingDtoSchema>;

// ---------------------------------------------------------------------------
// E7-S3 — Parent remediation progress strip (measured-improvement payoff)
// ---------------------------------------------------------------------------

/**
 * The IMPROVEMENT delta threshold — the SINGLE shared constant that decides when
 * the strip flips into the E3 emerald celebration lane. It reuses the E3
 * `IMPROVEMENT`/`NEGATIVE_TREND` rule default (`1.5` pts /20). Do NOT invent a new
 * tunable: the strip "improved" flag and the alert engine speak the same number.
 */
export const IMPROVEMENT_DELTA_THRESHOLD = 1.5;

/**
 * Per-open-plan progress for the parent dashboard strip (S3). One entry per
 * ACTIVE/open `RemediationPlan` for the student. Additive & optional on the
 * dashboard response envelope (mirrors the E6 `freshness?` precedent) — a client
 * that ignores it sees today's payload exactly, and an empty/absent array renders
 * NO strip.
 *
 * The trend is framed PATIENTLY and kindly: `currentAvg`/`trendDelta` null means
 * "en attente des prochaines notes" (never "no progress"); a flat/negative delta is
 * met with "les premiers effets prennent quelques semaines" (never "échec"). The
 * strip shows the MOVEMENT (delta), never the child's raw standing as a verdict.
 */
export const RemediationProgressDtoSchema = z.object({
  planId: UuidSchema,
  subjectId: UuidSchema,
  subjectCode: z.string().nullable(),
  subjectName: z.string().nullable(),
  objective: z.string().nullable(),
  /** Subject average at promotion time (the anchor); null when none was capturable. */
  baselineAvg: z.number().nullable(),
  /** Current subject average, read snapshot-first / live fall-through; null = "en attente". */
  currentAvg: z.number().nullable(),
  /** currentAvg − baselineAvg when BOTH present, else null (signed, /20). */
  trendDelta: z.number().nullable(),
  /** True once trendDelta ≥ the IMPROVEMENT threshold (the E3 emerald lane trigger). */
  improved: z.boolean(),
  sessionsPlanned: z.number().int().nonnegative(),
  sessionsDone: z.number().int().nonnegative(),
  /** ISO of the soonest future confirmed/requested booking instance, or null. */
  nextSessionAt: z.string().nullable(),
  createdAt: z.string(),
});
export type RemediationProgressDto = z.infer<typeof RemediationProgressDtoSchema>;

/** The additive `remediation` block on the parent-dashboard aggregate envelope. */
export const RemediationProgressListDtoSchema = z.array(RemediationProgressDtoSchema);
export type RemediationProgressListDto = z.infer<typeof RemediationProgressListDtoSchema>;

// ---------------------------------------------------------------------------
// E7-S4 — Teacher capacity management + booking transitions
// ---------------------------------------------------------------------------

/**
 * The teacher's OWN auto-derived `Tutor` record + their published availability
 * slots, surfaced on the "Mes créneaux de soutien" page. A teacher tutor is the
 * one whose `userProfileId === caller` (the ownership wall) — a teacher never
 * sees another tutor's slots. `tutorId` is null until the teacher publishes
 * their first slot (the surface lazily creates the tutor row server-side).
 */
export const TeacherAvailabilityDtoSchema = z.object({
  id: UuidSchema,
  kind: z.enum(AVAILABILITY_KIND),
  weekday: z.number().int().min(0).max(6).nullable(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  capacity: z.number().int().positive(),
  active: z.boolean(),
  /** Active bookings (requested+confirmed) on this slot's next instance. */
  bookedCount: z.number().int().nonnegative(),
});
export type TeacherAvailabilityDto = z.infer<typeof TeacherAvailabilityDtoSchema>;

/**
 * The teacher remediation surface payload (S4) — the caller's own tutor record
 * (or null before any slot is published), its subjects, published flag, and its
 * availability slots with live booked counts. Assembled in ONE aggregate read.
 */
export const TeacherTutorDtoSchema = z.object({
  /** Null until the teacher publishes their first slot (lazy tutor creation). */
  tutorId: UuidSchema.nullable(),
  displayName: z.string().nullable(),
  /** Whether the admin has published the tutor to the parent catalogue. */
  published: z.boolean(),
  subjectIds: z.array(UuidSchema),
  availabilities: z.array(TeacherAvailabilityDtoSchema),
});
export type TeacherTutorDto = z.infer<typeof TeacherTutorDtoSchema>;

/**
 * A booking enriched with the context a teacher needs in their inbox: the pupil's
 * name, the subject, the plan target, and the resolved session datetime. The
 * teacher only ever sees bookings whose `tutor.userProfileId === caller`
 * (the ownership wall, applied server-side) — never another tutor's bookings.
 */
export const TeacherBookingDtoSchema = z.object({
  id: UuidSchema,
  planId: UuidSchema,
  availabilityId: UuidSchema,
  studentId: UuidSchema,
  studentName: z.string(),
  subjectId: UuidSchema.nullable(),
  subjectName: z.string().nullable(),
  sessionAt: z.string(),
  status: z.enum(BOOKING_STATUS),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type TeacherBookingDto = z.infer<typeof TeacherBookingDtoSchema>;

/** A subject the teacher currently teaches — the publish-form dropdown options. */
export const TeachableSubjectDtoSchema = z.object({
  id: UuidSchema,
  code: z.string().nullable(),
  name: z.string(),
});
export type TeachableSubjectDto = z.infer<typeof TeachableSubjectDtoSchema>;

/** Aggregate response for `GET /remediation/teacher` (the teacher surface). */
export const TeacherRemediationDtoSchema = z.object({
  tutor: TeacherTutorDtoSchema,
  bookings: z.array(TeacherBookingDtoSchema),
  /** Subjects the teacher currently teaches — the publish-slot subject options. */
  teachableSubjects: z.array(TeachableSubjectDtoSchema),
});
export type TeacherRemediationDto = z.infer<typeof TeacherRemediationDtoSchema>;

/**
 * Request body for `POST /remediation/teacher/availabilities` (publish a slot,
 * S4). The teacher's own tutor record is resolved/created SERVER-side from the
 * caller (never client-supplied), exactly the "parent passes only the alert id"
 * discipline. A `recurring_weekly` slot needs `weekday`+`startTime`(+`endTime`);
 * a `one_off` needs `startsAt`(+`endsAt`). `subjectId` scopes which subject the
 * teacher offers support in (the catalogue filter); it must be a subject the
 * teacher currently teaches (ownership wall, re-checked server-side).
 */
export const UpsertTeacherAvailabilityDtoSchema = z
  .object({
    kind: z.enum(AVAILABILITY_KIND),
    subjectId: UuidSchema,
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    startsAt: z.string().nullable().optional(),
    endsAt: z.string().nullable().optional(),
    capacity: z.number().int().min(1).max(50).default(1),
    active: z.boolean().default(true),
  })
  .refine(
    (v) =>
      v.kind === 'recurring_weekly'
        ? v.weekday != null && !!v.startTime
        : !!v.startsAt,
    { message: 'recurring_weekly needs weekday+startTime; one_off needs startsAt' },
  );
export type UpsertTeacherAvailabilityDto = z.infer<typeof UpsertTeacherAvailabilityDtoSchema>;

/**
 * The teacher booking transitions (S4) — a NARROWED subset of `BookingStatus`
 * the tutor-owner may move a booking to. A teacher confirms a request, declines
 * it, marks the session honoured (`completed`), records a no-show
 * (`no_show` — mapped onto `declined` with a "Absent" note server-side, since
 * the enum carries no `no_show` value and S4 ships NO schema change), or proposes
 * another slot (`proposed_alternative`, which requires a `note`). Parent cancel
 * uses the dedicated `PATCH /remediation/bookings/:id/cancel` (S2), not this verb.
 */
export const TEACHER_BOOKING_TRANSITION = [
  'confirmed',
  'declined',
  'completed',
  'no_show',
  'proposed_alternative',
] as const;
export type TeacherBookingTransition = (typeof TEACHER_BOOKING_TRANSITION)[number];

/** Request body for `PATCH /remediation/teacher/bookings/:id/transition` (S4). */
export const TransitionBookingDtoSchema = z.object({
  toStatus: z.enum(TEACHER_BOOKING_TRANSITION),
  note: z.string().trim().max(280).optional(),
});
export type TransitionBookingDto = z.infer<typeof TransitionBookingDtoSchema>;

// ---------------------------------------------------------------------------
// E7-S5 — Admin remediation catalogue curation & oversight (remediation.manage)
// ---------------------------------------------------------------------------

/**
 * An admin catalogue row (`GET /remediation/admin/tutors`). Unlike the parent
 * catalogue, the admin sees the FULL roster — every type and every published
 * state — so curation (publish / retire / edit) is possible. `published` is the
 * lifecycle flag: `published:true` = discoverable in the parent catalogue,
 * `published:false` = retired (the row + its slots/bookings survive). The Tutor
 * model carries no separate `active` column, so retirement == toggling
 * `published` (we deliberately omit a tutor-level `active`). `costKind` is a
 * DISPLAY LABEL only — never a price (ADR-018). `availabilityCount` and
 * `activeBookingCount` are resolved in ONE grouped query (no N+1).
 */
export const AdminTutorDtoSchema = z.object({
  id: UuidSchema,
  type: z.enum(TUTOR_TYPE),
  costKind: z.enum(TUTOR_COST_KIND),
  displayName: z.string(),
  blurb: z.string().nullable(),
  subjectIds: z.array(UuidSchema),
  teacherProfileId: UuidSchema.nullable(),
  userProfileId: UuidSchema.nullable(),
  published: z.boolean(),
  availabilityCount: z.number().int().nonnegative(),
  activeBookingCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type AdminTutorDto = z.infer<typeof AdminTutorDtoSchema>;

/**
 * An admin availability slot — REUSES the teacher availability shape verbatim
 * (id, kind, weekday, startTime, endTime, startsAt, endsAt, capacity, active,
 * bookedCount). Aliased (not redefined) so the two surfaces never diverge.
 */
export const AdminTutorAvailabilityDtoSchema = TeacherAvailabilityDtoSchema;
export type AdminTutorAvailabilityDto = TeacherAvailabilityDto;

/**
 * Request body for `POST /remediation/tutors` (create a tutor, remediation.manage).
 * For `type:'teacher'` the `teacherProfileId` is REQUIRED (validated in-tenant
 * server-side; the linked teacher's `userProfileId` is resolved + persisted so
 * the S2 booking teaching-wall + notify resolve). For `external`/`peer` the
 * teacher link is forbidden (and stays null). `costKind` is a label only.
 */
export const CreateAdminTutorDtoSchema = z
  .object({
    type: z.enum(TUTOR_TYPE),
    costKind: z.enum(TUTOR_COST_KIND).default('free'),
    displayName: z.string().trim().min(1).max(160),
    blurb: z.string().trim().max(500).optional(),
    subjectIds: z.array(UuidSchema).min(1),
    teacherProfileId: UuidSchema.optional(),
    published: z.boolean().default(false),
  })
  .refine(
    (v) => (v.type === 'teacher' ? !!v.teacherProfileId : !v.teacherProfileId),
    {
      message:
        "teacherProfileId is required for a 'teacher' tutor and forbidden otherwise",
      path: ['teacherProfileId'],
    },
  );
export type CreateAdminTutorDto = z.infer<typeof CreateAdminTutorDtoSchema>;

/**
 * Request body for `PATCH /remediation/tutors/:id` (update / approve / retire).
 * `type` is IMMUTABLE post-create (omitted here); toggling `published` is the
 * approve/retire verb. For a teacher tutor the teacher link is NOT editable here
 * (resolved at create). All fields optional (partial update).
 */
export const UpdateAdminTutorDtoSchema = z.object({
  costKind: z.enum(TUTOR_COST_KIND).optional(),
  displayName: z.string().trim().min(1).max(160).optional(),
  blurb: z.string().trim().max(500).nullable().optional(),
  subjectIds: z.array(UuidSchema).min(1).optional(),
  published: z.boolean().optional(),
});
export type UpdateAdminTutorDto = z.infer<typeof UpdateAdminTutorDtoSchema>;

/**
 * Request body for `POST /remediation/tutors/:tutorId/availabilities` +
 * `PATCH .../:id` (admin publish/edit a slot). Same recurring/one_off .refine as
 * the teacher DTO, MINUS the teacher subject-ownership semantics — the admin
 * curates ANY tutor's slots (remediation.manage IS the authority); `tutorId` is
 * the path param (carried here for the service). The capacity-floor guard
 * (reject a capacity edit below the active-booking count on the next instance)
 * is re-applied server-side, identical to the teacher path.
 */
export const AdminUpsertAvailabilityDtoSchema = z
  .object({
    tutorId: UuidSchema,
    kind: z.enum(AVAILABILITY_KIND),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    startTime: z.string().nullable().optional(),
    endTime: z.string().nullable().optional(),
    startsAt: z.string().nullable().optional(),
    endsAt: z.string().nullable().optional(),
    capacity: z.number().int().min(1).max(50).default(1),
    active: z.boolean().default(true),
  })
  .refine(
    (v) =>
      v.kind === 'recurring_weekly'
        ? v.weekday != null && !!v.startTime
        : !!v.startsAt,
    { message: 'recurring_weekly needs weekday+startTime; one_off needs startsAt' },
  );
export type AdminUpsertAvailabilityDto = z.infer<typeof AdminUpsertAvailabilityDtoSchema>;

/**
 * The school-scoped aggregate overview (`GET /remediation/admin/overview`).
 * AGGREGATE COUNTS ONLY — per subject (openPlans, activeBookings, tutorCount) +
 * tenant totals. RGPD-clean: NO studentId, NO studentName, NO per-child row
 * anywhere (the non-stigmatising mandate). Every figure is a groupBy/count.
 */
export const AdminRemediationOverviewDtoSchema = z.object({
  bySubject: z.array(
    z.object({
      subjectId: UuidSchema,
      subjectName: z.string().nullable(),
      openPlans: z.number().int().nonnegative(),
      activeBookings: z.number().int().nonnegative(),
      tutorCount: z.number().int().nonnegative(),
    }),
  ),
  totals: z.object({
    openPlans: z.number().int().nonnegative(),
    activeBookings: z.number().int().nonnegative(),
    publishedTutors: z.number().int().nonnegative(),
  }),
});
export type AdminRemediationOverviewDto = z.infer<typeof AdminRemediationOverviewDtoSchema>;

/** The list response for `GET /remediation/admin/tutors`. */
export const AdminRemediationCatalogueDtoSchema = z.object({
  tutors: z.array(AdminTutorDtoSchema),
});
export type AdminRemediationCatalogueDto = z.infer<typeof AdminRemediationCatalogueDtoSchema>;
