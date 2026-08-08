/**
 * S-E04-3 — `trust proxy`, pinned from a refusing configuration key.
 *
 * WHAT THIS FILE IS
 * -----------------
 * The **only** place in `apps/api` that knows the number of reverse proxies
 * between the API socket and the client, and the **only** place that calls
 * `app.set('trust proxy', …)`. `main.ts` calls `applyTrustProxy` once; the
 * supertest harness (`shared/audit/client-hints.supertest.spec.ts`) calls the
 * SAME function with the same environment. That is deliberate: a test that
 * configured `trust proxy` inline would prove a property of the test rather
 * than of the artefact that ships — the `S-E02-18` / `S-E02-19` lesson, which
 * is that a gate stated over a re-implementation of the artefact is not a gate.
 *
 * WHY A KEY AND NOT A LITERAL (`ADR-036` D2/D3)
 * --------------------------------------------
 * `N` measurably differs between the two topologies this repository defines:
 * `N = 2` in production (Traefik → nginx → api) and `N = 0` on the local
 * `--profile app` stack (nginx carries `profiles: ["prod"]`, so the api is
 * reached directly). A source literal would be silently wrong in one of them,
 * and the failure mode of a wrong hop count is not a crash — it is a *plausible*
 * address stored in a governance trail and rendered to an auditor as the place
 * a person was sitting.
 *
 * `ADR-036` D3 therefore names one shape as **specifically forbidden**:
 *
 *     Number(process.env.TRUST_PROXY_HOPS ?? 2)     // ← never
 *
 * and it is forbidden three times over. `??` supplies a fallback that is right
 * on the author's machine and wrong on the deployment nobody re-reads (`PF-54`
 * shipped `admin`/`admin` exactly this way). `Number()` coerces: it accepts
 * `'  2  '`, `'2e0'`, `'0x2'` → `2`, and — the catastrophic case — `''` → `0`,
 * which reads as a valid pin meaning "trust nothing" while actually meaning
 * "the operator forgot". So the parse below accepts a decimal integer literal
 * and nothing else, and every other shape throws **by name** at boot.
 *
 * DNC-10 — THE KEY IS ITSELF THE BYPASS TO GUARD AGAINST
 * -----------------------------------------------------
 * Inverted: an attacker who wanted `trust proxy: true` back would not add a
 * `SKIP_*` variable — they would set `TRUST_PROXY_HOPS=99`. On every real chain
 * a hop count far beyond the topology's depth resolves to the **leftmost**
 * `X-Forwarded-For` entry, i.e. exactly the caller-chosen value `ADR-036` D1
 * refuses in writing. The parse is therefore **bounded** as well as strict, by
 * `MAX_TRUST_PROXY_HOPS` below. There is no `SKIP_*`, no `ALLOW_*`, no
 * `NODE_ENV` branch and no second key: `shared/quality/trust-proxy-dnc10-gate.spec.ts`
 * asserts that as an absence, with a companion case proving the matcher goes red.
 *
 * FUITE — the messages name the KEY and the observed SHAPE, never the value.
 * Same rule, and the same reason, as `config-preflight.ts`: the message reaches
 * stdout, the collected logs and the trace pipeline (`S-E02-14`), which redacts
 * but does not guess.
 */

/** The one declared configuration key. Spelled once, exported, never re-typed. */
export const TRUST_PROXY_HOPS_ENV = 'TRUST_PROXY_HOPS';

/**
 * The deepest topology this repository defines is **2** (Traefik → nginx → api,
 * `ADR-036` D2). A value above it cannot describe any deployment declared here,
 * and a hop count deeper than the real chain silently degrades into
 * `trust proxy: true` — Express pads, and the padded answer is the leftmost,
 * caller-injected entry.
 *
 * So the bound is not defensive tidiness: it is the DNC-10 rule expressed as a
 * number. A genuinely deeper edge (a CDN in front of Traefik) must raise this
 * constant **and** re-run `ADR-036` D7's re-derivation procedure, recording the
 * new value in the ADR. That is the intended friction.
 */
export const MAX_TRUST_PROXY_HOPS = 2;

/**
 * A declared key carrying a value the API cannot interpret.
 *
 * Deliberately NOT `MissingConfigError`: an absent key and a malformed key are
 * different operator errors, and reusing the absent-key message would tell an
 * operator to declare a variable they have already declared.
 */
