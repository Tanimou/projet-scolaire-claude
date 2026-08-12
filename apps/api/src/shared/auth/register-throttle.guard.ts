import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  THROTTLE_LOG_KEY_PREFIX_LENGTH,
  registrationIdentityKey,
  registrationThrottle,
} from './public-endpoint-throttle';

/**
 * THE refusal a throttled registrant reads, and it is USER INTERFACE COPY even
 * though this slice changes no `apps/web` file.
 *
 * `apps/web/src/app/parent/register/actions.ts:38-45` returns `body.message`
 * verbatim and `ParentRegisterForm.tsx:97-99` renders it raw, so this sentence is
 * on a parent's screen. Do not "tidy" it into a technical message — the same
 * convention `register.controller.ts:72-74` records for the 409 copy.
 *
 * Every word of it is load-bearing:
 *
 *  • **Impersonal, and that is a SECURITY property rather than a style one.** No
 *    second-person accusation ("vous avez fait trop de tentatives"): it is
 *    factually false for every tier-2 victim, it is stigmatising (GUARDRAILS §1),
 *    and an accusatory phrasing on the identity tier against a systemic phrasing
 *    on the global tier would itself be the tier oracle this slice must not
 *    build. One impersonal string reads honestly under BOTH tiers, so there is no
 *    branch to get wrong.
 *  • **No numbers.** A count leaks the limit; a precise delay would have to stay
 *    in sync with the window forever. "quelques minutes" is honest under every
 *    tier and deliberately over-states a one-minute window — the direction that
 *    cannot disappoint.
 *  • **No jargon** — never the status code, never "rate limit", never an address.
 *    The reader is a parent, not an operator.
 *  • Cause first, instruction last, matching `orphanedKeycloakUserMessage`
 *    (`register.controller.ts:95-99`), so a wrap never orphans the instruction.
 *  • 100 characters: three lines at 375 px inside the banner's `px-4 py-3
 *    text-sm`, so it never pushes the first field off-screen.
 *
 * Double-quoted because of the straight apostrophe in `d'inscription` — the exact
 * precedent at `register.controller.ts:97`, this string's immediate neighbour on
 * the same funnel.
 *
 * The apostrophe convention is LOCAL, not global, and saying otherwise would be
 * false: `apps/api/src` is genuinely split, with 30 files (including the sibling
 * user-facing message at `shared/audit/write-audit.ts:129-130`) using the
 * typographic `’`. This string follows its own module rather than a repo-wide rule
 * that does not exist. Either spelling is defensible here; what is not defensible
 * is a docblock asserting a uniformity the tree does not have.
 */
export const REGISTRATION_THROTTLED_MESSAGE =
  "Trop de demandes d'inscription en ce moment. Merci de patienter quelques minutes avant de réessayer.";

