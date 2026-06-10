import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Teacher booking transition request body (E7-S4).
 *
 * The tutor-owner moves a booking to a narrowed subset of `BookingStatus`:
 *  - `confirmed`            — accept a parent's request;
 *  - `declined`             — decline a request;
 *  - `completed`            — the session was honoured;
 *  - `no_show`              — the pupil did not attend (mapped onto `declined`
 *                             with an "Absent" note server-side, since the
 *                             enum carries no `no_show` value and S4 ships NO
 *                             schema change);
 *  - `proposed_alternative` — offer another slot (requires a `note`).
 *
 * Parent cancel uses the dedicated `PATCH /remediation/bookings/:id/cancel`
 * (S2), never this verb. The ownership wall (booking.tutor.userProfileId ===
 * caller) is re-checked server-side BEFORE any write (the E2 reply discipline).
 */
export class TransitionBookingDto {
  @IsIn(['confirmed', 'declined', 'completed', 'no_show', 'proposed_alternative'])
  toStatus!: 'confirmed' | 'declined' | 'completed' | 'no_show' | 'proposed_alternative';

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;
}