export class InvalidConfigError extends Error {
  constructor(
    readonly key: string,
    readonly shape: string,
  ) {
    super(
      `Preflight configuration ÉCHEC — ${key} est déclarée mais illisible : ${shape}.\n` +
        `${key} doit être un entier décimal, sans signe, sans espace, entre 0 et ` +
        `${MAX_TRUST_PROXY_HOPS} inclus — le nombre de proxys inverses entre le socket de ` +
        `l'API et le client (ADR-036 D2 : 2 en production Traefik → nginx → api, 0 en local ` +
        `--profile app).\n` +
        `Aucune coercition n'est appliquée : « 2.0 », « +2 », « 0x2 », « 1e1 » et « true » sont ` +
        `refusés parce que Number() les accepterait en silence, et « » deviendrait 0 — ` +
        `un pin valide en apparence, un oubli en réalité (ADR-036 D3).\n` +
        `Aucune variable d'environnement ne peut assouplir ce contrôle (DNC-10).`,
    );
    this.name = 'InvalidConfigError';
  }
}

/**
 * Names WHY a raw value was refused, without ever echoing it.
 *
 * The operator gets a class of defect, not their own string back: the message
 * travels to stdout and the trace pipeline, and `TRUST_PROXY_HOPS` sits beside
 * secrets in the same environment record. A shape name is enough to fix it.
 */
function describeShape(candidate: string): string {
  if (candidate.length === 0) return 'chaîne vide (ou uniquement des espaces)';
  if (/^[+-]/.test(candidate)) return 'signe explicite en tête (+ ou -)';
  if (/^0[xXbBoO]/.test(candidate)) return 'préfixe de base non décimale (0x / 0b / 0o)';
  if (/[eE]/.test(candidate) && /^\d*[eE]/.test(candidate)) return 'notation exponentielle';
  if (candidate.includes('.') || candidate.includes(',')) return 'valeur non entière (séparateur décimal)';
  if (/\s/.test(candidate)) return 'espace interne';
  if (!/^\d+$/.test(candidate)) return 'caractères non numériques';
  return `entier hors bornes (maximum autorisé : ${MAX_TRUST_PROXY_HOPS})`;
}

/**
 * Parses `TRUST_PROXY_HOPS` — strictly, without coercion, without a fallback.
 *
 * Pure: takes the raw string, returns a number or throws. No `process.env`
 * read of its own (same mould as the rest of `shared/config/`, and the same
 * reason: a module that reads the environment cannot be tested honestly, and it
 * is where a hidden switch would go unnoticed).
 *
 * Accepts `/^\d+$/` after a trim, bounded by {@link MAX_TRUST_PROXY_HOPS}.
 * Everything else throws {@link InvalidConfigError} naming the key and the shape.
 *
 * @throws InvalidConfigError on any shape that is not a bounded decimal integer
 */
export function parseTrustProxyHops(raw: string | undefined): number {
  const candidate = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d+$/.test(candidate)) {
    throw new InvalidConfigError(TRUST_PROXY_HOPS_ENV, describeShape(candidate));
  }
  // Safe now, and only now: the literal is proven to be decimal digits only, so
  // parseInt cannot silently truncate a suffix it was never given.
  const hops = Number.parseInt(candidate, 10);
  if (hops > MAX_TRUST_PROXY_HOPS) {
    throw new InvalidConfigError(TRUST_PROXY_HOPS_ENV, describeShape(candidate));
  }
  return hops;
}

/**
 * Reads the key from a configuration source and parses it.
 *
 * Presence is `assertRequiredConfig`'s job (`TRUST_PROXY_HOPS` is in
 * `REQUIRED_ENV`, so an absent key is named at boot alongside the Keycloak keys,
 * in one message). This function is about the *value*, and it still refuses a
 * blank so that a caller reaching it directly cannot get a silent `0`.
 */
export function resolveTrustProxyHops(env: Record<string, string | undefined>): number {
  return parseTrustProxyHops(env[TRUST_PROXY_HOPS_ENV]);
}

/**
 * The minimal shape of the thing `applyTrustProxy` configures.
 *
 * Declared structurally rather than as `NestExpressApplication` so this module
 * stays free of a Nest import and remains unit-testable without a DI container.
 * `main.ts` passes a real `NestExpressApplication`, which is assignable — so the
 * typecheck gate still sees a renamed adapter API, which is precisely what a
 * cast (`as any`, `as unknown as { set }`) would have blinded it to.
 */
export interface TrustProxyTarget {
  set(setting: string, value: unknown): unknown;
}

/**
 * THE one applier. `main.ts` calls it; the supertest harness calls it.
 *
 * Returns the applied `N` so the caller can hand it to the extraction seam
 * (`shared/audit/client-hints.ts`) without re-reading the environment — the hop
 * count is decided once, in one place, and travels by argument from there.
 *
 * Never `true`, never `'*'`, never a literal: the value is always the parsed
 * key (`ADR-036` D1 refuses the blanket forms **in writing**, and
 * `shared/quality/trust-proxy-dnc10-gate.spec.ts` refuses them by test).
 */
export function applyTrustProxy(
  app: TrustProxyTarget,
  env: Record<string, string | undefined>,
): number {
  const hops = resolveTrustProxyHops(env);
  app.set('trust proxy', hops);
  return hops;
}
