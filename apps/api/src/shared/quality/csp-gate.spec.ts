import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildWebCsp,
  buildBrandingCss,
  cspHeaderName,
  generateCspNonce,
  normalizeCspOrigin,
  resolveCspMode,
  CSP_HEADER,
  CSP_NONCE_HEADER,
  CSP_REPORT_ONLY_HEADER,
} from '@pilotage/contracts';

/**
 * S-E06-2 / PF-45 — garde du gate CSP.
 *
 * `scripts/csp-check.js` juge le dépôt tel qu'il est ; un run propre ne montre
 * donc que « le dépôt va bien aujourd'hui », jamais que le gate attraperait une
 * régression. Les propriétés qui comptent sont ici pilotées par des entrées
 * synthétiques, de sorte que chaque assertion peut échouer.
 *
 * Trois choses sont vérifiées :
 *  1. la politique produite a les propriétés dont dépend la sécurité, et les
 *     perdrait si on la relâchait ;
 *  2. le stage est câblé dans `ci-gate.sh` ET dans `ci.yml`, lu sur le contenu
 *     exécutable et pas sur le texte brut (leçon `PF-83`) ;
 *  3. le sink de branding et l'appel helmet ne peuvent pas revenir en arrière.
 */

const ROOT = join(__dirname, '../../../../..');
const CI_GATE = join(ROOT, 'scripts/ci-gate.sh');
const CI_WORKFLOW = join(ROOT, '.github/workflows/ci.yml');
const API_MAIN_SRC = join(ROOT, 'apps/api/src/main.ts');
const WEB_MIDDLEWARE_SRC = join(ROOT, 'apps/web/src/middleware.ts');
const APP_SHELL_SRC = join(ROOT, 'apps/web/src/components/shell/AppShellRoot.tsx');
const COMPOSE_PROD = join(ROOT, 'infra/docker-compose.prod.yml');

/**
 * Contenu exécutable d'un fichier à commentaires `#`, décalages préservés.
 *
 * `PF-83` : une assertion `indexOf` sur le texte brut d'un workflow a été rendue
 * rouge par un commentaire qui nommait le script. La forme correcte est de
 * blanchir les commentaires en gardant la longueur, pour que ni une phrase de
 * prose ni une ligne commentée ne puisse satisfaire — ou casser — la vérification.
 */
function executableContent(source: string): string {
  return source
    .split('\n')
    .map((line) => (line.trim().startsWith('#') ? ' '.repeat(line.length) : line))
    .join('\n');
}

function directiveOf(policy: string, name: string): string | null {
  const found = policy
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  return found ? found.slice(name.length).trim() : null;
}

