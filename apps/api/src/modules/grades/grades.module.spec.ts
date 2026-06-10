import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard for the 2026-06-01 refactor (commit 3341ed0,
// "feat(students): enrichissement académique") which exposed `GradesService`
// to the parent dashboard and, in the SAME edit, silently dropped
// `controllers: [AssessmentsController, GradesController]` from the module.
//
// The fallout: the ENTIRE teacher grading REST surface — create evaluation
// (`/api/v1/assessments/*`) and enter/batch notes + gradebook
// (`/api/v1/grades/*`) — was unmounted. Every request returned a router-level
// 404 ("Cannot GET …"), yet every existing unit test stayed green because none
// of them boot the Nest router; the controllers were exercised in isolation,
// never asserted to be registered. `*.module.ts` is also excluded from coverage
// collection (jest.config.js), so the dropped line left no coverage gap either.
//
// We assert on the module SOURCE rather than importing `GradesModule`: importing
// it pulls `AuthModule -> JwtStrategy -> jwks-rsa -> jose` (pure ESM), which the
// CommonJS ts-jest runtime cannot evaluate. A source assertion is the cheapest
// net that fails loudly if the grading surface is ever orphaned again.
describe('GradesModule wiring', () => {
  const source = readFileSync(join(__dirname, 'grades.module.ts'), 'utf8');
  const controllersBlock = source.match(/controllers:\s*\[([\s\S]*?)\]/)?.[1] ?? '';

  it('registers the assessment-creation controller (create/edit evaluations)', () => {
    expect(controllersBlock).toContain('AssessmentsController');
  });

  it('registers the grade-entry controller (notes, batch, gradebook, flag, revise)', () => {
    expect(controllersBlock).toContain('GradesController');
  });
});
