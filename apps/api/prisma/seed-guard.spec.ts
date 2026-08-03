import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { evaluateSeedPermission, SEED_OPT_IN_TOKEN } from './seed-guard';

/**
 * Preuve de la gate G-MIGRATION pour S-E02-4 (PF-03 « moitié seed », R-12).
 *
 * Deux niveaux :
 *  1. la table de décision pure (`evaluateSeedPermission`) ;
 *  2. un contrôle de non-régression sur les fichiers eux-mêmes — c'est la moitié
 *     qui compte, parce que le défaut d'origine n'était pas une mauvaise décision
 *     mais **six scripts qui ne la demandaient jamais**.
 */
describe('evaluateSeedPermission — table de décision', () => {
  const OPT_IN = { ALLOW_SEED: SEED_OPT_IN_TOKEN };

  describe('refus de production (aucun jeton ne le lève — DNC-10)', () => {
    it.each([
      ['NODE_ENV seul', { NODE_ENV: 'production' }],
      ['DEPLOY_ENV seul', { DEPLOY_ENV: 'production' }],
      ['les deux', { NODE_ENV: 'production', DEPLOY_ENV: 'production' }],
      ['alias prod', { DEPLOY_ENV: 'prod' }],
      ['casse et espaces', { DEPLOY_ENV: '  PRODUCTION  ' }],
    ])('refuse en production : %s', (_label, env) => {
      const result = evaluateSeedPermission(env);
      expect(result.allowed).toBe(false);
      expect(result.verdict).toBe('refused-production');
    });

    it("refuse la production MÊME avec l'opt-in explicite", () => {
      const result = evaluateSeedPermission({
        NODE_ENV: 'production',
        DEPLOY_ENV: 'production',
        ...OPT_IN,
      });
      expect(result.allowed).toBe(false);
      expect(result.verdict).toBe('refused-production');
    });

    it('refuse la production même avec un ALLOW_SEED aux valeurs les plus permissives', () => {
      for (const value of ['1', 'true', 'yes', 'force', SEED_OPT_IN_TOKEN]) {
        const result = evaluateSeedPermission({ DEPLOY_ENV: 'production', ALLOW_SEED: value });
        expect(result.allowed).toBe(false);
      }
    });
  });

  describe('signaux contradictoires — la signature du contournement historique', () => {
    it('refuse NODE_ENV=development sur un déploiement DEPLOY_ENV=production', () => {
      // Forme exacte de l'override supprimé dans infra/docker-compose.prod.yml.
      const result = evaluateSeedPermission({
        NODE_ENV: 'development',
        DEPLOY_ENV: 'production',
        ...OPT_IN,
      });
      expect(result.allowed).toBe(false);
      expect(result.verdict).toBe('refused-conflicting-signals');
      expect(result.detail).toMatch(/contradictoires/i);
    });

    it('refuse aussi le sens inverse (NODE_ENV=production, DEPLOY_ENV=demo)', () => {
      const result = evaluateSeedPermission({
        NODE_ENV: 'production',
        DEPLOY_ENV: 'demo',
        ...OPT_IN,
      });
      expect(result.allowed).toBe(false);
      expect(result.verdict).toBe('refused-conflicting-signals');
    });

    it("ne traite PAS une variable absente comme une contradiction", () => {
      // Absent ≠ contradiction : le verdict doit nommer la production, pas un conflit.
      expect(evaluateSeedPermission({ NODE_ENV: 'production' }).verdict).toBe('refused-production');
      expect(evaluateSeedPermission({ DEPLOY_ENV: 'production' }).verdict).toBe('refused-production');
    });
  });

  describe('opt-in explicite hors production', () => {
    it('refuse sans ALLOW_SEED — le seed ne part jamais par défaut', () => {
      const result = evaluateSeedPermission({ NODE_ENV: 'development', DEPLOY_ENV: 'demo' });
      expect(result.allowed).toBe(false);
      expect(result.verdict).toBe('refused-no-opt-in');
    });

    it('refuse un ALLOW_SEED booléen : il faut écrire le jeton, pas le cocher', () => {
      for (const value of ['1', 'true', 'yes', 'on', 'ALLOW']) {
        const result = evaluateSeedPermission({ DEPLOY_ENV: 'demo', ALLOW_SEED: value });
        expect(result.allowed).toBe(false);
        expect(result.verdict).toBe('refused-bad-token');
      }
    });

    it('autorise en démo avec le jeton exact', () => {
      const result = evaluateSeedPermission({
        NODE_ENV: 'development',
        DEPLOY_ENV: 'demo',
        ...OPT_IN,
      });
      expect(result.allowed).toBe(true);
      expect(result.verdict).toBe('allowed');
    });

    it('autorise en développement local sans DEPLOY_ENV, avec le jeton', () => {
      const result = evaluateSeedPermission({ NODE_ENV: 'development', ...OPT_IN });
      expect(result.allowed).toBe(true);
    });

    it('accepte le jeton insensible à la casse et aux espaces', () => {
      const result = evaluateSeedPermission({
        DEPLOY_ENV: 'demo',
        ALLOW_SEED: `  ${SEED_OPT_IN_TOKEN.toUpperCase()}  `,
      });
      expect(result.allowed).toBe(true);
    });

    it('refuse un environnement entièrement vide', () => {
      // Aucun signal : ce n'est pas une autorisation, c'est une omission.
      expect(evaluateSeedPermission({}).allowed).toBe(false);
    });
  });

  it('chaque refus nomme sa cause — un refus muet est indébogable', () => {
    const refusals = [
      {},
      { NODE_ENV: 'production' },
      { NODE_ENV: 'development', DEPLOY_ENV: 'production' },
      { DEPLOY_ENV: 'demo', ALLOW_SEED: 'true' },
    ];
    for (const env of refusals) {
      const result = evaluateSeedPermission(env);
      expect(result.allowed).toBe(false);
      expect(result.detail.length).toBeGreaterThan(40);
    }
  });
});

