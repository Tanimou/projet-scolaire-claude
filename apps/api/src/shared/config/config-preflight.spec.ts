import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  REQUIRED_ENV,
  MissingConfigError,
  assertRequiredConfig,
} from './config-preflight';

/**
 * S-E06-1 / PF-54 — le preflight de configuration doit échouer, nommément, et
 * sans qu'aucune variable d'environnement ne puisse le faire taire.
 *
 * Les cas ci-dessous sont ceux qui ont réellement produit le défaut : une
 * variable oubliée (la pile hébergée n'en déclarait AUCUNE des deux), une
 * variable déclarée vide par un `${VAR:-}` de compose (que `getOrThrow` de
 * @nestjs/config laisserait passer, puisqu'il ne teste que `undefined`), et la
 * tentation d'un interrupteur « juste pour la démo ».
 */

const FULL_ENV: Record<string, string> = {
  KEYCLOAK_URL: 'http://keycloak:8080/auth',
  KEYCLOAK_ADMIN_USER: 'pilotage-admin',
  KEYCLOAK_ADMIN_PASSWORD: 'not-a-real-secret',
  // S-E04-3 / ADR-036 D3 — le nombre de sauts de proxy inverse. La PRÉSENCE est
  // exigée ici ; la VALEUR est validée par `parseTrustProxyHops`
  // (`trust-proxy.spec.ts`), parce qu'un compte absent et un compte illisible
  // sont deux erreurs d'opérateur différentes et méritent deux messages.
  TRUST_PROXY_HOPS: '0',
};

