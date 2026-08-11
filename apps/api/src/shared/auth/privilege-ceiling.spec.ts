import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ForbiddenException } from '@nestjs/common';

import { PERMISSIONS } from './permissions.constants';
import {
  assertWithinCeiling,
  CEILING_REFUSAL_MESSAGE_PREFIX,
  exceedsGrantor,
  MALFORMED_REQUEST_SENTINEL,
} from './privilege-ceiling';

/**
 * S-E05-2 — the predicate that decides the privilege ceiling (T-1 … T-10).
 *
 * WHY THIS FILE IS THE CORE OF THE G-AUTHZ EVIDENCE
 * -------------------------------------------------
 * The three handler specs prove the ceiling is WIRED. This one proves it is
 * FAIL-CLOSED, which is the half a wiring test cannot reach: T-5 (empty grantor
 * set), T-6 (`undefined` grantor set) and T-8 (unknown code) are the three
 * inputs on which a well-meaning « be lenient when we don't know » branch would
 * silently permit everything while every other test in the epic stayed green.
 *
 * MUTATION CHECK, STATED SO A REVIEWER CAN RUN IT: replace the body of
 * `exceedsGrantor` with `return []` — T-3, T-4, T-5, T-6, T-8 and T-9 must all
 * go red. Replace it with `return [...requested]` — T-1, T-2 and T-7 must go
 * red. If a handler negative still passes under `return []`, that handler test
 * was measuring an OLDER guard (`isSystem`, cross-tenant, slug collision), not
 * this one.
 */

const ALL_CODES: string[] = PERMISSIONS.map((p) => p[0]);

/** A `school_admin`-shaped grantor: real codes, and genuinely missing others. */
const SCHOOL_ADMIN = new Set<string>(['students.read', 'classes.read', 'roles.write', 'roles.assign']);

describe('T-1..T-4 — the comparison itself', () => {
  it('T-1 — a strict subset exceeds nothing', () => {
    expect(exceedsGrantor(SCHOOL_ADMIN, ['students.read', 'classes.read'])).toEqual([]);
  });

  it('T-2 — an exactly equal set exceeds nothing', () => {
    expect(exceedsGrantor(SCHOOL_ADMIN, [...SCHOOL_ADMIN])).toEqual([]);
  });

  it('T-3 — one code outside the grantor is returned, and only it', () => {
    expect(exceedsGrantor(SCHOOL_ADMIN, ['students.read', 'grades.revise'])).toEqual(['grades.revise']);
  });

  it('T-4 — several outside, duplicated in the input, come back de-duplicated in first-requested order', () => {
    const out = exceedsGrantor(SCHOOL_ADMIN, [
      'grades.revise',
      'students.read',
      'attendance.write',
      'grades.revise',
      'attendance.write',
    ]);
    expect(out).toEqual(['grades.revise', 'attendance.write']);
  });
});

describe('T-5..T-8 — fail-closed, on every degenerate input', () => {
  // THE fail-open this gate exists to forbid. `user-sync.service.ts:67` resolves
  // an unrecognised realm role to `[]`, so a caller with no recognised role and
  // no custom role genuinely arrives with an empty set. « Empty means unknown,
  // so allow » would hand that caller the whole catalogue.
  it('T-5 — an EMPTY grantor set denies every requested code', () => {
    expect(exceedsGrantor(new Set<string>(), ['students.read', 'grades.revise'])).toEqual([
      'students.read',
      'grades.revise',
    ]);
  });

  it('T-6 — an UNDEFINED grantor set denies every requested code', () => {
    expect(exceedsGrantor(undefined, ['students.read'])).toEqual(['students.read']);
  });

  // The one permit-on-empty, stated so it can never be mistaken for a bypass: a
  // role carrying zero permissions grants zero privilege. Note this is also what
  // makes `PATCH /roles/:id` with `permissionCodes: []` — stripping a role to
  // nothing — a de-escalation the ceiling permits by design.
  it('T-7 — an EMPTY request is allowed, for any grantor including an empty one', () => {
    expect(exceedsGrantor(SCHOOL_ADMIN, [])).toEqual([]);
    expect(exceedsGrantor(new Set<string>(), [])).toEqual([]);
    expect(exceedsGrantor(undefined, [])).toEqual([]);
  });

  it('T-8 — an unknown/garbage code is denied: the predicate never consults the catalogue', () => {
    expect(exceedsGrantor(SCHOOL_ADMIN, ['not.a.permission'])).toEqual(['not.a.permission']);
    // Even a full-catalogue grantor cannot hold a code that does not exist.
    expect(exceedsGrantor(new Set(ALL_CODES), ['not.a.permission'])).toEqual(['not.a.permission']);
  });

  it('T-8b — a malformed (non-array) request denies rather than reporting “nothing exceeds”', () => {
    expect(exceedsGrantor(new Set(ALL_CODES), undefined as unknown as string[])).toEqual([
      MALFORMED_REQUEST_SENTINEL,
    ]);
    expect(exceedsGrantor(new Set(ALL_CODES), 'grades.revise' as unknown as string[])).toEqual([
      MALFORMED_REQUEST_SENTINEL,
    ]);
  });

  // AC-6, proven STRUCTURALLY rather than by a role-name exemption: the string
  // `super_admin` appears nowhere in the module. The realm role carries the whole
  // catalogue, so the ceiling is a no-op for it — arithmetic, not a special case.
  it('AC-6 — a full-catalogue grantor exceeds nothing, and no role name is involved', () => {
    expect(exceedsGrantor(new Set(ALL_CODES), ALL_CODES)).toEqual([]);
    expect(() => assertWithinCeiling(new Set(ALL_CODES), ALL_CODES)).not.toThrow();
  });
});

