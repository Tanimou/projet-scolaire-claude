import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CatalogueSlotDto,
  CatalogueTutorDto,
  RemediationCatalogueDto,
  RemediationPlanDto,
  RemediationProgressDto,
} from '@pilotage/contracts';
import { IMPROVEMENT_DELTA_THRESHOLD } from '@pilotage/contracts';
import { Prisma } from '@prisma/client';

import { TenantScopeService } from '../../shared/prisma/tenant-scope.service';

import { resolveNextSessionAt } from './session-instance';

const PLAN_INCLUDE = {
  student: { select: { firstName: true, lastName: true } },
  subject: { select: { code: true, name: true } },
} satisfies Prisma.RemediationPlanInclude;

type PlanFull = Prisma.RemediationPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

/** Les deux formes de lignes que le catalogue lit dans sa SECONDE portée. */
type ActiveBookingRow = { availabilityId: string; bookedBy: string };
type MineBookingRow = { id: string; availabilityId: string };

/**
 * Captured baseline figure for a (student, subject) at plan-promotion time — the
 * anchor the S3 progress strip frames the trend delta against. Read snapshot-first
 * (the E6 `StudentSubjectSnapshot` year row) with a live fall-through; a miss is
 * never an error (both fields degrade to null → the strip shows "en attente").
 */
interface SubjectBaseline {
  avg: number | null;
  trendDelta: number | null;
}

/**
 * E7-S1 — Remediation & Tutoring loop service.
 *
 * Two parent-facing capabilities, both tenant-scoped + behind the caller's
 * guardianship wall (re-checked in the controller BEFORE every write/read):
 *  - `promotePlan` — promote an alert's recommendation into a tracked, idempotent
 *    `RemediationPlan` (the E1-S3 MeetingRequest promotion discipline: server-derived
 *    student/subject from the alert, baseline captured from the E6 snapshot, an
 *    append-only `remediation.plan_created` audit row alongside the queryable row).
 *  - `catalogue` — the read-only aggregate of published, tenant-scoped, subject-
 *    matching tutors with their open slots (no N+1, no booking verb yet).
 *
 * NO booking write path exists in S1 — provably no over-booking surface (the
 * Booking/TutorAvailability tables exist with no write path; the booking verb +
 * the ADR-020 concurrency guard arrive in S2).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ S-E01-1j — LE CINQUIÈME MODULE CONVERTI, ET LE SECOND SANS AUCUNE        │
 * │ CONNEXION PROPRIÉTAIRE (ADR-057 §D4, appliqué)                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `PrismaService` n'est plus injecté ICI. Les VINGT-TROIS sites d'appel de ce
 * fichier passent tous par `TenantScopeService.run(args.tenantId, tx => …)`,
 * donc cette classe ne DÉTIENT plus de référence au client propriétaire : ce
 * n'est pas une convention de revue qu'un relecteur futur pourrait manquer,
 * c'est une propriété du CONSTRUCTEUR. Le tenant est TOUJOURS `args.tenantId`,
 * la valeur dérivée du serveur déjà présente sur chaque signature — jamais
 * `alert.tenantId` ni `plan.tenantId`, ce qui ferait de la clé de portée une
 * fonction de la donnée que la portée est censée filtrer.
 *
 * Les gardes `tenantId:` explicites de chaque `where` RESTENT. Elles ne sont pas
 * rendues redondantes par RLS : sur un déploiement où `DATABASE_URL_APP` n'est
 * pas déclarée, `run` s'exécute sur la connexion du PROPRIÉTAIRE (ADR-056), qui
 * échappe à ses propres policies. Les retirer ferait de l'isolation une
 * propriété du fichier d'environnement d'UN déploiement.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ADR-058 §D1 — UNE ERREUR RATTRAPÉE DOIT SORTIR DE SA PORTÉE              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `withTenant` ouvre une transaction INTERACTIVE. Toute erreur l'AVORTE, et
 * chaque instruction suivante sur le même `tx` échoue en `25P02` (« current
 * transaction is aborted »). Ce fichier est le PREMIER converti qui RATTRAPE des
 * erreurs Prisma et CONTINUE — les quatre modules précédents n'en rattrapaient
 * aucune. La règle qu'il pose, et que trois sites appliquent :
 *
 *   le `try {` s'ouvre AVANT `await this.scope.run(…)`, le `catch` se ferme APRÈS,
 *   et l'instruction de RÉCUPÉRATION ouvre une portée FRAÎCHE.
 *
 *  1. `promotePlan` — P2002 sur `create` → la relecture du gagnant (portée 4/4) ;
 *  2. `reopenPlan`  — P2002 sur `updateMany` → la sentinelle `conflict_open_exists` ;
 *  3. `readSubjectAverage` — échec du snapshot → retombée sur les notes vives.
 *
 * Le cas 3 est une exigence de CORRECTION, pas de style : une portée unique
 * couvrant les deux instructions transformerait une dégradation gracieuse
 * DÉLIBÉRÉE en `{avg:null}` dur. Et aucun test unitaire à faux client ne peut
 * l'attraper — un faux `run` qui appelle `fn(prisma)` n'a pas de transaction à
 * avorter. La propriété n'est donc prouvable que LEXICALEMENT (PF-247).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI LE LECTEUR PARTAGÉ OUVRE SA PROPRE PORTÉE (ADR-057 §D2)        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `readSubjectAverage` / `computeLiveSubjectBaseline` sont appelés UNE fois
 * depuis `captureSubjectBaseline` (chemin promote) et une fois PAR PLAN OUVERT
 * depuis la boucle de `remediationProgress`. La portée est ouverte DANS le
 * helper : un seul site d'appel textuel, appelé N fois. L'inliner aux points
 * d'appel achèterait un numérateur plus haut en GROSSISSANT le corpus — le
 * défaut d'inflation de métrique qu'ADR-057 §D2 nomme. La boucle de
 * `remediationProgress` n'est PAS enveloppée dans une portée extérieure :
 * `portée tardive, fermeture précoce`, et une portée extérieure tiendrait N
 * lectures non bornées dans une seule transaction de 5 s.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUI RESTE DEHORS, ET CE QUE CE FICHIER NE PRÉTEND PAS                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Les murs ABAC de garde (`canAccessStudent`) et les `@Permissions` vivent dans
 * `remediation.controller.ts` et tournent AVANT ces méthodes, sur la connexion
 * du PROPRIÉTAIRE, hors de toute portée. Le contrôleur garde son propre
 * `PrismaService` (sa lecture d'alerte de garde + ses lignes d'audit) : « le
 * constructeur est la preuve » se dit de CETTE CLASSE, pas du module.
 * `booking.service.ts`, `teacher-remediation.service.ts`,
 * `admin-remediation.service.ts` et `booking-index.bootstrap.ts` gardent aussi
 * le leur — ils ne sont PAS ajoutés à `ENUMERATED_OUTSIDE_SCOPE`, dont la seule
 * raison disponible serait « pas encore converti » (ADR-048 §D6 : une liste de
 * RAISONS structurelles, pas de travail en attente).
 *
 * LIMITE NOMMÉE (PF-248) : `readSubjectAverage`, `computeLiveSubjectBaseline` et
 * `isTeacherOfStudent` avalent TOUTE erreur, y compris désormais un refus de
 * portée (503 `refused_unusable`) ou un 42501. Le comportement est INCHANGÉ par
 * cette tranche (AC-14 l'exige byte-à-byte), mais la conséquence est nouvelle et
 * doit être écrite : pendant une fenêtre de mauvaise configuration, un plan
 * promu naîtrait avec un `baseline_avg` nul DÉFINITIF, et le mur enseignant
 * répondrait « cet enseignant n'enseigne pas à cet élève ». Le resserrement de
 * ces trois `catch` est une tranche à part, pas un effet de bord de celle-ci.
 *
 * RETOUR ARRIÈRE : remplacer les `this.scope.run(...)` par un client
 * propriétaire ramène le service comme il était. Aucun changement de schéma,
 * aucune migration, aucun intercepteur — il n'y en a jamais eu.
 */
