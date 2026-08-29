import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AnalyticsService } from './analytics.service';

/**
 * S-E03-2b / `PF-05` / `PF-339` — UNE NOTE DE ZÉRO EST UNE NOTE.
 *
 * CE QUE CE FICHIER ÉPINGLE, ET CE QU'IL N'AFFIRME PAS
 * ----------------------------------------------------
 * Le registre portait `PF-339` en **P1** : « `if (!g.value) continue` supprime
 * une note légitime de ZÉRO de toutes les surfaces adossées à A ». Cette
 * affirmation est **FAUSSE telle qu'écrite**, et elle a été falsifiée par
 * EXÉCUTION contre le Postgres du conteneur, pas par lecture :
 * `scripts/grade-zero-value-probe.js` → `PROBE: PASS — 5/5`.
 * `Grade.value` est `Decimal?`, Prisma rend un `Prisma.Decimal`, tout objet est
 * vrai, donc `!Decimal(0)` vaut `false` et le zéro était **CONSERVÉ**.
 *
 * POURQUOI LE CODE A QUAND MÊME CHANGÉ
 * ------------------------------------
 * Le zéro survivait par ACCIDENT. La sûreté reposait entièrement sur un
 * invariant que RIEN n'énonçait — que la valeur atteint la boucle non
 * convertie. `analytics.service.ts` fait déjà `Number(g.value)` à deux autres
 * endroits (l. 834, l. 1297). Dès qu'une valeur numérisée traverse l'une de ces
 * boucles, `!0` supprime le zéro en silence. C'est la forme exacte de `PF-11` /
 * `ADR-068 §1.1` : *la seule chose qui gardait le code correct était un
 * invariant que rien dans le code n'énonçait.*
 *
 * Les deux `describe` ci-dessous tiennent donc les deux moitiés :
 *   1. le COMPORTEMENT, sur la représentation `number` — ROUGE avant la
 *      tranche, VERTE après. C'est le seul axe où le défaut est atteignable.
 *   2. la CLASSE, par un cliquet qui interdit la forme dans les deux
 *      applications, avec pour témoin le fichier RÉEL d'avant la tranche.
 *
 * ⚠ CONTRÔLE DE NON-VACUITÉ. Un prédicat qui garderait TOUT passerait la
 * moitié 1 sans rien prouver : le cas `NULL` l'interdit explicitement. Et le
 * cliquet est exécuté contre une violation INJECTÉE avant d'être cru vert —
 * un cliquet vert sur zéro fichier est vert par construction (`PF-366`).
 */

const TENANT = 't1';
const SCHOOL = 's1';
const YEAR = 'ay-1';
const CYCLE = { id: 'cy-1', name: 'Collège', color: '#123456' };

/**
 * Une ligne de note dans la forme EXACTE que `schoolPerformance` sélectionne.
 * `value` est délibérément un `number` : c'est la représentation qu'une
 * conversion en amont produit, et le seul axe où `!g.value` est atteignable.
 */
function gradeRow(value: number | null, maxScore = 20) {
  return {
    value,
    assessment: {
      maxScore,
      teachingAssignment: { classSection: { gradeLevel: { cycle: CYCLE } } },
    },
  };
}

