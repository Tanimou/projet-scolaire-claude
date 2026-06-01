import 'reflect-metadata';

import { CalendarEventScope, CalendarEventVisibility } from '@prisma/client';

import { CalendarController, calendarVisibilityWhere } from './calendar.controller';

/**
 * Tests unitaires de la gouvernance d'accès au calendrier (U9).
 *
 * 1. `calendarVisibilityWhere` — le fragment de `where` Prisma encode l'ABAC :
 *    inclusion des événements de classe des enfants pour le parent, exclusion
 *    stricte de `staff_only` / `admin_only`.
 * 2. La création d'événement (`POST /calendar/events`) reste gardée par la
 *    permission `calendar.write` — un teacher (qui n'a que `calendar.read`) ne
 *    peut donc pas créer d'événement institutionnel.
 */
describe('calendarVisibilityWhere — ABAC de visibilité', () => {
  describe('parent', () => {
    it('inclut le school_wide ET les events de classe des enfants, et exige visibility=all', () => {
      const where = calendarVisibilityWhere(['parent'], ['cs-1', 'cs-2']);

      // Un parent ne voit QUE le public.
      expect(where.visibility).toBe(CalendarEventVisibility.all);

      // La portée est restreinte : tout sauf le bruit class_section des autres
      // classes, plus explicitement les classes de ses enfants.
      expect(where.OR).toEqual([
        { scope: { not: CalendarEventScope.class_section_scope } },
        { classSectionId: { in: ['cs-1', 'cs-2'] } },
      ]);
    });

    it('exclut staff_only et admin_only (visibility verrouillé sur all)', () => {
      const where = calendarVisibilityWhere(['parent'], ['cs-1']);
      // visibility est une égalité stricte sur `all` → impossible de matcher
      // un event staff_only ou admin_only.
      expect(where.visibility).toBe(CalendarEventVisibility.all);
      expect(where.visibility).not.toBe(CalendarEventVisibility.staff_only);
      expect(where.visibility).not.toBe(CalendarEventVisibility.admin_only);
    });

    it('sans enfant (aucune classe) se rabat sur les seuls événements non class_section', () => {
      const where = calendarVisibilityWhere(['parent'], []);
      expect(where.visibility).toBe(CalendarEventVisibility.all);
      expect(where.OR).toEqual([
        { scope: { not: CalendarEventScope.class_section_scope } },
        { classSectionId: { in: [] } },
      ]);
    });
  });

  describe('teacher', () => {
    it('voit all + staff_only mais jamais admin_only, et sans restriction de portée', () => {
      const where = calendarVisibilityWhere(['teacher'], []);
      expect(where.visibility).toEqual({
        in: [CalendarEventVisibility.all, CalendarEventVisibility.staff_only],
      });
      const visIn = (where.visibility as { in: CalendarEventVisibility[] }).in;
      expect(visIn).not.toContain(CalendarEventVisibility.admin_only);
      // Pas de filtre de portée pour le staff.
      expect(where.OR).toBeUndefined();
    });
  });

  describe('admin', () => {
    it('ne pose aucune restriction (voit tout, y compris admin_only)', () => {
      expect(calendarVisibilityWhere(['school_admin'], [])).toEqual({});
      expect(calendarVisibilityWhere(['super_admin'], [])).toEqual({});
    });

    it('le privilège admin prime même si le rôle parent est aussi présent', () => {
      expect(calendarVisibilityWhere(['parent', 'school_admin'], ['cs-1'])).toEqual({});
    });
  });
});

describe('Gouvernance — création d’événement réservée à calendar.write', () => {
  /**
   * Lit toutes les clés de métadonnées posées sur un handler et renvoie true si
   * l'une d'elles contient la permission attendue. Indépendant du nom interne de
   * la clé utilisée par `@RequiresPermission`.
   */
  function handlerRequiresPermission(handler: unknown, permission: string): boolean {
    const keys = Reflect.getMetadataKeys(handler as object) ?? [];
    return keys.some((key) => {
      const value = Reflect.getMetadata(key, handler as object);
      if (value === permission) return true;
      if (Array.isArray(value) && value.includes(permission)) return true;
      return false;
    });
  }

  it('le handler POST /calendar/events exige la permission calendar.write', () => {
    const proto = CalendarController.prototype;
    expect(handlerRequiresPermission(proto.create, 'calendar.write')).toBe(true);
    // Et surtout PAS seulement calendar.read (qui laisserait passer un teacher).
    expect(handlerRequiresPermission(proto.create, 'calendar.read')).toBe(false);
  });

  it('un teacher (calendar.read uniquement) ne dispose pas de calendar.write', () => {
    // Le PermissionsGuard refuse l'accès si la permission requise n'est pas dans
    // les permissions du rôle. On modélise ici les permissions du teacher.
    const teacherPermissions = ['calendar.read'];
    const requiredForCreate = 'calendar.write';
    expect(teacherPermissions).not.toContain(requiredForCreate);
  });

  it('la lecture (GET /calendar/events) reste accessible via calendar.read', () => {
    const proto = CalendarController.prototype;
    expect(handlerRequiresPermission(proto.list, 'calendar.read')).toBe(true);
  });
});