@Injectable()
export class RemediationService {
  private readonly logger = new Logger(RemediationService.name);

  constructor(private readonly scope: TenantScopeService) {}

  /**
   * Promote an alert into an OPEN remediation plan. Idempotent per
   * (tenant, student, subject, status=open): re-promoting the same diagnosis
   * reuses the existing open plan (no duplicate row, no re-baseline). The caller
   * MUST have passed guardianship ABAC on the alert's student before invoking —
   * the controller checks `canAccessStudent` BEFORE this write.
   *
   * Returns the plan DTO + whether it was freshly created (for the audit row).
   *
   * S-E01-1j — QUATRE portées SÉQUENTIELLES, jamais imbriquées, la dernière
   * ouverte UNIQUEMENT sur le chemin P2002 (ADR-058 §D1).
   */
  async promotePlan(args: {
    tenantId: string;
    schoolId: string | null;
    alertId: string;
    userProfileId: string;
    objective?: string;
  }): Promise<{ plan: RemediationPlanDto; created: boolean }> {
    // PORTÉE 1/4 — resolve the diagnosis from the alert (server-derived, never
    // client-supplied). Tenant-scoped: an alert outside the caller's tenant 404s
    // (never leaks). Les deux rejets (404 / 422) sont levés DEHORS : la portée
    // est déjà fermée, donc aucune instruction ne suit une erreur.
    const alert = await this.scope.run(args.tenantId, async (tx) =>
      tx.alertInstance.findFirst({
        where: { id: args.alertId, tenantId: args.tenantId },
        select: { id: true, studentId: true, subjectId: true, schoolId: true },
      }),
    );
    if (!alert) throw new NotFoundException('Alert not found');
    if (!alert.subjectId) {
      // A non-subject alert (e.g. HIGH_ABSENCE) cannot seed a subject-scoped plan.
      // 422 (not 404): the alert exists and is accessible, but its shape can't be
      // remediated — a deterministic, non-leaking rejection (spec FR/AC: "422 on
      // null-subject alert"), never a 500 / NOT-NULL crash on the plan's subjectId.
      throw new UnprocessableEntityException('Cette alerte ne cible pas une matière');
    }
    // Capturés APRÈS le rétrécissement : une propriété rétrécie ne survit pas à
    // l'entrée dans un callback, et ces deux valeurs traversent trois portées.
    const studentId = alert.studentId;
    const subjectId = alert.subjectId;

    // PORTÉE 2/4 — Idempotency: reuse an existing OPEN plan for (tenant, student, subject).
    const existing = await this.scope.run(args.tenantId, async (tx) =>
      tx.remediationPlan.findFirst({
        where: {
          tenantId: args.tenantId,
          studentId,
          subjectId,
          status: 'open',
        },
        include: PLAN_INCLUDE,
      }),
    );
    if (existing) {
      return { plan: this.toPlanDto(existing), created: false };
    }

    // Le lecteur partagé ouvre SA propre portée (ADR-057 §D2) : il tourne ENTRE
    // deux portées de cette méthode, jamais à l'intérieur de l'une d'elles.
    const baseline = await this.captureSubjectBaseline({
      tenantId: args.tenantId,
      studentId,
      subjectId,
    });

    // Create the plan. Catch P2002 (a concurrent promote raced us to the open-plan
    // unique) and reuse the winning row — the write stays idempotent under races.
    //
    // ADR-058 §D1 — le `try` s'ouvre AVANT la portée 3/4 et le `catch` se ferme
    // APRÈS : la transaction de la création est AVORTÉE par la violation
    // d'unicité, donc la relecture du gagnant ne peut PAS y être émise (elle
    // rendrait 25P02, pas la ligne voulue). Elle ouvre une portée FRAÎCHE.
    let row: PlanFull;
    let created = true;
    try {
      // PORTÉE 3/4 — l'écriture. C'est le `WITH CHECK` de la policy qui refuse
      // un GUC étranger, et `INSERT … RETURNING` (l'`include`) exige aussi
      // `SELECT` sur `remediation_plan` (ADR-058 §D5).
      row = await this.scope.run(args.tenantId, async (tx) =>
        tx.remediationPlan.create({
          data: {
            tenantId: args.tenantId,
            schoolId: alert.schoolId ?? args.schoolId,
            studentId,
            subjectId,
            alertId: alert.id,
            status: 'open',
            objective: args.objective ?? null,
            baselineAvg: baseline.avg,
            baselineTrendDelta: baseline.trendDelta,
            createdBy: args.userProfileId,
          },
          include: PLAN_INCLUDE,
        }),
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // PORTÉE 4/4 — FRAÎCHE, ouverte dans le `catch`, après que la
        // transaction fautive a été fermée par la propagation de l'erreur.
        const winner = await this.scope.run(args.tenantId, async (tx) =>
          tx.remediationPlan.findFirst({
            where: {
              tenantId: args.tenantId,
              studentId,
              subjectId,
              status: 'open',
            },
            include: PLAN_INCLUDE,
          }),
        );
        if (!winner) throw err;
        row = winner;
        created = false;
      } else {
        throw err;
      }
    }

    return { plan: this.toPlanDto(row), created };
  }

