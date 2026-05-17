import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api } from '@/lib/api-client';

import { CalendarManager } from './CalendarManager';

export const metadata: Metadata = { title: 'Calendrier scolaire' };
export const dynamic = 'force-dynamic';

export type CalendarEventType =
  | 'vacation_break'
  | 'public_holiday'
  | 'exam_period'
  | 'meeting'
  | 'ceremony'
  | 'pedagogical_day'
  | 'custom';

export type CalendarEventScope =
  | 'school_wide'
  | 'cycle_scope'
  | 'grade_level_scope'
  | 'class_section_scope';

export type CalendarEventVisibility = 'all' | 'staff_only' | 'admin_only';

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  type: CalendarEventType;
  scope: CalendarEventScope;
  visibility: CalendarEventVisibility;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  color: string | null;
  icon: string | null;
  academicYearId: string | null;
  cycleId: string | null;
  gradeLevelId: string | null;
  classSectionId: string | null;
  cycle?: { name: string; code: string } | null;
  gradeLevel?: { name: string; code: string } | null;
  classSection?: { name: string } | null;
}

interface SimpleAcademicYear {
  id: string;
  name: string;
  status: 'active' | 'closed' | 'archived';
}

interface SimpleGradeLevel {
  id: string;
  code: string;
  name: string;
}

interface SimpleClass {
  id: string;
  name: string;
  gradeLevel: { name: string };
}

export default async function CalendarPage() {
  const [events, years, levels, classes] = await Promise.all([
    api<{ data: CalendarEvent[] }>('/api/v1/calendar/events', { cache: 'no-store' }),
    api<{ data: SimpleAcademicYear[] }>('/api/v1/academic-years', { cache: 'no-store' }),
    api<{ data: SimpleGradeLevel[] }>('/api/v1/cycles', { cache: 'no-store' }).then((c) => ({
      data: (c.data as unknown as Array<{ gradeLevels: SimpleGradeLevel[] }>).flatMap((cycle) =>
        cycle.gradeLevels ?? [],
      ),
    })),
    api<{ data: SimpleClass[] }>('/api/v1/classes', { cache: 'no-store' }),
  ]);

  return (
    <PortalShell portal="admin">
      <div>
        <div className="text-xs text-slate-500">École · Calendrier</div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Calendrier scolaire</h1>
        <p className="mt-1 text-sm text-slate-600">
          Vacances, jours fériés, périodes d&apos;examens, réunions, événements. Visible automatiquement
          dans les portails Prof et Famille.
        </p>
      </div>
      <div className="mt-8">
        <CalendarManager
          events={events.data}
          years={years.data}
          gradeLevels={levels.data}
          classes={classes.data}
        />
      </div>
    </PortalShell>
  );
}
