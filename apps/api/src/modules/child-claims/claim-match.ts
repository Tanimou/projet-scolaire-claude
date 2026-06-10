/**
 * E9-S1 — the pure deny-by-default child-claim matcher (the RGPD security core).
 *
 * A PURE, deterministic, unit-testable module (the E7 `session-instance.ts`
 * precedent). The service fetches the MINIMAL candidate set (always tenant+school
 * scoped, ALWAYS narrowed in SQL by externalRef OR birthDate so a DOB-only/name-only
 * probe never materialises a population — PM-2) and hands it to `matchClaim`, which
 * applies the exact, normalised name comparison and the exactly-one-candidate rule.
 *
 * Algorithm (data-model §3/§4):
 *   1. externalRef path — if externalRef is provided, candidates are the tenant+school
 *      rows whose externalRef === claim.externalRef (exact). exactly-1 → matched;
 *      0 → fall through to the name+DOB path.
 *   2. name+DOB path — REQUIRES birthDate (a name-only claim is too leaky). Candidates
 *      are the tenant+school rows on the claim's birthDate; here we filter by
 *      normalised-equal lastName/firstName. exactly-1 → matched; 0 → no_match;
 *      >1 → ambiguous (twins — the parent sees the SAME uniform no-match shape).
 *   3. otherwise (name only, no DOB, no ref) → no_match.
 *
 * NO fuzzy / Levenshtein — exact normalised (trimmed, lowercased, accent-folded) only,
 * so the false-positive surface is zero. The matcher only SUGGESTS a candidate; it
 * never auto-approves (the human in S2 is the only access grant).
 */

export type ClaimMatchOutcome = 'matched' | 'no_match' | 'ambiguous';

export interface ClaimMatchResult {
  outcome: ClaimMatchOutcome;
  studentId?: string;
}

/** A claim's matchable fields (already trimmed at the DTO layer; we re-normalise defensively). */
export interface MatchableClaim {
  firstName: string;
  lastName: string;
  /** ISO yyyy-mm-dd (the date portion only) or undefined. */
  birthDate?: string;
  externalRef?: string;
}

/** A candidate Student row, pre-scoped to the parent's tenant+school by the caller. */
export interface CandidateStudent {
  id: string;
  firstName: string;
  lastName: string;
  /** ISO yyyy-mm-dd (the date portion only) or null. */
  birthDate: string | null;
  externalRef: string | null;
}

/**
 * Normalise a name for an exact, symmetric comparison: trim, collapse internal
 * whitespace, lowercase, strip diacritics (accent-fold via NFD + combining-mark
 * removal). Applied to BOTH sides so `É`/`e`, trailing/double spaces normalise
 * identically (PM-2). This is the ONLY name comparison — no fuzzy matching.
 */
export function normaliseName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Pure matcher. The candidate set MUST already be tenant+school scoped AND narrowed
 * in SQL by the relevant corroborating factor (externalRef for path 1, birthDate for
 * path 2). The matcher applies the exact rule and the exactly-one count.
 */
export function matchClaim(
  claim: MatchableClaim,
  candidates: {
    /** Students whose externalRef === claim.externalRef (only relevant when claim.externalRef set). */
    byExternalRef: CandidateStudent[];
    /** Students on claim.birthDate (only relevant when claim.birthDate set). */
    byBirthDate: CandidateStudent[];
  },
): ClaimMatchResult {
  // 1. externalRef path (highest confidence). The school issued this reference
  //    privately, so it matches without a DOB. @@unique([schoolId, externalRef])
  //    means >1 is impossible.
  const ref = claim.externalRef?.trim();
  if (ref) {
    const hits = candidates.byExternalRef.filter((s) => (s.externalRef ?? '').trim() === ref);
    if (hits.length === 1) return { outcome: 'matched', studentId: hits[0]!.id };
    // 0 → fall through to name+DOB.
  }

  // 2. name + DOB path. DOB is MANDATORY for a name match (a name-only claim would
  //    let a parent fish by surname). Candidates are already on the claim's birthDate;
  //    we additionally require a normalised name match on BOTH names.
  const dob = claim.birthDate?.trim();
  if (dob) {
    const fn = normaliseName(claim.firstName);
    const ln = normaliseName(claim.lastName);
    const hits = candidates.byBirthDate.filter(
      (s) =>
        (s.birthDate ?? '') === dob &&
        normaliseName(s.lastName) === ln &&
        normaliseName(s.firstName) === fn,
    );
    if (hits.length === 1) return { outcome: 'matched', studentId: hits[0]!.id };
    if (hits.length > 1) return { outcome: 'ambiguous' };
    return { outcome: 'no_match' };
  }

  // 3. name only, no DOB, no ref → always no_match (anti-fishing).
  return { outcome: 'no_match' };
}