/**
 * S-E05-7 — the admission bound on `POST /auth/register-parent` (`PF-46`, the
 * unthrottled third; `PF-46` is NARROWED by this slice, not closed).
 *
 * Applied with `@UseGuards` on that ONE handler. Never as a global guard: that
 * would silently change every other endpoint in the application and is a
 * cross-cutting architectural change (GUARDRAILS §2). The decision logic is in
 * `public-endpoint-throttle.ts`; this class only turns a decision into HTTP.
 *
 * IT THROWS. IT NEVER RETURNS `false`.
 * -----------------------------------
 * Nest's default rejection for a falsy `canActivate` is `ForbiddenException` —
 * a 403, not a 429, and `actions.ts` would render whatever came back. So every
 * refusal path here throws `HttpException(<copy>, TOO_MANY_REQUESTS)`, the same
 * construction `child-claims.service.ts:126-129` already uses, which serialises
 * to `{ statusCode: 429, message: <string> }`. The message must stay a top-level
 * STRING: `actions.ts:39-42` joins an array with " · ", a class-validator artefact
 * that looks broken in a prose banner, and a message nested under another key
 * falls through to the raw "HTTP 429" — the jargon leak the copy above avoids.
 *
 * IT READS THE RAW BODY, DEFENSIVELY, BECAUSE IT MUST
 * --------------------------------------------------
 * Nest runs guards → interceptors → pipes, so the `ValidationPipe` has NOT run
 * when this executes: the body is whatever the parser produced, including
 * `undefined`, `null`, a string, or `{ email: 42 }`. `typeof … === 'string'` or
 * treat the address as absent; never throw. A limiter that 500s on garbage input
 * is worse than no limiter, and garbage input is exactly what a flood sends.
 *
 * Two consequences of running before the pipes, both accepted and both stated:
 * every 400 and every 409 spends tier-1 budget for that address (they are the
 * enumeration probes, so counting them is the point — `REGISTRATION_TIER1_MAX` is
 * sized for a fumbling parent), and a keyless request still spends tier-2 budget
 * so an empty body is never free traffic.
 *
 * G-AUDIT IS ARGUED, NOT TRIGGERED — DO NOT "FIX" THIS
 * ---------------------------------------------------
 * A throttled request performs NO mutation, so `G-AUDIT` does not apply to the
 * refusal, and no `auditLog` row is written per refused request. That is not an
 * omission: a database write per blocked anonymous request would rebuild, one
 * table over, the exact amplification this guard exists to remove. The signal is
 * a `Logger.warn` instead, emitted only on the TRANSITION into refusing (once per
 * tier, and once per key for the identity tier, per window) — a line per refused
 * request would be the same defect in the log sink. It carries the first
 * characters of the digest and the tier, never the submitted address. The
 * happy-path `user.register` row written by `persistRegisteredParent` is
 * untouched.
 *
 * NO TIER IS DISTINGUISHABLE FROM OUTSIDE
 * --------------------------------------
 * All three refusal reasons return the byte-identical status and message, and no
 * `Retry-After` is set on any of them. A per-address refusal distinguishable from
 * a global one would tell an anonymous caller that an address is in the bucket —
 * rebuilding the enumeration oracle `S-E05-11` closed at the two 409 branches. The
 * tier lives in the server log and nowhere else.
 *
 * THE RESIDUAL, REGISTERED RATHER THAN ASSERTED AWAY
 * -------------------------------------------------
 * Because the transport address is one constant value on this topology, the
 * global ceiling is necessarily source-blind: any single anonymous caller with
 * `curl` and an empty body can exhaust it and refuse every legitimate parent for
 * the rest of the window. This converts an AMPLIFICATION attack into an
 * AVAILABILITY one, and that inversion is the accepted trade — unbounded Keycloak
 * admin traffic on a fail-closed funnel is worse than a deferred signup — chosen
 * in writing here and in `ADR-038` D4 rather than discovered in an incident. The
 * `Logger.warn` naming the endpoint-wide tier is what an operator alerts on.
 *
 * Two further residuals, per ADR-038: the counters are per-process (a restart
 * clears them, and a second replica multiplies the ceiling by N), and the ceiling
 * is cross-tenant by construction — acceptable today because the handler resolves
 * a single hard-coded tenant, and not acceptable silently once real tenants exist.
 *
 * OUT OF SCOPE, EXPLICITLY: `emailVerified` stays `true` (the tradeoff recorded at
 * `register.controller.ts:153-156` is a product decision needing realm SMTP
 * wiring in `infra/`), the endpoint stays public, no other endpoint is throttled,
 * and there is no distributed limiter and no CAPTCHA here.
 */
@Injectable()
export class RegisterThrottleGuard implements CanActivate {
  private readonly logger = new Logger(RegisterThrottleGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ body?: unknown } | undefined>();
    const body = request?.body as { email?: unknown } | undefined;
    const key = registrationIdentityKey(body?.email);

    const decision = registrationThrottle.admit(key);
    if (decision.admitted) return true;

    if (decision.firstRefusalOfWindow) {
      const digest = key === null ? 'none' : key.slice(0, THROTTLE_LOG_KEY_PREFIX_LENGTH);
      this.logger.warn(
        `Registration throttle engaged on POST /auth/register-parent — tier=${decision.tier}, ` +
          `key=${digest}. Further refusals in this window are not logged individually.`,
      );
    }

    throw new HttpException(REGISTRATION_THROTTLED_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
  }
}
