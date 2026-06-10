import { type CandidateStudent, matchClaim, normaliseName } from './claim-match';

function student(overrides: Partial<CandidateStudent> = {}): CandidateStudent {
  return {
    id: 'stu-1',
    firstName: 'Léa',
    lastName: 'Dûpont',
    birthDate: '2012-04-05',
    externalRef: null,
    ...overrides,
  };
}

describe('normaliseName', () => {
  it('folds accents, case, trailing + double spaces symmetrically', () => {
    expect(normaliseName('Léa')).toBe(normaliseName('lea'));
    expect(normaliseName('  Dûpont ')).toBe('dupont');
    expect(normaliseName('Jean  Pierre')).toBe('jean pierre');
    expect(normaliseName('É')).toBe(normaliseName('e'));
  });
});

describe('matchClaim — externalRef path (highest confidence, no DOB needed)', () => {
  it('exactly-1 externalRef hit → matched', () => {
    const res = matchClaim(
      { firstName: 'x', lastName: 'y', externalRef: 'ABC-123' },
      { byExternalRef: [student({ id: 's9', externalRef: 'ABC-123' })], byBirthDate: [] },
    );
    expect(res).toEqual({ outcome: 'matched', studentId: 's9' });
  });

  it('0 externalRef hits with no DOB → no_match (no fall-through population)', () => {
    const res = matchClaim(
      { firstName: 'x', lastName: 'y', externalRef: 'NOPE' },
      { byExternalRef: [], byBirthDate: [] },
    );
    expect(res).toEqual({ outcome: 'no_match' });
  });

  it('0 externalRef hits but a valid name+DOB → falls through to a name match', () => {
    const res = matchClaim(
      { firstName: 'Léa', lastName: 'Dupont', birthDate: '2012-04-05', externalRef: 'NOPE' },
      { byExternalRef: [], byBirthDate: [student({ id: 's3' })] },
    );
    expect(res).toEqual({ outcome: 'matched', studentId: 's3' });
  });
});

describe('matchClaim — name + DOB path (DOB mandatory, exact normalised)', () => {
  it('exactly-1 normalised name+DOB hit → matched (accent/case-insensitive)', () => {
    const res = matchClaim(
      { firstName: 'lea', lastName: 'dupont', birthDate: '2012-04-05' },
      { byExternalRef: [], byBirthDate: [student({ id: 's7' })] },
    );
    expect(res).toEqual({ outcome: 'matched', studentId: 's7' });
  });

  it('right name, wrong DOB → no_match (the candidate set on that DOB is empty)', () => {
    const res = matchClaim(
      { firstName: 'Léa', lastName: 'Dûpont', birthDate: '2000-01-01' },
      { byExternalRef: [], byBirthDate: [] },
    );
    expect(res).toEqual({ outcome: 'no_match' });
  });

  it('twins — same name+DOB, no ref → ambiguous (never a leak; parent sees uniform)', () => {
    const res = matchClaim(
      { firstName: 'Léa', lastName: 'Dupont', birthDate: '2012-04-05' },
      {
        byExternalRef: [],
        byBirthDate: [student({ id: 'twin-a' }), student({ id: 'twin-b' })],
      },
    );
    expect(res).toEqual({ outcome: 'ambiguous' });
  });
});

describe('matchClaim — name-only ALWAYS no_match (anti-fishing, PM/data-model §3)', () => {
  it('name only, no DOB, no ref → no_match regardless of roster', () => {
    const res = matchClaim(
      { firstName: 'Léa', lastName: 'Dupont' },
      { byExternalRef: [], byBirthDate: [student()] },
    );
    expect(res).toEqual({ outcome: 'no_match' });
  });
});
