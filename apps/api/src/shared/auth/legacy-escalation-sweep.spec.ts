import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  BASELINE_CANARY_CODE,
  exitCodeForSweep,
  formatSweepReportFr,
  MALFORMED_CODE_SENTINEL,
  MALFORMED_ROLE_SENTINEL,
  SCHOOL_ADMIN_BASELINE,
  sweepLegacyEscalations,
  type CandidateRole,
  type SweepReport,
} from './legacy-escalation-sweep';
import { PERMISSIONS, REALM_ROLE_PERMISSIONS } from './permissions.constants';

/**
 * S-E05-2c — le détecteur de privilèges hérités (`PF-175`), T-0 … T-14.
 *
 * POURQUOI CE FICHIER EST LA MOITIÉ VISIBLE PAR LA CI (ADR-025 D1)
 * ----------------------------------------------------------------
 * La moitié qui a besoin d’une base vivante est le CLI, hors `ci-gate.sh`. Ce
 * fichier est la moitié que `test:api` collecte déjà, et il doit donc porter
 * TOUT ce qui est démontrable sans base : le prédicat, sa totalité, son
 * déterminisme, l’absence d’interrupteur, et — par relecture de source — les
 * deux promesses du CLI qui sinon ne seraient que des commentaires (« lecture
 * seule », « sur aucun chemin d’exécution »).
 *
 * VÉRIFICATION PAR MUTATION, ÉNONCÉE POUR QU’UN RELECTEUR PUISSE LA JOUER :
 * remplacer le corps de `sweepLegacyEscalations` par un rapport `clean: true` —
 * T-1, T-5, T-6, T-7, T-8 et T-9 doivent rougir. Remplacer le saut structurel des
 * rôles système par un `continue` inconditionnel — T-3 rougit. Remplacer
 * `permissionCodes` illisible par `?? []` — T-6 rougit et T-2 reste vert, ce qui
 * est exactement la confusion que T-6 existe pour interdire.
 */

const HERE = __dirname;
const CLI_PATH = join(HERE, 'legacy-escalation-sweep.cli.ts');
const CLI_SOURCE = readFileSync(CLI_PATH, 'utf8');
const MODULE_SOURCE = readFileSync(join(HERE, 'legacy-escalation-sweep.ts'), 'utf8');

/* eslint-disable @typescript-eslint/no-require-imports */
// Convention maison, reprise telle quelle d’`audit-provenance-gate.spec.ts`.
// Non gardé, volontairement (DNC-08) : si le script disparaît ou cesse d’exporter
// son épurateur, cette suite doit échouer AU CHARGEMENT plutôt que se dégrader en
// « rien à vérifier, donc vert ».
const { stripCommentsPreservingLines } = require(
  join(HERE, '..', '..', '..', '..', '..', 'scripts', 'link-integrity-check.js')
) as { stripCommentsPreservingLines: (source: string) => string };
/* eslint-enable @typescript-eslint/no-require-imports */
const API_ROOT = join(HERE, '..', '..', '..');
const SRC_ROOT = join(HERE, '..', '..');

/** Tout est dérivé à l’exécution : aucune liste de codes n’est recopiée ici. */
const SCHOOL_ADMIN_CODES: readonly string[] = REALM_ROLE_PERMISSIONS.school_admin ?? [];
const TEACHER_CODES: readonly string[] = REALM_ROLE_PERMISSIONS.teacher ?? [];
const ALL_CODES: readonly string[] = PERMISSIONS.map((p) => p[0]);

/** Les codes que `teacher` détient et que `school_admin` ne détient pas. */
const TEACHER_ONLY_CODES = TEACHER_CODES.filter((code) => !SCHOOL_ADMIN_BASELINE.has(code));

function role(overrides: Partial<CandidateRole> = {}): CandidateRole {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    slug: 'surveillant',
    isSystem: false,
    schoolId: null,
    permissionCodes: [],
    ...overrides,
  };
}

function sweep(candidates: readonly CandidateRole[]): SweepReport {
  return sweepLegacyEscalations(candidates, SCHOOL_ADMIN_BASELINE);
}