describe('T-9 — assertWithinCeiling builds the ONE refusal shape', () => {
  function refusalOf(grantor: ReadonlySet<string> | undefined, requested: string[]) {
    try {
      assertWithinCeiling(grantor, requested);
    } catch (err) {
      return err as ForbiddenException;
    }
    throw new Error('expected assertWithinCeiling to throw, and it returned');
  }

  it('throws ForbiddenException with { message, required, missing } — the guard’s shape', () => {
    const err = refusalOf(SCHOOL_ADMIN, ['students.read', 'grades.revise', 'attendance.write']);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getStatus()).toBe(403);

    const body = err.getResponse() as { message: string; required: string[]; missing: string[] };
    expect(body.required).toEqual(['students.read', 'grades.revise', 'attendance.write']);
    expect(body.missing).toEqual(['grades.revise', 'attendance.write']);
  });

  it('the message is a plain FRENCH string that NAMES the exceeding codes', () => {
    // `apps/web/src/app/admin/roles/actions.ts:45-47` returns `body.message` with
    // no type check and `RoleBuilderForm.tsx:236` renders it as a React child, so
    // a nested object here would unmount the role editor. And the admin UI reads
    // ONLY `message` — a structured `missing` array alone never reaches a human.
    const body = refusalOf(SCHOOL_ADMIN, ['grades.revise']).getResponse() as { message: string };

    expect(typeof body.message).toBe('string');
    expect(body.message.startsWith(CEILING_REFUSAL_MESSAGE_PREFIX)).toBe(true);
    expect(body.message).toContain('grades.revise');
    expect(body.message).toMatch(/vous ne détenez pas/);
  });

  it('a long refusal is capped, so a full-catalogue diff is readable', () => {
    const body = refusalOf(new Set<string>(), ALL_CODES).getResponse() as {
      message: string;
      missing: string[];
    };
    expect(body.missing).toHaveLength(ALL_CODES.length);
    expect(body.message).toContain('autres)');
    expect(body.message.length).toBeLessThan(400);
  });

  it('a request WITHIN the ceiling throws nothing at all', () => {
    expect(() => assertWithinCeiling(SCHOOL_ADMIN, ['students.read'])).not.toThrow();
    expect(() => assertWithinCeiling(SCHOOL_ADMIN, [])).not.toThrow();
  });
});

describe('T-10 / AC-10 / DNC-10 — no off switch, and no room for one', () => {
  const SOURCE = readFileSync(join(__dirname, 'privilege-ceiling.ts'), 'utf8');

  // Mechanised rather than eyeballed (inversion T-5): a reviewer reading a
  // 180-line file does not reliably notice a re-introduced environment branch.
  it.each([
    ['process.env', 'process' + '.env'],
    ['NODE_ENV', 'NODE_' + 'ENV'],
    ['a SKIP_ flag', 'SKIP' + '_'],
    ['an ALLOW_ flag', 'ALLOW' + '_'],
    ['isDev', 'is' + 'Dev'],
    ['ConfigService', 'ConfigService'],
    ['@Injectable', '@Injectable'],
  ])('the module source contains no %s', (_label, token) => {
    expect(SOURCE).not.toContain(token);
  });

  // Arity is the second half: an options bag is the shape a bypass arrives in
  // (`{ skipCeiling: true }`), and it cannot appear without turning this red.
  it('both exports take exactly two parameters — an options object cannot hide', () => {
    expect(exceedsGrantor.length).toBe(2);
    expect(assertWithinCeiling.length).toBe(2);
  });

  it('the ceiling is required in development exactly as in production', () => {
    // Driven, not asserted: the predicate is a pure function of its two inputs,
    // so the same call under any environment produces the same refusal.
    expect(() => assertWithinCeiling(SCHOOL_ADMIN, ['grades.revise'])).toThrow(ForbiddenException);
  });
});