function serviceOver(rows: ReturnType<typeof gradeRow>[]) {
  const prisma = {
    grade: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  return {
    service: new AnalyticsService(prisma as never, {} as never, {} as never),
    prisma,
  };
}

describe('S-E03-2b — `schoolPerformance` compte une note de zéro (PF-05 / PF-339)', () => {
  it('compte le ZÉRO dans le total ET le classe en échec — le taux de réussite est DILUÉ, pas gonflé', async () => {
    // Deux notes : un 0 (échec) et un 20 (réussite). La vérité est 1/2 = 50 %.
    // Avec `!g.value`, le 0 disparaît : total=1, success=1 → 100 %. Un KPI
    // d'établissement inventé par un prédicat — la divergence que `DNC-01`
    // interdit.
    const { service } = serviceOver([gradeRow(0), gradeRow(20)]);

    const out = await service.schoolPerformance({
      tenantId: TENANT,
      schoolId: SCHOOL,
      academicYearId: YEAR,
    });

    expect(out.byCycle).toHaveLength(1);
    const [cycle] = out.byCycle;
    expect(cycle).toBeDefined();
    expect(cycle!.sampleSize).toBe(2);
    expect(cycle!.successRate).toBe(50);
  });

  it("le KPI d'établissement `overall` est dilué lui aussi — c'est la surface admin", async () => {
    // `overall` est le nombre affiché sur `/admin` : 1 réussite sur 2 notes.
    // Avec `!g.value`, le 0 n'entre ni au numérateur ni au dénominateur et le
    // taux devient 100 % — un établissement parfait produit par un prédicat.
    const { service } = serviceOver([gradeRow(0), gradeRow(20)]);
    const out = await service.schoolPerformance({
      tenantId: TENANT,
      schoolId: SCHOOL,
      academicYearId: YEAR,
    });
    expect(out.overall).toBe(50);
  });

  it('NON-VACUITÉ — une valeur NULL reste exclue (un prédicat qui garde tout échoue ici)', async () => {
    const { service } = serviceOver([gradeRow(null), gradeRow(20)]);

    const out = await service.schoolPerformance({
      tenantId: TENANT,
      schoolId: SCHOOL,
      academicYearId: YEAR,
    });

    const [cycle] = out.byCycle;
    expect(cycle).toBeDefined();
    expect(cycle!.sampleSize).toBe(1);
    expect(cycle!.successRate).toBe(100);
  });

  it("le zéro survit aussi sous sa représentation Decimal — l'ancien prédicat le gardait déjà par accident", async () => {
    // Sonde P1 rejouée en unitaire : un objet de type Decimal est TOUJOURS vrai.
    // C'est la moitié qui FALSIFIE `PF-339` tel qu'il était écrit.
    const decimalZero = { toString: () => '0', valueOf: () => 0 };
    const { service } = serviceOver([
      gradeRow(decimalZero as unknown as number),
      gradeRow(20),
    ]);

    const out = await service.schoolPerformance({
      tenantId: TENANT,
      schoolId: SCHOOL,
      academicYearId: YEAR,
    });

    const [cycle] = out.byCycle;
    expect(cycle).toBeDefined();
    expect(cycle!.sampleSize).toBe(2);
    expect(!(decimalZero as unknown as number)).toBe(false); // l'accident, énoncé
  });
});

/**
 * LE CLIQUET — la fermeture est réclamée comme CLASSE, donc elle doit être
 * gardée comme classe (Step 5, règle 2 des paliers de preuve).
 */
const SCAN_ROOTS = ['apps/api/src', 'apps/worker/src'];

/** Retire commentaires de ligne et de bloc : le cliquet juge du CODE. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** `!<identifiant>.value` — la forme interdite, sur du code décommenté. */
const FORBIDDEN = /!\s*[A-Za-z_$][A-Za-z0-9_$]*\.value\b/g;

function violationsIn(source: string): string[] {
  return stripComments(source).match(FORBIDDEN) ?? [];
}

function repoRoot(): string {
  return join(__dirname, '..', '..', '..', '..', '..');
}

function scanFiles(): string[] {
  // Dérivé, jamais une liste écrite à la main : une allowlist littérale se
  // périme en silence, et deux listes tenues à la main dérivent (PF-59).
  // `execFileSync` est importé en tête (`PF-468`) : la forme `require()` que ce
  // site portait est interdite par `@typescript-eslint/no-require-imports` et
  // laissait `main` ROUGE au stage `lint`.
  const out = execFileSync('git', ['ls-files', '--', ...SCAN_ROOTS], {
    cwd: repoRoot(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.ts') && !l.endsWith('.spec.ts'));
}

describe('S-E03-2b — cliquet : `!x.value` est interdit sur une note (PF-339, classe)', () => {
  it('le scan voit réellement des fichiers (anti-vacuité du corpus)', () => {
    const files = scanFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('apps/api/src/modules/analytics/analytics.service.ts');
  });

  it('FIRE — le détecteur signale une violation injectée', () => {
    expect(violationsIn('for (const g of grades) { if (!g.value) continue; }')).toHaveLength(1);
  });

  it('FIRE — le détecteur aurait attrapé le fichier RÉEL d’avant la tranche', () => {
    // Témoin le plus fort disponible : on reconstitue le prédicat d'origine dans
    // le fichier de production réel et on vérifie que le cliquet l'attrape. Un
    // cliquet qui ne rougit pas sur le défaut qu'il prétend geler ne garde rien.
    const real = readFileSync(
      join(repoRoot(), 'apps/api/src/modules/analytics/analytics.service.ts'),
      'utf8',
    );
    const preFix = real
      .replace(/if \(g\.value === null \|\| g\.value === undefined\) continue;/g, 'if (!g.value) continue;')
      .replace(/if \(!cy \|\| g\.value === null \|\| g\.value === undefined\) continue;/g, 'if (!cy || !g.value) continue;');
    expect(violationsIn(preFix).length).toBeGreaterThanOrEqual(4);
  });

  it('QUIET — aucune violation ne subsiste dans apps/api et apps/worker', () => {
    const offenders = scanFiles()
      .map((rel) => ({ rel, hits: violationsIn(readFileSync(join(repoRoot(), rel), 'utf8')) }))
      .filter((f) => f.hits.length > 0);

    expect(
      offenders.map((o) => `${o.rel} (${o.hits.length}× ${o.hits.join(', ')})`),
    ).toEqual([]);
  });
});