describe('T-0 — le garde-fou du montage : la base de référence ne peut pas devenir vide en silence', () => {
  it('la base est DÉRIVÉE de school_admin, à la bonne taille', () => {
    expect(SCHOOL_ADMIN_BASELINE.size).toBe(SCHOOL_ADMIN_CODES.length);
    expect(SCHOOL_ADMIN_BASELINE.size).toBeGreaterThan(0);
    expect(SCHOOL_ADMIN_BASELINE.has(BASELINE_CANARY_CODE)).toBe(true);
  });

  // Le pivot de tout le fichier : si `grades.revise` entrait un jour dans
  // `school_admin`, T-1 deviendrait vide de sens sans rougir. Il rougit ici.
  it('`grades.revise` est HORS de la base — sinon T-1 serait vacuous', () => {
    expect(SCHOOL_ADMIN_BASELINE.has('grades.revise')).toBe(false);
    expect(TEACHER_CODES).toContain('grades.revise');
    expect(ALL_CODES).toContain('grades.revise');
    expect(TEACHER_ONLY_CODES.length).toBeGreaterThan(0);
  });
});

describe('T-1..T-4 — la détection elle-même', () => {
  it('T-1 (AC-4a) — un rôle personnalisé portant `grades.revise` est signalé, avec exactement ce code', () => {
    const report = sweep([role({ permissionCodes: ['students.read', 'grades.revise'] })]);

    expect(report.clean).toBe(false);
    expect(report.examined).toBe(1);
    expect(report.skippedSystem).toBe(0);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.codes).toEqual(['grades.revise']);
    expect(report.findings[0]?.kind).toBe('escalation');
    expect(report.findings[0]?.malformed).toBe(false);
  });

  it('T-2 (AC-4b) — un rôle entièrement dans school_admin n’est pas signalé', () => {
    const report = sweep([role({ permissionCodes: [...SCHOOL_ADMIN_CODES] })]);

    expect(report.clean).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.examined).toBe(1);
  });

  // L’UNIQUE autorisation-sur-vide, adjacente à T-6 pour qu’on ne puisse pas les
  // « simplifier » l’une dans l’autre.
  it('T-2b (AC-3) — un rôle bien formé à zéro code n’est pas un signalement', () => {
    const report = sweep([role({ permissionCodes: [] })]);

    expect(report.clean).toBe(true);
    expect(report.examined).toBe(1);
  });

  it('T-3 (AC-4c) — un rôle système est ignoré même s’il dépasse largement', () => {
    const report = sweep([
      role({ isSystem: true, slug: 'teacher', permissionCodes: [...TEACHER_CODES] }),
    ]);

    expect(report.clean).toBe(true);
    expect(report.skippedSystem).toBe(1);
    expect(report.examined).toBe(0);
    // Et le même rôle NON système dépasse : la différence vient bien du champ.
    expect(sweep([role({ isSystem: false, permissionCodes: [...TEACHER_CODES] })]).clean).toBe(false);
  });

  it('T-4 (AC-4d) — une entrée vide produit un rapport propre et explicite', () => {
    const report = sweep([]);

    expect(report.clean).toBe(true);
    expect(report.examined).toBe(0);
    expect(report.skippedSystem).toBe(0);
    expect(report.findings).toEqual([]);
    expect(report.baselineSize).toBe(SCHOOL_ADMIN_BASELINE.size);
  });
});

