/**
 * E7-S1 — pure, French slot-label formatting for the read-only catalogue.
 *
 * A `recurring_weekly` slot renders as "Mardi · 17:00–18:00"; a `one_off` renders
 * as a dated "lun. 12 mai · 17:00". Kept pure + dependency-light so the plan page
 * (a server component) can render slots without a client island.
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

export interface CatalogueSlotShape {
  id: string;
  kind: 'recurring_weekly' | 'one_off';
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  startsAt: string | null;
  endsAt: string | null;
  capacity: number;
}

/** Human label for a catalogue slot. Returns a kind fallback if data is sparse. */
export function formatSlotLabel(slot: CatalogueSlotShape): string {
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
  // one_off
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