  /** Fetch a single plan, tenant-scoped. The caller re-checks guardianship on the
   * plan's student in the controller BEFORE this read (404-before-403). */
  async getPlan(args: {
    tenantId: string;
    planId: string;
  }): Promise<{ dto: RemediationPlanDto; studentId: string } | null> {
    const row = await this.scope.run(args.tenantId, async (tx) =>
      tx.remediationPlan.findFirst({
        where: { id: args.planId, tenantId: args.tenantId },
        include: PLAN_INCLUDE,
      }),
    );
    if (!row) return null;
    return { dto: this.toPlanDto(row), studentId: row.studentId };
  }

  /** A parent's plans for a given student (tenant-scoped). Caller has already
   * passed guardianship ABAC on the student. */
  async listPlansForStudent(args: {
    tenantId: string;
    studentId: string;
  }): Promise<RemediationPlanDto[]> {
    const rows = await this.scope.run(args.tenantId, async (tx) =>
      tx.remediationPlan.findMany({
        where: { tenantId: args.tenantId, studentId: args.studentId },
        include: PLAN_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((r) => this.toPlanDto(r));
  }

  /**
   * E7-S6 — Mark an OPEN plan complete (kind + reversible). `resolution`
   * discriminates the celebratory `met` ("objectif atteint") from the
   * administrative `closed` ("clôturé sans suite"). The flip is a
   * from-status-guarded `updateMany` (`where:{ id, tenantId, status:'open' }`,
   * the ADR-020 idiom) so a concurrent double-close matches 0 rows on the loser →
   * deterministic 409, never last-writer-wins / never a 500. Sets `closedAt=now()`
   * + `closedBy`. The caller (controller) has already run guardianship ABAC (parent)
   * or is `remediation.manage`-gated (admin) BEFORE this write.
   *
   * Returns the updated plan DTO, or null when nothing was open to close (already
   * met/closed → the controller maps to a kind 409).
   *
   * S-E01-1j — DEUX portées SÉQUENTIELLES. La relecture n'est PAS fusionnée avec
   * l'écriture : deux instructions non transactionnelles aujourd'hui, deux
   * portées courtes demain — le comportement observable ne bouge pas (AC-14).
   */
  async closePlan(args: {
    tenantId: string;
    planId: string;
    resolution: 'met' | 'closed';
    userProfileId: string;
  }): Promise<{ plan: RemediationPlanDto } | null> {
    const result = await this.scope.run(args.tenantId, async (tx) =>
      tx.remediationPlan.updateMany({
        where: { id: args.planId, tenantId: args.tenantId, status: 'open' },
        data: {
          status: args.resolution,
          closedAt: new Date(),
          closedBy: args.userProfileId,
        },
      }),
    );
    if (result.count === 0) return null;

    const row = await this.scope.run(args.tenantId, async (tx) =>
      tx.remediationPlan.findFirst({
        where: { id: args.planId, tenantId: args.tenantId },
        include: PLAN_INCLUDE,
      }),
    );
    if (!row) return null;
    return { plan: this.toPlanDto(row) };
  }

  /**
   * E7-S6 — Reopen a met/closed plan back to `open` (the reversibility). A
   * from-status-guarded `updateMany` (`where:{ id, tenantId, status:{in:['met',
   * 'closed']} }`) clears `closedAt`/`closedBy`. Idempotent/safe: reopening an
   * already-open plan matches 0 rows → the controller returns a kind 409, never a
   * 500. MUST respect the open-plan `@@unique([tenantId, studentId, subjectId,
   * status])`: if a NEW open plan for the same (student, subject) was created after
   * this one closed, reopening would collide on P2002 → we surface a sentinel
   * `'conflict_open_exists'` so the controller returns a kind 409 ("un autre plan
   * est déjà ouvert pour cette matière"), never a 500.
   *
   * Returns the reopened plan DTO; `null` = nothing reopenable (already open);
   * `'conflict_open_exists'` = another open plan blocks the reopen.
   *
   * ADR-058 §D1 — le `try` entoure la PORTÉE, pas l'intérieur du callback : la
   * sentinelle est produite APRÈS la fin de la transaction avortée.
   */
  async reopenPlan(args: {
    tenantId: string;
    planId: string;
    userProfileId: string;
  }): Promise<{ plan: RemediationPlanDto } | null | 'conflict_open_exists'> {
    try {
      const result = await this.scope.run(args.tenantId, async (tx) =>
        tx.remediationPlan.updateMany({
          where: {
            id: args.planId,
            tenantId: args.tenantId,
            status: { in: ['met', 'closed'] },
          },
          data: { status: 'open', closedAt: null, closedBy: null },
        }),
      );
      if (result.count === 0) return null;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return 'conflict_open_exists';
      }
      throw err;
    }

    const row = await this.scope.run(args.tenantId, async (tx) =>
      tx.remediationPlan.findFirst({
        where: { id: args.planId, tenantId: args.tenantId },
        include: PLAN_INCLUDE,
      }),
    );
    if (!row) return null;
    return { plan: this.toPlanDto(row) };
  }

  /**
   * Load a plan tenant-scoped for the close/reopen verbs — returns the student +
   * status the controller needs for guardianship ABAC (parent path) BEFORE the
   * write (404-before-403). Null on miss (404).
   */
  async loadPlanForLifecycle(args: {
    tenantId: string;
    planId: string;
  }): Promise<{ studentId: string; status: string } | null> {
    return this.scope.run(args.tenantId, async (tx) =>
      tx.remediationPlan.findFirst({
        where: { id: args.planId, tenantId: args.tenantId },
        select: { studentId: true, status: true },
      }),
    );
  }

  /**
   * E7-S3 — the parent remediation progress strip payload: one entry per OPEN
   * (`status:'open'`) plan for the student, carrying the measured-improvement
   * payoff the dashboard strip renders. Composed into the parent-dashboard
   * aggregate by `AnalyticsService` (best-effort; a throw degrades to `[]` so the
   * strip never errors the dashboard).
   *
   * Bounded work, no new class scan (FR2/FR3/FR10):
   *  - ONE `remediationPlan.findMany` (open plans, tenant+student scoped).
   *  - per plan, the SHARED {@link readSubjectAverage} (snapshot point-read + at most
   *    one per-subject grade average on fall-through) — the SAME reader the baseline
   *    used, so `current − baseline` can't diverge from the captured anchor.
   *  - ONE grouped `booking.findMany` over ALL the open plans (no per-plan N+1) for
   *    `sessionsPlanned`/`sessionsDone`/`nextSessionAt`.
   *
   * `trendDelta = round(currentAvg − baselineAvg, 2)` only when BOTH are non-null,
   * else null (FR2 / PM-4: a null baseline NEVER fabricates a `current − 0` positive
   * delta). `improved = trendDelta != null && trendDelta >= IMPROVEMENT_DELTA_THRESHOLD`
   * (the shared E3 `1.5`, FR4 / PM-5: noise below threshold stays calm).
   *
   * S-E01-1j — DEUX portées, et AUCUNE autour de la boucle. Une portée extérieure
   * rendrait la portée interne du lecteur partagé no-op (réutilisation du cadre)
   * ET tiendrait N lectures non bornées dans une transaction interactive de 5 s.
   */
  async remediationProgress(args: {
    tenantId: string;
    studentId: string;
  }): Promise<RemediationProgressDto[]> {
    const plans = await this.scope.run(args.tenantId, async (tx) =>
      tx.remediationPlan.findMany({
        where: { tenantId: args.tenantId, studentId: args.studentId, status: 'open' },
        include: PLAN_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (plans.length === 0) return [];

    // ONE grouped Booking query over every open plan (no per-plan N+1). Empty
    // booking tables (S2 db push pending) → no rows → counts 0 / nextSessionAt null,
    // and the strip still renders the trend.
    const now = new Date();
    const planIds = plans.map((p) => p.id);
    const bookings = await this.scope.run(args.tenantId, async (tx) =>
      tx.booking.findMany({
        where: { tenantId: args.tenantId, planId: { in: planIds } },
        select: { planId: true, status: true, sessionAt: true },
      }),
    );

    const planned = new Map<string, number>();
    const done = new Map<string, number>();
    const nextAt = new Map<string, Date>();
    for (const b of bookings) {
      if (b.status === 'requested' || b.status === 'confirmed') {
        planned.set(b.planId, (planned.get(b.planId) ?? 0) + 1);
        // soonest FUTURE active instance only (PM-8: never a past "prochaine").
        if (b.sessionAt >= now) {
          const cur = nextAt.get(b.planId);
          if (!cur || b.sessionAt < cur) nextAt.set(b.planId, b.sessionAt);
        }
      } else if (b.status === 'completed') {
        done.set(b.planId, (done.get(b.planId) ?? 0) + 1);
      }
    }

    const out: RemediationProgressDto[] = [];
    for (const p of plans) {
      const baselineAvg = p.baselineAvg != null ? Number(p.baselineAvg) : null;
      // Current subject average via the SAME shared reader the baseline used.
      // Le lecteur ouvre SA portée : la boucle n'en tient aucune (aucune lecture
      // de booking n'est acquise ici non plus — le groupé ci-dessus est le seul).
      const current = await this.readSubjectAverage({
        tenantId: args.tenantId,
        studentId: args.studentId,
        subjectId: p.subjectId,
      });
      const currentAvg = current.avg;
      const trendDelta =
        baselineAvg != null && currentAvg != null
          ? Math.round((currentAvg - baselineAvg) * 100) / 100
          : null;
      out.push({
        planId: p.id,
        subjectId: p.subjectId,
        subjectCode: p.subject?.code ?? null,
        subjectName: p.subject?.name ?? null,
        objective: p.objective,
        baselineAvg,
        currentAvg,
        trendDelta,
        improved: trendDelta != null && trendDelta >= IMPROVEMENT_DELTA_THRESHOLD,
        sessionsPlanned: planned.get(p.id) ?? 0,
        sessionsDone: done.get(p.id) ?? 0,
        nextSessionAt: nextAt.get(p.id)?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      });
    }
    return out;
  }

  /**
   * Read-only catalogue: published, tenant-scoped tutors that cover `subjectId`,
   * each with their active availability slots. One query + a bounded include — no
   * N+1. The plan the catalogue is browsed from is guardianship-walled by the
   * controller; the catalogue itself is school-public to the school's parents
   * (only `published` rows of the caller's tenant are ever returned).
   *
   * S-E01-1j — DEUX portées, avec le calcul PUR `resolveNextSessionAt` ENTRE les
   * deux, hors de toute transaction. Chacune tient au plus DEUX instructions,
   * sous le budget de trois d'ADR-049 §D4 — un budget que cette tranche
   * n'approche pas et NE ré-amende pas.
   */
  async catalogue(args: {
    tenantId: string;
    schoolId: string | null;
    subjectId: string;
    /** The caller's UserProfile id — to surface their own existing active booking
     * per slot (idempotency hint for the "Réservé" badge). */
    userProfileId?: string;
  }): Promise<RemediationCatalogueDto> {
    // PORTÉE A — le libellé de la matière + les tuteurs avec leurs créneaux.
    // L'`include: { availabilities }` TRAVERSE `tutor_availability` : sous RLS
    // c'est une table LUE, d'où son privilège propre (PF-246 / ADR-058 §D3).
    const { subject, tutors } = await this.scope.run(args.tenantId, async (tx) => {
      const subjectRow = await tx.subject.findFirst({
        where: { id: args.subjectId, tenantId: args.tenantId },
        select: { name: true },
      });
      const tutorRows = await tx.tutor.findMany({
        where: {
          tenantId: args.tenantId,
          ...(args.schoolId ? { schoolId: args.schoolId } : {}),
          published: true,
          subjectIds: { has: args.subjectId },
        },
        include: {
          availabilities: {
            where: { active: true },
            orderBy: [{ startsAt: 'asc' }, { weekday: 'asc' }, { startTime: 'asc' }],
          },
        },
        orderBy: { displayName: 'asc' },
      });
      return { subject: subjectRow, tutors: tutorRows };
    });

    // E7-S2: resolve, per active slot, its NEXT concrete dated instance, then
    // compute the live remaining-seat count + the caller's own active booking id
    // in ONE bounded grouped Booking query (never per-slot N+1). A slot whose next
    // instance can't be resolved (a past one_off) renders nextSessionAt=null /
    // remainingSeats=0 ("Indisponible").
    //
    // CE CALCUL EST PUR et tourne ENTRE les deux portées : une boucle CPU à
    // l'intérieur d'une transaction interactive la ferait courir contre le
    // timeout de 5 s pour rien.
    const now = new Date();
    const slotInstances = new Map<string, { availabilityId: string; sessionAt: Date }>();
    for (const t of tutors) {
      for (const a of t.availabilities) {
        const next = resolveNextSessionAt(
          { kind: a.kind, weekday: a.weekday, startTime: a.startTime, startsAt: a.startsAt },
          now,
        );
        if (next) slotInstances.set(a.id, { availabilityId: a.id, sessionAt: next });
      }
    }

    // PORTÉE B — one grouped query: active bookings (requested|confirmed) for every
    // resolved (availabilityId, sessionAt) instance. We OR the precise instance keys
    // so the count is exact (not "any sessionAt for this slot"). La relecture des
    // lignes DU CALLEUR (`mineRows`) reste conditionnelle et partage cette portée :
    // deux instructions, pas trois.
    const instanceList = [...slotInstances.values()];
    const {
      activeBookings,
      mineRows,
    }: { activeBookings: ActiveBookingRow[]; mineRows: MineBookingRow[] } =
      instanceList.length > 0
        ? await this.scope.run(args.tenantId, async (tx) => {
            const active = await tx.booking.findMany({
              where: {
                tenantId: args.tenantId,
                status: { in: ['requested', 'confirmed'] },
                OR: instanceList.map((i) => ({
                  availabilityId: i.availabilityId,
                  sessionAt: i.sessionAt,
                })),
              },
              select: { availabilityId: true, bookedBy: true },
            });
            // Re-read the booking ids only for the caller's own rows (small set), to
            // surface myBookingId without widening the grouped query.
            const mine =
              active.length > 0 && args.userProfileId
                ? await tx.booking.findMany({
                    where: {
                      tenantId: args.tenantId,
                      bookedBy: args.userProfileId,
                      status: { in: ['requested', 'confirmed'] },
                      OR: instanceList.map((i) => ({
                        availabilityId: i.availabilityId,
                        sessionAt: i.sessionAt,
                      })),
                    },
                    select: { id: true, availabilityId: true },
                  })
                : [];
            return { activeBookings: active, mineRows: mine };
          })
        : { activeBookings: [], mineRows: [] };

    const seatTaken = new Map<string, number>();
    const myBooking = new Map<string, string>();
    if (activeBookings.length > 0) {
      for (const b of activeBookings) {
        seatTaken.set(b.availabilityId, (seatTaken.get(b.availabilityId) ?? 0) + 1);
      }
      for (const m of mineRows) myBooking.set(m.availabilityId, m.id);
    }

    return {
      subjectId: args.subjectId,
      subjectName: subject?.name ?? null,
      tutors: tutors.map((t) =>
        this.toCatalogueTutorDto(t, slotInstances, seatTaken, myBooking),
      ),
    };
  }

  // ----- baseline ------------------------------------------------------------

  /**
   * Capture the subject baseline figure at promotion time. Thin wrapper over the
   * SHARED {@link readSubjectAverage} reader (the ONE code path), so the figure the
   * S3 progress strip anchors against is read with byte-identical logic to the
   * figure it later measures the current average with — no divergence is possible.
   */
  private async captureSubjectBaseline(args: {
    tenantId: string;
    studentId: string;
    subjectId: string;
  }): Promise<SubjectBaseline> {
    return this.readSubjectAverage(args);
  }

  /**
   * The single, shared snapshot-first / live-fall-through subject-average reader.
   * Used by BOTH the baseline capture (at promote time) AND the S3 progress read
   * (the "current" figure for the trend delta) — extracting it guarantees ONE code
   * path, so the baseline anchor and the current measure can never diverge.
   *
   * Snapshot-first (the E6 `StudentSubjectSnapshot` YEAR row, `termId=null`, carries
   * the materialised average + trendDelta), with a live fall-through (a simple
   * published-grade average for the subject normalised to /20). A miss/throw on
   * either path degrades to `{ avg: null, trendDelta: null }` — never an error,
   * never blocks the caller (the strip then shows "en attente des prochaines notes").
   * NO new class-wide scan: a single per-subject point-read, then at most one
   * per-subject grade average on the fall-through.
   *
   * ADR-058 §D1 — LA PORTÉE DU SNAPSHOT ET CELLE DE LA RETOMBÉE SONT SÉPARÉES, et
   * c'est une exigence de CORRECTION. Le `try/catch` est DEHORS : l'erreur du
   * snapshot propage, ferme sa transaction, et la retombée `grade.findMany`
   * ouvre la sienne. Dans une portée unique, l'échec du snapshot aurait avorté la
   * transaction et la retombée aurait rendu `25P02` — transformant une
   * dégradation gracieuse DÉLIBÉRÉE en `{avg:null}` dur.
   */
  private async readSubjectAverage(args: {
    tenantId: string;
    studentId: string;
    subjectId: string;
  }): Promise<SubjectBaseline> {
    // Snapshot-first: the year-level (termId=null) per-subject snapshot row.
    try {
      const snap = await this.scope.run(args.tenantId, async (tx) =>
        tx.studentSubjectSnapshot.findFirst({
          where: {
            tenantId: args.tenantId,
            studentId: args.studentId,
            subjectId: args.subjectId,
            termId: null,
          },
          select: { average: true, trendDelta: true },
        }),
      );
      if (snap && snap.average != null) {
        return {
          avg: Number(snap.average),
          trendDelta: snap.trendDelta != null ? Number(snap.trendDelta) : null,
        };
      }
    } catch (err) {
      this.logger.debug(
        `baseline snapshot read failed (student=${args.studentId}, subject=${args.subjectId}); falling through to live: ${String(err)}`,
      );
    }

    // Live fall-through: the published, non-absent grade average for the subject,
    // normalised to /20. No new metric — the same notion the dashboard uses.
    return this.computeLiveSubjectBaseline(args);
  }

  /**
   * ADR-058 §D3 — le `where` TRAVERSE `assessment -> teachingAssignment` et le
   * `select` descend `assessment.maxScore` : sous RLS ce sont TROIS tables lues
   * (`grade`, `assessment`, `teaching_assignment`), pas une. Un filtre
   * relationnel est une LECTURE, exactement comme un include (PF-246).
   */
  private async computeLiveSubjectBaseline(args: {
    tenantId: string;
    studentId: string;
    subjectId: string;
  }): Promise<SubjectBaseline> {
    try {
      const grades = await this.scope.run(args.tenantId, async (tx) =>
        tx.grade.findMany({
          where: {
            tenantId: args.tenantId,
            studentId: args.studentId,
            status: 'published',
            isAbsent: false,
            value: { not: null },
            assessment: { teachingAssignment: { subjectId: args.subjectId } },
          },
          select: { value: true, assessment: { select: { maxScore: true } } },
        }),
      );
      if (grades.length === 0) return { avg: null, trendDelta: null };
      let sum = 0;
      let n = 0;
      for (const g of grades) {
        const max = Number(g.assessment.maxScore ?? 20) || 20;
        if (g.value == null) continue;
        sum += (Number(g.value) / max) * 20;
        n += 1;
      }
      const avg = n === 0 ? null : Math.round((sum / n) * 100) / 100;
      return { avg, trendDelta: null };
    } catch (err) {
      this.logger.debug(
        `baseline live read failed (student=${args.studentId}, subject=${args.subjectId}); baseline null: ${String(err)}`,
      );
      return { avg: null, trendDelta: null };
    }
  }

  // ----- mappers -------------------------------------------------------------

  private toPlanDto(row: PlanFull): RemediationPlanDto {
    return {
      id: row.id,
      status: row.status,
      studentId: row.studentId,
      studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
      subjectId: row.subjectId,
      subjectCode: row.subject?.code ?? null,
      subjectName: row.subject?.name ?? null,
      alertId: row.alertId,
      objective: row.objective,
      baselineAvg: row.baselineAvg != null ? Number(row.baselineAvg) : null,
      baselineTrendDelta:
        row.baselineTrendDelta != null ? Number(row.baselineTrendDelta) : null,
      // No booking write in S1 — counts are 0 (kept in the shape for S2/S3).
      sessionsPlanned: 0,
      sessionsDone: 0,
      createdAt: row.createdAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
    };
  }

  private toCatalogueTutorDto(
    t: Prisma.TutorGetPayload<{ include: { availabilities: true } }>,
    slotInstances: Map<string, { availabilityId: string; sessionAt: Date }>,
    seatTaken: Map<string, number>,
    myBooking: Map<string, string>,
  ): CatalogueTutorDto {
    return {
      id: t.id,
      type: t.type,
      costKind: t.costKind,
      displayName: t.displayName,
      blurb: t.blurb,
      subjectIds: t.subjectIds,
      slots: t.availabilities.map((a): CatalogueSlotDto => {
        const instance = slotInstances.get(a.id) ?? null;
        const taken = seatTaken.get(a.id) ?? 0;
        const remaining = instance ? Math.max(0, a.capacity - taken) : 0;
        return {
          id: a.id,
          kind: a.kind,
          weekday: a.weekday,
          startTime: a.startTime,
          endTime: a.endTime,
          startsAt: a.startsAt?.toISOString() ?? null,
          endsAt: a.endsAt?.toISOString() ?? null,
          capacity: a.capacity,
          remainingSeats: remaining,
          nextSessionAt: instance ? instance.sessionAt.toISOString() : null,
          myBookingId: myBooking.get(a.id) ?? null,
        };
      }),
    };
  }

  // ----- S2 booking support reads --------------------------------------------

  /**
   * Load an availability slot tenant-scoped, incl. the tutor's linkage fields the
   * booking controller needs for the E2 teaching wall + the capacity guard. Used
   * by the booking verb BEFORE the write. Returns null on miss/inactive (404).
   *
   * S-E01-1j — le `select` imbriqué `tutor: { … }` TRAVERSE `tutor` : deux tables
   * lues pour une instruction, donc `tutor.SELECT` est dû ici aussi, pas
   * seulement au catalogue (ADR-057 §D1).
   */
  async loadBookableAvailability(args: {
    tenantId: string;
    availabilityId: string;
  }): Promise<{
    id: string;
    tutorId: string;
    capacity: number;
    kind: 'recurring_weekly' | 'one_off';
    weekday: number | null;
    startTime: string | null;
    startsAt: Date | null;
    tutorTeacherProfileId: string | null;
    tutorUserProfileId: string | null;
    tutorPublished: boolean;
  } | null> {
    const a = await this.scope.run(args.tenantId, async (tx) =>
      tx.tutorAvailability.findFirst({
        where: { id: args.availabilityId, tenantId: args.tenantId, active: true },
        select: {
          id: true,
          tutorId: true,
          capacity: true,
          kind: true,
          weekday: true,
          startTime: true,
          startsAt: true,
          tutor: {
            select: { teacherProfileId: true, userProfileId: true, published: true },
          },
        },
      }),
    );
    if (!a) return null;
    return {
      id: a.id,
      tutorId: a.tutorId,
      capacity: a.capacity,
      kind: a.kind,
      weekday: a.weekday,
      startTime: a.startTime,
      startsAt: a.startsAt,
      tutorTeacherProfileId: a.tutor.teacherProfileId,
      tutorUserProfileId: a.tutor.userProfileId,
      tutorPublished: a.tutor.published,
    };
  }

  /**
   * Load a plan tenant-scoped for the booking verb — returns the student + status
   * the controller needs (guardianship ABAC on the student; plan must be open).
   * Null on miss (404). The controller re-checks guardianship BEFORE the write.
   */
  async loadPlanForBooking(args: {
    tenantId: string;
    planId: string;
  }): Promise<{ studentId: string; status: string; schoolId: string | null } | null> {
    return this.scope.run(args.tenantId, async (tx) =>
      tx.remediationPlan.findFirst({
        where: { id: args.planId, tenantId: args.tenantId },
        select: { studentId: true, status: true, schoolId: true },
      }),
    );
  }

  /**
   * The E2 teaching wall, inlined to avoid a circular MessagingModule dependency
   * (mirrors messaging.service.ts isTeacherOfStudent exactly): the student's active
   * Enrollment in the active academic year → a TeachingAssignment for that
   * (classSectionId, academicYearId) whose teacherProfile.userProfileId === the
   * tutor's userProfileId. Returns false (never throws) when there is no active
   * enrollment or no matching assignment — a lapsed/absent wall → the controller
   * 403s. Only called for a teacher-linked tutor (userProfileId != null).
   *
   * S-E01-1j — UNE portée pour les DEUX instructions : la seconde DÉPEND de la
   * première et le `catch` n'émet AUCUNE instruction, donc la règle ADR-058 §D1
   * est satisfaite avec une portée unique. Le `try/catch` de dégradation reste
   * DEHORS ; le message `logger.error` est inchangé et le verdict `false` est
   * byte-identique pour chaque appelant (AC-14). Les deux `where` TRAVERSENT
   * `academic_year` et `teacher_profile` : deux relations, donc deux tables lues
   * que le matcher dérivé ne peut PAS voir.
   */
  async isTeacherOfStudent(args: {
    tenantId: string;
    teacherUserProfileId: string;
    studentId: string;
  }): Promise<boolean> {
    try {
      return await this.scope.run(args.tenantId, async (tx) => {
        const enrollment = await tx.enrollment.findFirst({
          where: {
            tenantId: args.tenantId,
            studentId: args.studentId,
            status: 'active',
            academicYear: { status: 'active' },
          },
          orderBy: { enrolledAt: 'desc' },
          select: { classSectionId: true, academicYearId: true },
        });
        if (!enrollment) return false;

        const assignment = await tx.teachingAssignment.findFirst({
          where: {
            tenantId: args.tenantId,
            classSectionId: enrollment.classSectionId,
            academicYearId: enrollment.academicYearId,
            teacherProfile: { userProfileId: args.teacherUserProfileId },
          },
          select: { id: true },
        });
        return assignment != null;
      });
    } catch (err) {
      this.logger.error(
        `isTeacherOfStudent failed (student ${args.studentId}, teacher ${args.teacherUserProfileId}): ${(err as Error).message}`,
      );
      return false;
    }
  }
}