describe('buildWebCsp — les propriétés dont dépend la sécurité', () => {
  const nonce = 'TEST0000NONCE0000VALUE==';
  const prod = buildWebCsp({ nonce, development: false });

  it('carries the response nonce in script-src and never `unsafe-inline`', () => {
    const scriptSrc = directiveOf(prod, 'script-src');
    expect(scriptSrc).toContain(`'nonce-${nonce}'`);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('keeps `unsafe-inline` on style-src-attr ONLY, never on style-src', () => {
    // C'est le compromis le plus étroit disponible : les nonces ne s'appliquent
    // pas aux attributs `style=""`, que React et Radix produisent partout, mais
    // ouvrir `style-src` entier rouvrirait le sink PF-45 lui-même.
    expect(directiveOf(prod, 'style-src')).not.toContain("'unsafe-inline'");
    expect(directiveOf(prod, 'style-src')).toContain(`'nonce-${nonce}'`);
    expect(directiveOf(prod, 'style-src-attr')).toBe("'unsafe-inline'");
  });

  it.each([
    ['default-src', "'self'"],
    ['base-uri', "'self'"],
    ['object-src', "'none'"],
    ['frame-ancestors', "'none'"],
    ['manifest-src', "'self'"],
  ])('locks %s to %s', (name, expected) => {
    expect(directiveOf(prod, name)).toBe(expected);
  });

  it('adds `unsafe-eval` and websockets ONLY in development', () => {
    const dev = buildWebCsp({ nonce, development: true });
    expect(directiveOf(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(directiveOf(dev, 'connect-src')).toContain('ws:');
    // …et la branche est vivante, donc l'assertion de production ci-dessus
    // porte sur quelque chose.
    expect(directiveOf(prod, 'connect-src')).not.toContain('ws:');
  });

  it('reduces a configured origin to scheme+host and drops path, query and fragment', () => {
    const withOrigins = buildWebCsp({
      nonce,
      connectSrc: ['https://api.example/v1/x?y=1#z', 'javascript:alert(1)', 'not a url', ''],
    });
    expect(directiveOf(withOrigins, 'connect-src')).toBe("'self' https://api.example");
  });

  it.each([
    ['javascript:alert(1)', null],
    ['data:text/html,x', null],
    ['', null],
    ['https://a.example/deep/path', 'https://a.example'],
    ['http://minio:9000', 'http://minio:9000'],
  ])('normalizeCspOrigin(%s) → %s', (input, expected) => {
    expect(normalizeCspOrigin(input)).toBe(expected);
  });
});

describe('generateCspNonce', () => {
  it('never returns the same value twice', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateCspNonce()));
    expect(seen.size).toBe(200);
  });

  it('returns at least 128 bits of base64', () => {
    // Un nonce court est devinable, et un nonce devinable ne vaut rien.
    expect(generateCspNonce()).toMatch(/^[A-Za-z0-9+/]{22,}={0,2}$/);
  });
});

describe('resolveCspMode — report-only est une manœuvre, pas un interrupteur (DNC-10)', () => {
  it('defaults to enforce', () => {
    expect(resolveCspMode({})).toBe('enforce');
  });

  it.each(['false', '1', 'off', 'yes', 'TRUE', ' true', ''])(
    'treats CSP_REPORT_ONLY=%j as enforce',
    (value) => {
      expect(resolveCspMode({ CSP_REPORT_ONLY: value })).toBe('enforce');
    },
  );

  it('switches to report-only on the exact string "true"', () => {
    expect(resolveCspMode({ CSP_REPORT_ONLY: 'true' })).toBe('report-only');
  });

  it('has no mode that emits no header at all', () => {
    expect(cspHeaderName('enforce')).toBe(CSP_HEADER);
    expect(cspHeaderName('report-only')).toBe(CSP_REPORT_ONLY_HEADER);
    // Il n'existe pas de troisième valeur : le type l'interdit, et à l'exécution
    // toute autre entrée retombe sur l'en-tête d'application.
    expect(cspHeaderName('anything' as never)).toBe(CSP_HEADER);
  });
});

describe('le stage est câblé dans les deux harnais et ne peut pas diverger', () => {
  it.each([
    ['scripts/ci-gate.sh', CI_GATE],
    ['.github/workflows/ci.yml', CI_WORKFLOW],
  ])('%s runs scripts/csp-check.js', (_label, path) => {
    expect(existsSync(path)).toBe(true);
    expect(executableContent(readFileSync(path, 'utf8'))).toContain('scripts/csp-check.js');
  });

  it('does not accept a commented-out invocation as wiring', () => {
    // Preuve dans le négatif du dépouillement lui-même : sans lui, un fichier
    // qui ne fait QUE mentionner le script en prose passerait.
    const commented = ['# run_stage "csp" node scripts/csp-check.js', 'echo hello'].join('\n');
    expect(executableContent(commented)).not.toContain('scripts/csp-check.js');
    expect(executableContent('node scripts/csp-check.js')).toContain('scripts/csp-check.js');
  });

  it('preserves byte offsets when blanking comments', () => {
    const source = '# a comment\nreal line\n';
    expect(executableContent(source)).toHaveLength(source.length);
  });
});

describe('le correctif ne peut pas revenir en arrière', () => {
  it('apps/api/src/main.ts no longer disables helmet CSP', () => {
    const source = readFileSync(API_MAIN_SRC, 'utf8');
    const executable = source.replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
    expect(executable).not.toMatch(/contentSecurityPolicy\s*:\s*false/);
    expect(executable).toContain('frame-ancestors');
  });

  it('apps/web/src/middleware.ts builds a per-request policy', () => {
    const source = readFileSync(WEB_MIDDLEWARE_SRC, 'utf8');
    expect(source).toContain('generateCspNonce');
    expect(source).toContain('buildWebCsp');
    // Le nonce doit être transmis au rendu, sinon les blocs en ligne du shell
    // partent sans nonce et la politique les bloque.
    expect(source).toContain(CSP_NONCE_HEADER);
  });

  it('AppShellRoot renders branding CSS through the shared sanitiser, not by interpolation', () => {
    const source = readFileSync(APP_SHELL_SRC, 'utf8');
    expect(source).toContain('buildBrandingCss');
    // La forme exacte du défaut : une interpolation directe d'une valeur de
    // branding dans le gabarit CSS.
    expect(source).not.toMatch(/--brand-primary:\$\{/);
    expect(source).not.toMatch(/\$\{branding\.(primaryColor|accentColor|fontFamily)\}/);
  });

  it('does not define a second copy of the sanitiser inside apps/web', () => {
    // Deux copies dérivent, et c'est celle du rendu qui protège les lignes déjà
    // en base. Même règle que `withRedaction` en S-E02-14.
    const source = readFileSync(APP_SHELL_SRC, 'utf8');
    expect(source).not.toMatch(/function\s+sanitize(CssColor|FontFamily|AssetUrl)/);
  });

  it('infra/docker-compose.prod.yml does not make report-only the deployed default', () => {
    expect(executableContent(readFileSync(COMPOSE_PROD, 'utf8'))).not.toContain('CSP_REPORT_ONLY');
  });
});

describe('buildBrandingCss reste inerte quel que soit le contenu stocké', () => {
  it.each([
    'red}</style><script>alert(1)</script>',
    'url("https://evil.example/x")',
    'expression(alert(1))',
    '\\3c /style\\3e',
  ])('neutralises %s', (payload) => {
    expect(buildBrandingCss({ primaryColor: payload, accentColor: payload, fontFamily: payload })).toBe(
      ':root{}',
    );
  });

  it('still emits the product palette', () => {
    expect(buildBrandingCss({ primaryColor: 'oklch(0.62 0.18 250)' })).toBe(
      ':root{--brand-primary:oklch(0.62 0.18 250);}',
    );
  });
});