describe('config preflight (S-E06-1 / PF-54)', () => {
  it('declares exactly the four values the API cannot invent', () => {
    // Garde-fou du garde-fou : une liste vidée ferait passer tous les tests
    // ci-dessous à vide.
    expect([...REQUIRED_ENV]).toEqual([
      'KEYCLOAK_URL',
      'KEYCLOAK_ADMIN_USER',
      'KEYCLOAK_ADMIN_PASSWORD',
      'TRUST_PROXY_HOPS',
    ]);
  });

  it('exige TRUST_PROXY_HOPS mais PAS AUDIT_FORWARD_TOKEN — l\'asymétrie est la décision', () => {
    // ADR-036 D9. Un mauvais compte de sauts est *silencieusement faux* : il fait
    // enregistrer une adresse plausible dans une piste de gouvernance. Un jeton
    // de transfert absent est *fail-safe* : la provenance devient nulle et l'UI
    // le dit. Exiger le second empêcherait de démarrer un opérateur qui n'a pas
    // encore distribué le secret — exactement la pression qui a produit le
    // `?? 'admin'` de PF-54.
    expect([...REQUIRED_ENV]).toContain('TRUST_PROXY_HOPS');
    expect([...REQUIRED_ENV]).not.toContain('AUDIT_FORWARD_TOKEN');
    const env = { ...FULL_ENV };
    delete env.AUDIT_FORWARD_TOKEN;
    expect(() => assertRequiredConfig(env)).not.toThrow();
  });

  it('does not throw when every required variable is declared', () => {
    expect(() => assertRequiredConfig(FULL_ENV)).not.toThrow();
  });

  it('logs the success without echoing a single value', () => {
    const lines: string[] = [];
    assertRequiredConfig(FULL_ENV, { log: (message) => lines.push(message) });
    expect(lines).toHaveLength(1);
    for (const value of Object.values(FULL_ENV)) {
      expect(lines[0]).not.toContain(value);
    }
  });

  it.each([...REQUIRED_ENV])('names %s when it is the only one missing', (name) => {
    const env = { ...FULL_ENV };
    delete env[name];
    expect(() => assertRequiredConfig(env)).toThrow(MissingConfigError);
    try {
      assertRequiredConfig(env);
    } catch (err) {
      expect((err as Error).message).toContain(name);
    }
  });

  it('names EVERY missing variable in ONE throw', () => {
    // Échouer sur la première ferait découvrir les trois en trois déploiements.
    let caught: MissingConfigError | null = null;
    try {
      assertRequiredConfig({});
    } catch (err) {
      caught = err as MissingConfigError;
    }
    expect(caught).toBeInstanceOf(MissingConfigError);
    expect(caught?.missing).toEqual([...REQUIRED_ENV]);
    for (const name of REQUIRED_ENV) {
      expect(caught?.message).toContain(name);
    }
  });

  it.each(['', '   ', '\t\n'])('treats %j as missing, not as configured', (blank) => {
    // `ConfigService.getOrThrow` ne lève que sur `undefined`. Un
    // `KEYCLOAK_ADMIN_PASSWORD: ${KEYCLOAK_ADMIN_PASSWORD:-}` dans compose
    // produit une chaîne VIDE, qui passerait le contrôle natif et
    // authentifierait l'API avec un mot de passe vide.
    expect(() =>
      assertRequiredConfig({ ...FULL_ENV, KEYCLOAK_ADMIN_PASSWORD: blank }),
    ).toThrow(/KEYCLOAK_ADMIN_PASSWORD/);
  });

  it('states that it refuses to fall back to default credentials', () => {
    try {
      assertRequiredConfig({});
    } catch (err) {
      expect((err as Error).message).toMatch(/REFUSE de retomber sur des identifiants/);
    }
  });

  it('never leaks a configured value into the failure message', () => {
    // Le message part dans stdout, dans les logs collectés et dans le pipeline
    // de traces (S-E02-14). Il ne nomme que des NOMS de variables.
    const env: Record<string, string | undefined> = { ...FULL_ENV, KEYCLOAK_ADMIN_USER: undefined };
    try {
      assertRequiredConfig(env);
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain(FULL_ENV.KEYCLOAK_ADMIN_PASSWORD);
      expect(message).not.toContain(FULL_ENV.KEYCLOAK_URL);
    }
  });

  it('does not require KEYCLOAK_REALM — it is a product constant (ADR-004)', () => {
    const env = { ...FULL_ENV };
    delete env.KEYCLOAK_REALM;
    expect(() => assertRequiredConfig(env)).not.toThrow();
    expect([...REQUIRED_ENV]).not.toContain('KEYCLOAK_REALM');
  });

  it('cannot be switched off by any environment variable (DNC-10)', () => {
    const saboteurs: Record<string, string> = {
      SKIP_CONFIG_CHECK: '1',
      ALLOW_DEFAULT_CREDENTIALS: 'true',
      CONFIG_PREFLIGHT: 'off',
      NODE_ENV: 'development',
      BYPASS_CONFIG_PREFLIGHT: '1',
      FORCE_START: '1',
      // S-E04-3 / DNC-10 — les saboteurs de la nouvelle clé rejoignent la même
      // table plutôt que d'ouvrir un second garde-fou ailleurs : la paire
      // « règle + contrôle » de ce fichier est le moule, pas un précédent à
      // dupliquer.
      SKIP_TRUST_PROXY: '1',
      ALLOW_PROXY_TRUST: 'true',
      TRUST_PROXY: 'true',
      TRUST_PROXY_HOPS_OVERRIDE: '2',
    };
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(saboteurs)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
    try {
      // Passé DANS l'environnement examiné ET posé sur process.env : ni l'un ni
      // l'autre chemin ne doit ouvrir une porte.
      expect(() => assertRequiredConfig({ ...saboteurs })).toThrow(MissingConfigError);
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('reads no environment variable of its own — the source is an argument', () => {
    // Une lecture directe de `process.env` rendrait le module impossible à
    // tester honnêtement et rouvrirait la porte à un interrupteur caché.
    const source = readFileSync(join(__dirname, 'config-preflight.ts'), 'utf8');
    expect(source).not.toMatch(/process\.env/);
  });
});