/**
 * Le défaut réel n'était pas la table de décision : c'était que six scripts sur
 * sept ne la consultaient pas. Ce bloc verrouille la couverture. Il lit les
 * fichiers comme du texte (même limite que PF-67 : cela prouve l'appel présent,
 * pas son exécution) — la preuve d'exécution est le refus réellement obtenu en
 * lançant les scripts, consigné dans la traçabilité.
 */
describe('couverture — les sept scripts de seed appellent la garde', () => {
  const SEED_SCRIPTS = [
    'seed.ts',
    'seed-demo.ts',
    'seed-demo-enrich.ts',
    'seed-demo-parent.ts',
    'seed-demo-surfaces.ts',
    'seed-demo-teacher.ts',
    'seed-keycloak-users.ts',
  ];

  it.each(SEED_SCRIPTS)('%s importe et invoque assertSeedAllowed', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    expect(source).toMatch(/from '\.\/seed-guard'/);
    expect(source).toMatch(/assertSeedAllowed\(/);
  });

  it.each(SEED_SCRIPTS)('%s garde AVANT toute instanciation de PrismaClient', (file) => {
    const source = readFileSync(join(__dirname, file), 'utf8');
    const guardAt = source.indexOf('assertSeedAllowed(');
    const clientAt = source.indexOf('new PrismaClient(');
    expect(guardAt).toBeGreaterThan(-1);
    // Un refus doit sortir sans avoir ouvert de connexion.
    if (clientAt > -1) expect(guardAt).toBeLessThan(clientAt);
  });

  it("aucun script ne conserve l'ancien contrôle NODE_ENV isolé", () => {
    // L'ancien garde-fou de seed-demo.ts était désactivable par une ligne de compose.
    for (const file of SEED_SCRIPTS) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source).not.toMatch(/if\s*\(\s*process\.env\.NODE_ENV\s*===\s*'production'\s*\)/);
    }
  });
});

/**
 * Non-régression d'infrastructure : le contournement était une ligne de YAML et
 * un opt-out de shell. Les deux sont verrouillés ici, sinon la garde applicative
 * serait reconstituable en une ligne.
 */
describe('infrastructure — le contournement ne peut pas revenir', () => {
  const repoRoot = join(__dirname, '..', '..', '..');

  it('docker-compose.prod.yml ne rétrograde plus NODE_ENV sur le service seed', () => {
    const compose = readFileSync(join(repoRoot, 'infra', 'docker-compose.prod.yml'), 'utf8');
    const seedBlock = compose.slice(compose.indexOf('\n  seed:'));
    const nextService = seedBlock.slice(1).search(/\n {2}[a-z][a-z0-9_-]*:/);
    const scoped = nextService > -1 ? seedBlock.slice(0, nextService + 1) : seedBlock;
    expect(scoped).not.toMatch(/NODE_ENV:\s*['"]?development/);
  });

  it('deploy-prod.sh ne seede pas par défaut (opt-in, pas opt-out)', () => {
    const deploy = readFileSync(join(repoRoot, 'scripts', 'deploy-prod.sh'), 'utf8');
    expect(deploy).toMatch(/--seed\)\s+RUN_SEED=1/); // opt-in explicite
    expect(deploy).toMatch(/RUN_SEED=0;/); // défaut : ne pas seeder
    expect(deploy).toMatch(/if \[ "\$RUN_SEED" = 1 \]/); // la chaîne ne part que sur opt-in
  });
});