describe('T-5..T-8 — fermé-en-cas-d’échec, sur chaque entrée dégénérée', () => {
  it('T-5 (AC-4e) — un code inconnu est signalé : le détecteur ne consulte jamais le catalogue', () => {
    const report = sweep([role({ permissionCodes: ['pas.une.permission'] })]);

    expect(report.clean).toBe(false);
    expect(report.findings[0]?.codes).toEqual(['pas.une.permission']);
    expect(report.findings[0]?.kind).toBe('escalation');
  });

  it('T-6 (AC-4f) — un `permissionCodes` absent est SIGNALÉ comme malformé, jamais avalé comme « zéro code »', () => {
    const broken = { id: 'r-1', slug: 'cassé', isSystem: false, schoolId: null } as unknown as CandidateRole;
    const report = sweep([broken]);

    expect(report.clean).toBe(false);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.kind).toBe('malformed');
    expect(report.findings[0]?.malformed).toBe(true);
    expect(report.findings[0]?.codes).toEqual([MALFORMED_CODE_SENTINEL]);

    // Adjacent, et c’est le point : `[]` est propre, `absent` ne l’est pas.
    expect(sweep([role({ permissionCodes: [] })]).clean).toBe(true);
  });

  it('T-6b — une entrée nulle, un code non textuel et un identifiant vide sont tous signalés', () => {
    expect(sweep([null as unknown as CandidateRole]).clean).toBe(false);
    expect(sweep([null as unknown as CandidateRole]).findings[0]?.roleId).toBe(MALFORMED_ROLE_SENTINEL);

    const numericCode = sweep([role({ permissionCodes: [42 as unknown as string] })]);
    expect(numericCode.clean).toBe(false);
    expect(numericCode.findings[0]?.kind).toBe('malformed');
    expect(numericCode.findings[0]?.codes).toContain(MALFORMED_CODE_SENTINEL);

    const noSlug = sweep([role({ slug: '' as unknown as string, permissionCodes: [] })]);
    expect(noSlug.clean).toBe(false);
    expect(noSlug.findings[0]?.slug).toBe(MALFORMED_ROLE_SENTINEL);
  });

  it('T-7 — des candidats qui ne sont pas un tableau produisent un signalement, jamais « propre »', () => {
    for (const garbage of [undefined, null, 'role', 42, {}]) {
      const report = sweepLegacyEscalations(garbage as unknown as CandidateRole[], SCHOOL_ADMIN_BASELINE);
      expect(report.clean).toBe(false);
      expect(report.findings[0]?.kind).toBe('malformed');
      expect(report.examined).toBe(0);
    }
  });

  it('T-8 (AC-4h) — une base de référence vide ou `undefined` signale TOUS les codes', () => {
    const codes = [...SCHOOL_ADMIN_CODES].slice(0, 5);

    for (const baseline of [undefined, new Set<string>()]) {
      const report = sweepLegacyEscalations([role({ permissionCodes: codes })], baseline);
      expect(report.clean).toBe(false);
      expect(report.baselineSize).toBe(0);
      expect(report.findings[0]?.codes).toEqual([...codes].sort());
      // « base vide » n’est PAS « malformé » : la ligne est lisible, la
      // référence manque. Les deux conditions restent distinctes.
      expect(report.findings[0]?.kind).toBe('escalation');
    }
  });
});

