import {
  evaluateRelease,
  isServable,
  readReleaseManifest,
} from './release-manifest';
import { ReleaseDriftError, assertReleaseMatches } from './release-preflight';

/**
 * S-E02-6 / VAL-10, risque R-05 — l'artefact qui tourne doit être prouvablement
 * celui qu'on croit déployer.
 *
 * La comparaison est une fonction pure : ces tests couvrent la table de décision
 * complète, y compris le cas qui a réellement fait tomber la production
 * (image construite depuis un arbre de travail non commité — PF-62).
 */

const SHA_A = 'ae68b87c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a';
const SHA_B = '1b30b9f0000111122223333444455556666777788';

const silentLogger = { log: () => undefined, warn: () => undefined } as never;

describe('evaluateRelease', () => {
  it('déclare `unverified` — et non `match` — quand aucune attente n’est déclarée', () => {
    const m = evaluateRelease(SHA_A, undefined);
    expect(m.verdict).toBe('unverified');
    expect(m.buildSha).toBe('ae68b87c1d2e');
    expect(m.expectedSha).toBeNull();
    // DNC-08 : ne jamais présenter comme vérifié ce qui n'a rien vérifié.
    expect(m.detail).toMatch(/comparée à rien/);
  });

  it('déclare `match` quand le build gravé est le commit attendu', () => {
    const m = evaluateRelease(SHA_A, SHA_A);
    expect(m.verdict).toBe('match');
    expect(m.detail).toBeNull();
    expect(m.dirty).toBe(false);
  });

  it('tolère la casse, les espaces et une longueur de SHA différente', () => {
    const m = evaluateRelease(`  ${SHA_A.toUpperCase()}  `, SHA_A.slice(0, 12));
    expect(m.verdict).toBe('match');
  });

  it('déclare `drift` quand l’image exécute un autre commit que l’attendu', () => {
    const m = evaluateRelease(SHA_B, SHA_A);
    expect(m.verdict).toBe('drift');
    expect(m.buildSha).toBe('1b30b9f00001');
    expect(m.expectedSha).toBe('ae68b87c1d2e');
    expect(m.detail).toMatch(/R-05/);
  });

  it('déclare `unstamped` quand l’image ne porte aucun SHA mais qu’on attend un commit', () => {
    // C'est l'état réel de toute image construite avant ce contrôle.
    const m = evaluateRelease(undefined, SHA_A);
    expect(m.verdict).toBe('unstamped');
    expect(m.buildSha).toBe('unknown');
  });

  it('déclare `dirty` quand l’image vient d’un arbre de travail non commité — le cas PF-62', () => {
    const m = evaluateRelease(`${SHA_A}-dirty`, SHA_A);
    // Le SHA de base correspond : sans détection du suffixe ce serait un faux `match`.
    expect(m.verdict).toBe('dirty');
    expect(m.dirty).toBe(true);
    expect(m.buildSha).toBe('ae68b87c1d2e-dirty');
    expect(m.detail).toMatch(/reproductible/);
  });

  it('ne masque pas une dérive derrière le suffixe `dirty`', () => {
    const m = evaluateRelease(`${SHA_B}-dirty`, SHA_A);
    expect(m.verdict).toBe('drift');
    expect(m.dirty).toBe(true);
  });

  it('traite une chaîne vide comme absente, des deux côtés', () => {
    expect(evaluateRelease('   ', SHA_A).verdict).toBe('unstamped');
    expect(evaluateRelease(SHA_A, '   ').verdict).toBe('unverified');
  });
});

describe('isServable', () => {
  it('n’autorise à servir que `match` et `unverified`', () => {
    expect(isServable('match')).toBe(true);
    expect(isServable('unverified')).toBe(true);
    expect(isServable('drift')).toBe(false);
    expect(isServable('dirty')).toBe(false);
    expect(isServable('unstamped')).toBe(false);
  });
});

describe('readReleaseManifest', () => {
  it('retient BUILD_SHA quand GIT_SHA est absent', () => {
    const m = readReleaseManifest({ BUILD_SHA: SHA_A, EXPECTED_GIT_SHA: SHA_A } as NodeJS.ProcessEnv);
    expect(m.verdict).toBe('match');
  });

  it('donne la priorité à GIT_SHA sur BUILD_SHA', () => {
    const m = readReleaseManifest({
      GIT_SHA: SHA_A,
      BUILD_SHA: SHA_B,
      EXPECTED_GIT_SHA: SHA_A,
    } as NodeJS.ProcessEnv);
    expect(m.buildSha).toBe('ae68b87c1d2e');
  });
});

describe('assertReleaseMatches', () => {
  const OLD = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD };
  });

  function withEnv(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  it('démarre sans bloquer quand aucune attente n’est déclarée (rétrocompatible)', () => {
    withEnv({ NODE_ENV: 'production', GIT_SHA: SHA_A, EXPECTED_GIT_SHA: undefined });
    expect(assertReleaseMatches(silentLogger).verdict).toBe('unverified');
  });

  it('démarre quand l’artefact est conforme', () => {
    withEnv({ NODE_ENV: 'production', GIT_SHA: SHA_A, EXPECTED_GIT_SHA: SHA_A });
    expect(assertReleaseMatches(silentLogger).verdict).toBe('match');
  });

  it('REFUSE de démarrer en production sur une dérive', () => {
    withEnv({ NODE_ENV: 'production', GIT_SHA: SHA_B, EXPECTED_GIT_SHA: SHA_A });
    expect(() => assertReleaseMatches(silentLogger)).toThrow(ReleaseDriftError);
  });

  it('REFUSE de démarrer en production sur un artefact sale', () => {
    withEnv({ NODE_ENV: 'production', GIT_SHA: `${SHA_A}-dirty`, EXPECTED_GIT_SHA: SHA_A });
    expect(() => assertReleaseMatches(silentLogger)).toThrow(ReleaseDriftError);
  });

  it('REFUSE de démarrer en production sur une image non estampillée', () => {
    withEnv({ NODE_ENV: 'production', GIT_SHA: undefined, BUILD_SHA: undefined, EXPECTED_GIT_SHA: SHA_A });
    expect(() => assertReleaseMatches(silentLogger)).toThrow(ReleaseDriftError);
  });

  it('n’offre AUCUN drapeau de contournement en production (DNC-10)', () => {
    withEnv({
      NODE_ENV: 'production',
      GIT_SHA: SHA_B,
      EXPECTED_GIT_SHA: SHA_A,
      // Noms plausibles qu'un opérateur pressé pourrait essayer :
      RELEASE_PREFLIGHT: 'off',
      RELEASE_GATE: 'off',
      SKIP_RELEASE_CHECK: '1',
    });
    expect(() => assertReleaseMatches(silentLogger)).toThrow(ReleaseDriftError);
  });

  it('journalise sans bloquer hors production', () => {
    withEnv({ NODE_ENV: 'development', GIT_SHA: SHA_B, EXPECTED_GIT_SHA: SHA_A });
    expect(assertReleaseMatches(silentLogger).verdict).toBe('drift');
  });

  it('porte le verdict et les deux SHA dans le message d’erreur', () => {
    withEnv({ NODE_ENV: 'production', GIT_SHA: SHA_B, EXPECTED_GIT_SHA: SHA_A });
    try {
      assertReleaseMatches(silentLogger);
      throw new Error('aurait dû lever');
    } catch (err) {
      expect((err as Error).message).toContain('1b30b9f00001');
      expect((err as Error).message).toContain('ae68b87c1d2e');
      expect((err as Error).message).toContain('drift');
    }
  });
});
