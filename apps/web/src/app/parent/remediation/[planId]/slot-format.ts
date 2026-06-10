/**
 * E7-S1 — pure, French slot-label formatting for the read-only catalogue.
 *
 * A `recurring_weekly` slot renders as "Mardi · 17:00–18:00"; a `one_off` renders
 * as a dated "lun. 12 mai · 17:00". Kept pure + dependency-light so the plan page
 * (a server component) can render slots without a client island.
 *
 * E7-S6 — the shape is enriched with the S2 live booking fields the server already
 * populates (`remainingSeats`/`nextSessionAt`/`myBookingId`) so the catalogue can
 * render a kind "Réservé" / "Complet" state without an N+1; `slotAvailabilityMeta`
 * derives a non-stigmatising, icon+text (never colour-alone) badge for each slot.
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
  /** E7-S2/S6 live booking fields (additive-optional — absent on the S1 read). */
  remainingSeats?: number;
  nextSessionAt?: string | null;
  myBookingId?: string | null;
}

/**
 * E7-S6 — kind, non-stigmatising availability badge for a catalogue slot. The
 * parent's own active booking reads "Réservé" (sky), a full slot reads "Complet"
 * (neutral, never a danger/red verdict — a full seat is not a failure), an
 * available slot reads "Places disponibles" (success). Icon+text, never
 * colour-alone (WCAG 1.4.1). Returns null when the slot carries no live data.
 */
export function slotAvailabilityMeta(
  slot: CatalogueSlotShape,
): { label: string; tone: 'sky' | 'success' | 'neutral' } | null {
  if (slot.myBookingId) return { label: 'Réservé', tone: 'sky' };
  if (slot.remainingSeats == null || slot.nextSessionAt == null) return null;
  if (slot.remainingSeats <= 0) return { label: 'Complet', tone: 'neutral' };
  return { label: 'Places disponibles', tone: 'success' };
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