describe('T-9 — déterminisme, dé-duplication et tenance', () => {
  const roles: CandidateRole[] = [
    role({ id: 'id-b', slug: 'zeta', permissionCodes: ['grades.revise', 'grades.revise'] }),
    role({ id: 'id-a', slug: 'alpha', schoolId: 'school-1', permissionCodes: ['lessons.write'] }),
    role({ id: 'id-c', slug: 'mid', permissionCodes: ['attendance.write', 'grades.revise'] }),
  ];

  it('T-9a (AC-4g) — le même ensemble dans n’importe quel ordre donne un rapport profondément égal', () => {
    const forward = sweep(roles);
    const backward = sweep([...roles].reverse());
    const shuffled = sweep([roles[2]!, roles[0]!, roles[1]!]);

    expect(backward).toEqual(forward);
    expect(shuffled).toEqual(forward);
    expect(forward.findings.map((f) => f.slug)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('T-9b (AC-4g) — les codes sont dé-dupliqués et triés, et un doublon exact fusionne', () => {
    const report = sweep(roles);

    expect(report.findings[2]?.codes).toEqual(['grades.revise']);
    expect(report.findings[1]?.codes).toEqual(['attendance.write', 'grades.revise']);
    expect(sweep([roles[0]!, roles[0]!]).findings).toHaveLength(1);
  });

  it('T-9c (AC-6 / F1) — chaque signalement porte sa portée, et `schoolId: null` est GLOBAL, pas « sans tenant »', () => {
    const report = sweep(roles);
    const global = report.findings.find((f) => f.slug === 'zeta');
    const scoped = report.findings.find((f) => f.slug === 'alpha');

    expect(global?.scope).toBe('global');
    expect(global?.schoolId).toBeNull();
    expect(scoped?.scope).toBe('school');
    expect(scoped?.schoolId).toBe('school-1');

    const text = formatSweepReportFr(report);
    expect(text).toContain('GLOBALE');
    expect(text).toContain('PF-08');
    expect(text).toContain('school-1');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('null');
  });

  it('T-9d (AC-1) — le balayage n’a AUCUN paramètre d’école : il ne peut pas filtrer sur un tenant', () => {
    expect(sweepLegacyEscalations.length).toBe(2);
    expect(MODULE_SOURCE).not.toContain('schoolFilter');
  });
});

describe('T-10 — les trois issues, et une base fraîchement amorcée qui sort 0', () => {
  it('T-10a (AC-9) — 0 propre · 1 signalements · 2 non concluant', () => {
    expect(exitCodeForSweep(sweep([]))).toBe(0);
    expect(exitCodeForSweep(sweep([role({ permissionCodes: ['grades.revise'] })]))).toBe(1);
    expect(exitCodeForSweep(null)).toBe(2);
    expect(exitCodeForSweep.length).toBe(1);
  });

  // F6/AC-13 : le seul faux positif garanti serait le rôle `teacher` amorcé, qui
  // porte six codes hors base. Un détecteur rouge sur une base propre finit
  // désactivé — donc on le prouve vert, avec les VRAIS codes des semences.
  it('T-10b (AC-13) — une base fraîchement amorcée (quatre rôles système) sort 0', () => {
    const seeded: CandidateRole[] = ['school_admin', 'teacher', 'parent', 'student'].map((slug, i) => ({
      id: `seed-${i}`,
      slug,
      isSystem: true,
      schoolId: null,
      permissionCodes: [...(REALM_ROLE_PERMISSIONS[slug] ?? [])],
    }));

    const report = sweep(seeded);
    expect(report.skippedSystem).toBe(4);
    expect(report.clean).toBe(true);
    expect(exitCodeForSweep(report)).toBe(0);
  });
});

describe('T-11 (AC-10) — le rapport français, apostrophes courbes comprises', () => {
  const CLEAN = formatSweepReportFr(sweep([role({ permissionCodes: [] })]));
  const FLAGGED = formatSweepReportFr(
    sweep([role({ permissionCodes: ['grades.revise', 'attendance.write'] })]),
  );

  it('la distinction propre/signalement est PORTÉE PAR LE TEXTE, pas par une couleur', () => {
    expect(CLEAN).toContain('OK');
    expect(CLEAN).toContain('Aucun rôle à examiner');
    expect(FLAGGED).toContain('ALERTE');
    expect(FLAGGED).toContain('privilège hérité à examiner');
    expect(FLAGGED).toContain('1 rôle(s) signalé(s) sur 1 examiné(s).');
    expect(CLEAN).not.toContain('ALERTE');
  });

  it('le rapport ne prétend jamais avoir prouvé une escalade, et rappelle que la révocation est humaine', () => {
    expect(FLAGGED).toContain('rôles à examiner');
    expect(FLAGGED).toContain('décision humaine');
    expect(FLAGGED).not.toContain('escalade confirmée');
  });

  it('les apostrophes sont courbes : aucune apostrophe droite entre deux lettres', () => {
    for (const text of [CLEAN, FLAGGED]) {
      expect(text).toContain('’');
      expect(text).not.toMatch(/[A-Za-zÀ-ÖØ-öø-ÿ]'[A-Za-zÀ-ÖØ-öø-ÿ]/);
    }
  });

  it('formatSweepReportFr prend exactement un paramètre — un sac d’options ne peut pas s’y glisser', () => {
    expect(formatSweepReportFr.length).toBe(1);
  });
});

describe('T-12 / DNC-10 — aucun interrupteur dans les DEUX nouveaux fichiers', () => {
  // Mécanisé plutôt que relu : un relecteur ne repère pas de façon fiable une
  // branche d’environnement réintroduite. Jetons concaténés pour que la
  // spécification ne se déclenche pas sur elle-même.
  const FORBIDDEN: Array<[string, string]> = [
    ['process.env', 'process' + '.env'],
    ['NODE_ENV', 'NODE_' + 'ENV'],
    ['un drapeau SKIP_', 'SKIP' + '_'],
    ['un drapeau ALLOW_', 'ALLOW' + '_'],
    ['isDev', 'is' + 'Dev'],
    ['ConfigService', 'Config' + 'Service'],
    ['@Injectable', '@' + 'Injectable'],
    ['dotenv', 'dot' + 'env'],
    // Aucune exemption par nom de rôle : la seule raison pour laquelle le rôle
    // de plateforme est épargné est arithmétique (son ensemble est le catalogue).
    ['une exemption par nom de rôle', 'super' + '_admin'],
  ];

  it.each(FORBIDDEN)('le module pur ne contient aucun %s', (_label, token) => {
    expect(MODULE_SOURCE).not.toContain(token);
  });

  it.each(FORBIDDEN)('le CLI ne contient aucun %s', (_label, token) => {
    expect(CLI_SOURCE).not.toContain(token);
  });

  it('les arités sont fixes (2, 1, 1)', () => {
    expect(sweepLegacyEscalations.length).toBe(2);
    expect(formatSweepReportFr.length).toBe(1);
    expect(exitCodeForSweep.length).toBe(1);
  });

  it('le module pur n’importe ni Prisma ni Nest — il retourne une valeur, il ne refuse pas une requête', () => {
    // Sur la source EXÉCUTABLE, commentaires retirés. Le module explique en
    // en-tête qu’il n’importe « même pas `@nestjs/common` », et un scan brut
    // rougissait donc sur la phrase qui promet le contraire de ce qu’elle
    // décrit. C’est la même auto-déclenche que les jetons concaténés de
    // FORBIDDEN évitent plus haut ; ici le commentaire vit dans le fichier
    // examiné, pas dans la spécification.
    const executable = stripCommentsPreservingLines(MODULE_SOURCE);
    expect(executable).not.toContain('@prisma/client');
    expect(executable).not.toContain('@nestjs/common');
  });
});

describe('T-13 (AC-11) — le CLI est en LECTURE SEULE, prouvé par relecture de source', () => {
  it('il lit avec `findMany` et ne porte aucun verbe mutant', () => {
    expect(CLI_SOURCE).toContain('findMany');

    for (const verb of [
      '.create(',
      '.createMany(',
      '.update(',
      '.updateMany(',
      '.upsert(',
      '.delete(',
      '.deleteMany(',
      '$executeRaw',
      '$queryRaw',
      '$transaction',
      'INS' + 'ERT',
      'UPD' + 'ATE',
      'DEL' + 'ETE',
    ]) {
      expect(CLI_SOURCE).not.toContain(verb);
    }
  });

  it('il se déconnecte et pose un code de sortie sans jamais tronquer la sortie', () => {
    expect(CLI_SOURCE).toContain('$disconnect');
    expect(CLI_SOURCE).toContain('process.exitCode');
    expect(CLI_SOURCE).not.toContain('process.exit(');
  });

  it('il cite les deux décisions déjà écrites, pour qu’on ne relise pas ce fichier comme une invention', () => {
    expect(CLI_SOURCE).toContain('ADR-015 D8.2');
    expect(CLI_SOURCE).toContain('ADR-025 D1');
    expect(CLI_SOURCE).toContain('DÉCISION HUMAINE');
  });
});

describe('T-14 (AC-5/AC-11) — le CLI est câblé comme script et sur AUCUN chemin d’exécution', () => {
  it('exactement une ligne de script, pointant sur un fichier qui existe', () => {
    const pkg = JSON.parse(readFileSync(join(API_ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts['sweep:legacy-escalation']).toBe(
      'tsx src/shared/auth/legacy-escalation-sweep.cli.ts',
    );
    expect(existsSync(join(API_ROOT, 'src/shared/auth/legacy-escalation-sweep.cli.ts'))).toBe(true);
  });

  it('son exécution est gardée par `require.main === module`', () => {
    expect(CLI_SOURCE).toContain('if (require.main === module)');
  });

  it('aucun fichier de `src/**` ne l’importe, hors cette spécification', () => {
    const importers = listTsFiles(SRC_ROOT).filter((file) =>
      readFileSync(file, 'utf8').includes('legacy-escalation-sweep.cli'),
    );

    expect(importers).toEqual([__filename]);
  });
});

describe('T-15 (F5) — le saut des rôles système ne cache rien de frappable', () => {
  // La sûreté du saut structurel vit dans un AUTRE fichier : si un jour un client
  // pouvait poser `isSystem`, l’angle mort se rouvrirait. Ce test rougit ce
  // jour-là, bruyamment, au bon endroit.
  it('la création de rôle force toujours `isSystem: false`', () => {
    const controller = readFileSync(join(SRC_ROOT, 'modules', 'identity', 'roles.controller.ts'), 'utf8');
    expect(controller).toContain('isSystem: false');
  });
});

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}
