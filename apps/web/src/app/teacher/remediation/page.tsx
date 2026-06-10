import {
  CalendarClock,
  CalendarDays,
  GraduationCap,
  Inbox,
  Users,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import type { TeacherRemediationDto } from '@pilotage/contracts';
import { Badge, Card, CardContent, EmptyState, KpiCard, PageHeader, StatusBadge } from '@pilotage/ui';

import { BookingsTable } from './BookingsTable';
import { PublishSlotDrawer } from './PublishSlotDrawer';
import { formatSlotLabel } from './slot-format';

export const metadata: Metadata = { title: 'Mes créneaux de soutien' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

/**
 * Teacher "Mes créneaux de soutien" (E7-S4) — the teacher capacity + booking
 * management surface. Server-fetches the ownership-walled aggregate
 * `GET /api/v1/remediation/teacher` (the caller's own tutor slots + bookings +
 * teachable subjects — ONE call, the wall enforced server-side) and renders:
 *  - a publish/edit availability surface (PublishSlotDrawer);
 *  - a list of the teacher's own published slots with live booked counts;
 *  - the booking inbox with confirm/decline/honoured/no-show/propose transitions.
 *
 * Kind, non-stigmatising copy throughout (remediation = support being organised).
 * The teacher never sees another tutor's slots or bookings (the wall). No schema.
 */
export default async function TeacherRemediationPage() {
  const surface = await safe(
    api<TeacherRemediationDto>('/api/v1/remediation/teacher', { cache: 'no-store' }),
  );
  const loadFailed = surface === null;

  const tutor = surface?.tutor ?? {
    tutorId: null,
    displayName: null,
    published: false,
    subjectIds: [],
    availabilities: [],
  };
  const bookings = surface?.bookings ?? [];
  const teachableSubjects = surface?.teachableSubjects ?? [];

  const activeSlots = tutor.availabilities.filter((a) => a.active);
  const pendingRequests = bookings.filter((b) => b.status === 'requested').length;
  const upcomingConfirmed = bookings.filter((b) => b.status === 'confirmed').length;

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Mes créneaux de soutien' },
        ]}
        title="Mes créneaux de soutien"
        subtitle="Proposez des créneaux d’aide à vos élèves et suivez les réservations des familles."
        actions={<PublishSlotDrawer teachableSubjects={teachableSubjects} />}
      />

      <div className="mt-6 space-y-8">
        <section className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60 sm:p-5">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-sm leading-relaxed text-slate-600">
            Offrez un accompagnement léger à vos élèves : publiez un créneau hebdomadaire ou ponctuel,
            précisez le nombre de places, et confirmez les réservations des familles. Vous ne voyez que
            vos propres créneaux et vos propres élèves.
          </p>
        </section>

        {loadFailed && (
          <p role="alert" className="rounded-lg bg-rose-100/80 px-3 py-2 text-sm font-medium text-rose-800">
            Vos créneaux n’ont pas pu être chargés. Veuillez réessayer dans un instant.
          </p>
        )}

        {!loadFailed && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KpiCard icon={CalendarDays} tone="violet" label="Créneaux actifs" value={activeSlots.length} />
              <KpiCard icon={Inbox} tone="amber" label="Demandes à traiter" value={pendingRequests} />
              <KpiCard icon={Users} tone="sky" label="Séances confirmées" value={upcomingConfirmed} />
            </div>

            {/* Published availability slots */}
            <section aria-labelledby="slots-heading">
              <div className="flex items-center gap-2">
                <h2 id="slots-heading" className="text-sm font-bold uppercase tracking-wider text-slate-700">
                  Mes créneaux publiés
                </h2>
                {tutor.published ? (
                  <StatusBadge label="Visible des familles" tone="success" size="sm" withDot />
                ) : (
                  activeSlots.length > 0 && (
                    <StatusBadge label="En attente de publication" tone="warning" size="sm" withDot />
                  )
                )}
              </div>

              {activeSlots.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  tone="violet"
                  title="Aucun créneau pour l’instant"
                  description={
                    teachableSubjects.length === 0
                      ? "Vous n’avez pas de matière enseignée cette année — la proposition de soutien sera disponible dès qu’une affectation vous sera attribuée."
                      : "Proposez votre premier créneau d’aide pour qu’une famille puisse réserver une séance de soutien."
                  }
                  className="mt-4"
                />
              ) : (
                <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" role="list">
                  {activeSlots.map((slot) => (
                    <li key={slot.id}>
                      <Card className="h-full">
                        <CardContent className="flex h-full flex-col gap-2 p-4">
                          <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                            <CalendarClock className="h-4 w-4 text-indigo-500" aria-hidden />
                            {formatSlotLabel(slot)}
                          </p>
                          <div className="mt-auto flex items-center justify-between">
                            <Badge variant="outline" className="text-[11px]">
                              {slot.bookedCount}/{slot.capacity} place
                              {slot.capacity > 1 ? 's' : ''} réservée{slot.bookedCount > 1 ? 's' : ''}
                            </Badge>
                            {slot.bookedCount >= slot.capacity && (
                              <StatusBadge label="Complet" tone="neutral" size="sm" />
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Booking inbox */}
            <section aria-labelledby="bookings-heading">
              <h2 id="bookings-heading" className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-700">
                Réservations des familles
              </h2>
              <BookingsTable bookings={bookings} />
            </section>
          </>
        )}
      </div>
    </PortalShell>
  );
}
