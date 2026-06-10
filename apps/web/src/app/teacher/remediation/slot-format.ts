/**
 * E7-S4 — pure French slot/session formatting for the teacher remediation surface.
 *
 * Kept pure + dependency-light so the server component renders without a client
 * island, and the client islands reuse the same labels (no divergence).
 */

const WEEKDAYS_FR = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;

export interface TeacherSlotShape {
  kind: 'recurring_weekly' | 'one_off';
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

/** Human label for a published availability slot. */
export function formatSlotLabel(slot: TeacherSlotShape): string {
  if (slot.kind === 'recurring_weekly') {
    const day =
      slot.weekday != null && slot.weekday >= 0 && slot.weekday <= 6
        ? WEEKDAYS_FR[slot.weekday]
        : null;
    const time =
      slot.startTime && slot.endTime
        ? `${slot.startTime}–${slot.endTime}`
        : (slot.startTime ?? null);
    return [day, time].filter(Boolean).join(' · ') || 'Créneau hebdomadaire';
  }
  if (slot.startsAt) {
    const d = new Date(slot.startsAt);
    if (!Number.isNaN(d.getTime())) {
      const date = d.toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `${date} · ${time}`;
    }
  }
  return 'Créneau ponctuel';
}

/** Human label for a booked session instant (absolute, never a relative tick). */
export function formatSessionAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

/** Kind, non-stigmatising FR label + tone for a booking status. */
export function bookingStatusMeta(status: string): {
  label: string;
  tone: 'sky' | 'success' | 'warning' | 'neutral' | 'danger';
} {
  switch (status) {
    case 'requested':
      return { label: 'Demande reçue', tone: 'warning' };
    case 'confirmed':
      return { label: 'Confirmée', tone: 'sky' };
    case 'completed':
      return { label: 'Séance honorée', tone: 'success' };
    case 'cancelled':
      return { label: 'Annulée par la famille', tone: 'neutral' };
    case 'declined':
      return { label: 'Déclinée', tone: 'neutral' };
    case 'proposed_alternative':
      return { label: 'Autre créneau proposé', tone: 'sky' };
    default:
      return { label: status, tone: 'neutral' };
  }
}
