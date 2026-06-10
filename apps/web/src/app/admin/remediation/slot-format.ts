/**
 * E7-S5 — pure French slot/session/label formatting for the admin remediation
 * curation surface. Mirrors the teacher surface's `slot-format.ts` (kept local +
 * pure so the server component renders without a client island, and the client
 * islands reuse the same labels — no divergence across the two E7 surfaces).
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

export interface AdminSlotShape {
  kind: 'recurring_weekly' | 'one_off';
  weekday: number | null;
  startTime: string | null;
  endTime: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

/** Human label for a published availability slot. */
export function formatSlotLabel(slot: AdminSlotShape): string {
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

/** Kind FR label for a tutor type (never a verdict). */
export function tutorTypeLabel(type: 'teacher' | 'external' | 'peer'): string {
  switch (type) {
    case 'teacher':
      return 'Enseignant·e';
    case 'external':
      return 'Intervenant·e externe';
    case 'peer':
      return 'Tutorat entre pairs';
    default:
      return type;
  }
}

/** Kind FR label for a cost modality — a LABEL only, never a price (ADR-018). */
export function costKindLabel(costKind: 'free' | 'volunteer' | 'paid_offline'): string {
  switch (costKind) {
    case 'free':
      return 'Gratuit';
    case 'volunteer':
      return 'Bénévole';
    case 'paid_offline':
      return 'Sur place';
    default:
      return costKind;
  }
}
