import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type AcademicYearScope,
  resolveActiveAcademicYear,
  toAcademicYearScope,
} from '@pilotage/contracts';

import { prismaAcademicYearReader } from '../../shared/academic-year/prisma-academic-year-reader';
import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Resolves the active (tenant, school, active academic year) for the caller.
 *
 * Phase 2D wires multi-school support: a tenant may now own multiple schools, and the
 * caller picks the active one via POST /schools/:id/switch (stored on user_profile.preferences).
 * If no preference is set, we fall back to the oldest school (deterministic).
 *
 * Callers that already know the school can pass an explicit schoolId via `forSchool`.
 */

/**
 * S-E03-16 / `PF-15` / `ADR-090` — le contexte que traversent les QUATRE portails.
 *
 * `activeAcademicYearId` est PRÉSERVÉ À L'IDENTIQUE : c'est ce qui laisse les 45
 * sites de filtrage et les 3 pages web intacts, et ce qui rend la tranche
 * additive et révertible en une commande.
 *
 * `activeAcademicYear` est le MÊME fait, non jeté. Zéro requête supplémentaire :
 * la ligne décorée était déjà en main à la ligne d'après, et seul `.id` en
 * sortait. Un appelant qui ré-appellerait `resolveActiveAcademicYear` pour
 * obtenir l'objet fabriquerait un N+1 là où il y a un simple passage de valeur.
 */
export interface SchoolContext {
  tenantId: string;
  schoolId: string;
  /** Inchangé. Les 45 sites de filtrage lisent CE champ et ne bougent pas. */
  activeAcademicYearId: string | null;
  /**
   * La PORTÉE complète, sérialisable telle quelle. `null` ⇔
   * `activeAcademicYearId` est `null` — les deux champs sont toujours d'accord.
   */
  activeAcademicYear: AcademicYearScope | null;
}

@Injectable()
export class SchoolContextService {
  constructor(private readonly prisma: PrismaService) {}

  async forTenant(tenantId: string, explicitSchoolId?: string): Promise<SchoolContext> {
    let schoolId = explicitSchoolId ?? null;

    if (!schoolId) {
      schoolId = await this.resolveDefaultSchoolId(tenantId);
    } else {
      // Validate the explicit school still belongs to the tenant.
      const s = await this.prisma.school.findFirst({ where: { id: schoolId, tenantId } });
      if (!s) throw new NotFoundException('School not found in tenant');
    }

    // S-E03-4 / PF-15 / ADR-070 — LE site de la fuite de tenancy. Avant cette
    // tranche, ce `where` était `{ schoolId, status: 'active' }` : `schoolId`
    // SEUL, sans `tenantId`, dans le service que traversent les QUATRE portails
    // (admin, teacher, parent, student).
    //
    // Honnêteté sur la portée, mesurée et non supposée : la fuite n'était pas
    // ATTEIGNABLE par cette méthode aujourd'hui, parce que les deux branches
    // au-dessus produisent toujours une école du tenant — la branche explicite
    // valide l'appartenance et lève 404, la branche par défaut ne choisit que
    // parmi les écoles du tenant. La correction retire la DÉPENDANCE à cette
    // garde amont : la requête était juste par accident de son appelant, elle
    // est désormais juste par construction.
    //
    // La RLS ne couvrait pas le trou et ne pouvait pas le couvrir :
    // `academic_year` figure bien dans les policies
    // (`20260813120000_tenant_rls_policies`), mais tout ce chemin tourne sur
    // `PrismaService`, la connexion PROPRIÉTAIRE, où la RLS est contournée
    // (vérifié sur la pile : `current_user = pilotage`, le rôle propriétaire).
    //
    // `tenantId` est maintenant un paramètre REQUIS du résolveur : le trou n'est
    // plus seulement bouché, il est devenu inexprimable.
    //
    // Aucun avertissement de vétusté ici, DÉLIBÉRÉMENT : ce service tourne sur
    // quasiment chaque requête authentifiée, un WARN par requête serait du bruit
    // (les deux sites d'alertes, à basse fréquence, portent le signal — AC-6).
    const ay = await resolveActiveAcademicYear(prismaAcademicYearReader(this.prisma), {
      tenantId,
      schoolId,
      referenceDate: new Date(),
      onAbsent: 'nullWhenNoActiveYear',
    });

    // S-E03-16 / PF-15 / ADR-090 — la vétusté cesse d'être CALCULÉE PUIS JETÉE.
    //
    // Avant cette tranche, la ligne suivante ne gardait que `ay?.id` : `name`,
    // `isStale`, `staleByDays`, `containsReferenceDate`, `viaFallback` et
    // `activeCount` étaient décorés par le résolveur à chaque requête
    // authentifiée des quatre portails, puis abandonnés ici.
    //
    // Ce n'est PAS une seconde résolution : `ay` est la ligne déjà en main,
    // la conversion est un mapper PUR, et le nombre de requêtes est identique.
    return {
      tenantId,
      schoolId,
      activeAcademicYearId: ay?.id ?? null,
      activeAcademicYear: ay ? toAcademicYearScope(ay) : null,
    };
  }

  /**
   * Resolves the active school by preferences first, then "most data" fallback.
   *
   * IMPORTANT — we don't blindly trust `preferences.activeSchoolId`: a user
   * may have switched to an empty test school via the multi-school picker and
   * never switched back. We verify the preferred school **has at least one
   * academic year**; otherwise we ignore it and pick the school with the most
   * students in the tenant. Without this guard the admin sees "0 everything"
   * silently.
   */
  async forUser(user: {
    id: string;
    tenantId: string;
    preferences: unknown;
  }): Promise<SchoolContext> {
    const prefs = (user.preferences as Record<string, unknown> | null) ?? {};
    const preferred = typeof prefs.activeSchoolId === 'string' ? prefs.activeSchoolId : undefined;
    if (preferred) {
      const ok = await this.prisma.school.findFirst({
        where: { id: preferred, tenantId: user.tenantId },
        include: { _count: { select: { academicYears: true, students: true } } },
      });
      if (ok && ok._count.academicYears > 0) {
        return this.forTenant(user.tenantId, preferred);
      }
      // Preferred school is empty or stale → fall through to "most data" pick
    }
    return this.forTenant(user.tenantId);
  }

  /**
   * Returns the school in the tenant with the most data attached (academic
   * years + students). Falls back to the oldest school if no school has any
   * data yet (fresh tenant).
   */
  private async resolveDefaultSchoolId(tenantId: string): Promise<string> {
    const schools = await this.prisma.school.findMany({
      where: { tenantId },
      select: {
        id: true,
        createdAt: true,
        _count: { select: { academicYears: true, students: true } },
      },
    });
    if (schools.length === 0) throw new NotFoundException('No school for tenant');

    // Prefer schools with data; among those, pick the one with the most
    // students. Ties broken by createdAt asc (deterministic).
    const withData = schools.filter((s) => s._count.academicYears > 0);
    const candidates = withData.length > 0 ? withData : schools;
    candidates.sort((a, b) => {
      const dStudents = b._count.students - a._count.students;
      if (dStudents !== 0) return dStudents;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return candidates[0]!.id;
  }
}
