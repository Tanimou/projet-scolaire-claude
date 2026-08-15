import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Resolves / auto-provisions TeacherProfile records.
 *
 * A teacher in Pilotage is fundamentally a UserProfile with the realm role
 * `teacher`. To carry school-specific metadata (specialty, hire date, internal
 * matricule, etc.) and to be the FK target for assignments/assessments/etc.,
 * we maintain a parallel TeacherProfile per user profile.
 *
 * This service is the single source of truth for the user_profile ↔ teacher_profile
 * relationship: any module that needs a `teacherProfileId` from a JWT subject
 * should go through `resolveForUser`.
 */
@Injectable()
export class TeacherProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the TeacherProfile for the given UserProfile, creating one if absent.
   * Idempotent and safe to call on every teacher request — uses an upsert so
   * concurrent first-call requests don't violate the unique constraint.
   */
  async ensureForUser(user: {
    id: string;
    tenantId: string;
  }): Promise<{ id: string; tenantId: string; schoolId: string; userProfileId: string; active: boolean }> {
    const existing = await this.prisma.teacherProfile.findUnique({
      where: { userProfileId: user.id },
    });
    if (existing) return existing;

    // Pick the user's preferred school (or the oldest one) as the home school
    const profile = await this.prisma.userProfile.findUnique({ where: { id: user.id } });
    const prefs = (profile?.preferences as Record<string, unknown> | null) ?? {};
    const preferredSchoolId =
      typeof prefs.activeSchoolId === 'string' ? prefs.activeSchoolId : undefined;
    const school = preferredSchoolId
      ? await this.prisma.school.findFirst({ where: { id: preferredSchoolId, tenantId: user.tenantId } })
      : await this.prisma.school.findFirst({
          where: { tenantId: user.tenantId },
          orderBy: { createdAt: 'asc' },
        });
    if (!school) throw new NotFoundException('Aucune école dans le tenant pour rattacher le professeur.');

    // Upsert protects against concurrent first-call races (two parallel
    // requests both seeing no existing profile would otherwise both attempt
    // to create, and the second would fail the @@unique([userProfileId])).
    return this.prisma.teacherProfile.upsert({
      where: { userProfileId: user.id },
      update: {},
      create: {
        tenantId: user.tenantId,
        schoolId: school.id,
        userProfileId: user.id,
      },
    });
  }

  /**
   * S-E01-1e / ADR-051 §D1 — la variante LECTURE SEULE d'`ensureForUser`, pour
   * les chemins d'AUTORISATION.
   *
   * Pourquoi elle existe, et pourquoi `ensureForUser` ne pouvait pas servir.
   * `lessons.controller.ts` compare le `teacherProfileId` d'une ligne à celui de
   * l'appelant. Cette résolution doit désormais se faire AVANT d'ouvrir la
   * portée tenant (`ensureForUser` fait quatre instructions dont un `upsert` sur
   * la connexion du PROPRIÉTAIRE ; l'appeler DEPUIS la portée ferait détenir au
   * processus une connexion propriétaire ET une connexion applicative pendant
   * toute la transaction interactive — l'inverse dangereux de PF-200, invisible
   * à tout garde de compilation). Mais avancer la résolution la place AVANT la
   * garde `findUnique` : un professeur demandant une entrée INEXISTANTE ou d'un
   * AUTRE tenant déclencherait alors un `upsert` — une ÉCRITURE sur un chemin de
   * REFUS, non auditée — et pourrait recevoir `NotFoundException('Aucune école
   * dans le tenant…')` à la place de son 404 nu.
   *
   * `null` n'est PAS une erreur ici : un appelant sans profil professeur ne
   * possède AUCUNE ligne dont le `teacher_profile_id` pointe vers lui, par
   * construction de la clé étrangère. Le comparateur pur le traduit donc en
   * exactement le même 403, avec exactement le même message. Aucune provision
   * automatique n'est déclenchée par un refus.
   *
   * `tenantId` EXPLICITE bien que `userProfileId` soit `@unique` (ADR-042 §D1) :
   * sur `degraded_no_app_url` — c'est-à-dire TOUS les déploiements
   * d'aujourd'hui — le propriétaire échappe à ses propres policies et cette
   * clause est la SEULE chose qui travaille.
   *
   * Elle reste sur la connexion du PROPRIÉTAIRE, comme toute la résolution
   * d'identité (PF-199), et elle est déclarée à ce titre dans l'énumération
   * `ENUMERATED_OUTSIDE_SCOPE` de `scripts/tenant-adversarial-check.js`.
   */
  async findForUser(user: { id: string; tenantId: string }): Promise<{ id: string } | null> {
    return this.prisma.teacherProfile.findFirst({
      where: { userProfileId: user.id, tenantId: user.tenantId },
      select: { id: true },
    });
  }

  /** Look up by id, scoped to tenant. */
  async getById(id: string, tenantId: string) {
    const tp = await this.prisma.teacherProfile.findUnique({
      where: { id },
      include: { userProfile: { select: { id: true, firstName: true, lastName: true, email: true, photoUrl: true } } },
    });
    if (!tp || tp.tenantId !== tenantId) throw new NotFoundException('Professeur introuvable.');
    return tp;
  }
}
