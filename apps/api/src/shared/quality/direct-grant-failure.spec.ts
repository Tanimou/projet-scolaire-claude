import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DIRECT_GRANT_FAILURE_CODES,
  MFA_ENROLLED_REALM_ROLES,
  REALM_ROLES,
  classifyDirectGrantFailure,
  isMfaEnrolledRealmRole,
  mfaRequiredByInvitePolicy,
  type DirectGrantFailureCode,
  type DirectGrantFailureInput,
} from '@pilotage/contracts';

/**
 * S-E05-8 / PF-25 / ADR-082 §D1–§D2 — LA PREUVE COMPORTEMENTALE des deux
 * fonctions pures.
 *
 * POURQUOI CE FICHIER EST ICI ET PAS DANS `packages/contracts`
 * ------------------------------------------------------------
 * Le raisonnement est DÉJÀ écrit, une fois, à
 * `apps/api/src/shared/quality/calendar-window.spec.ts:22-37` : `packages/contracts`
 * n'a pas de runner (son `package.json` n'expose que `build`, `lint`,
 * `typecheck`), donc un `*.spec.ts` posé là ne serait exécuté par RIEN. Le
 * `moduleNameMapper` d'`apps/api/jest.config.js:19` résout
 * `^@pilotage/contracts$` vers la SOURCE, précisément pour qu'un symbole ajouté
 * dans le même commit soit lisible sans `dist/`. Cité plutôt que ré-argumenté.
 *
 * CE QUI EST REVENDIQUÉ, ET CE QUI NE L'EST PAS
 * ---------------------------------------------
 * REVENDIQUÉ : la table de vérité du classifieur, sa TOTALITÉ, sa
 * DISJONCTION (donc son indépendance à l'ordre des règles — la propriété dont
 * l'absence ÉTAIT le défaut), la table de vérité de la politique MFA sur le
 * domaine COMPLET des rôles realm, et la PURETÉ des deux modules.
 *
 * NON REVENDIQUÉ : ce que Keycloak répond réellement. Une seule des deux chaînes
 * de fixture a été MESURÉE (voir les groupes 2 et 3) ; aucune sonde vivante n'a
 * tourné dans cette tranche (Docker Desktop refuse de démarrer, 7ᵉ run
 * consécutif ; `pilotage@5432` vide). `scripts/keycloak-live-probe.js` STEP 6 est
 * expédié **NOT EXECUTED** exprès, pour que la prémisse P-1 soit déchargée par
 * une mesure le jour où Docker revient, au lieu de vieillir en folklore.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SECURITY_DIR = join(REPO_ROOT, 'packages', 'contracts', 'src', 'security');
const CLASSIFIER_PATH = join(SECURITY_DIR, 'direct-grant-failure.ts');
const POLICY_PATH = join(SECURITY_DIR, 'mfa-enrolment-policy.ts');

/**
 * Retire commentaires et littéraux de chaîne d'une source TypeScript.
 *
 * PF-220, textuellement : le stripper d'un gate a déjà blanchi 54 305 caractères
 * de code exécutable et rendu VACUEUSES toutes les assertions négatives en aval.
 * Deux protections ici : (1) `/` n'ouvre un commentaire QUE suivi de `/` ou `*`,
 * de sorte que `/\s+/g` — présent dans le classifieur — n'est pas pris pour un
 * commentaire ; (2) le résultat est CONTRÔLÉ (`expect` ci-dessous) : s'il ne
 * contient plus les jetons attendus, la suite rougit au lieu de passer sur rien.
 */
function executableCode(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  // `charAt` plutôt que l'indexation : `noUncheckedIndexedAccess` rend `s[i]`
  // `string | undefined`, et un `undefined` concaténé dans `out` serait
  // exactement le blanchiment silencieux que ce stripper doit éviter.
  while (i < n) {
    const c = source.charAt(i);
    const next = source.charAt(i + 1);
    if (c === '/' && next === '/') {
      while (i < n && source.charAt(i) !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source.charAt(i) === '*' && source.charAt(i + 1) === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += ' ';
      i += 1;
      while (i < n && source.charAt(i) !== quote) {
        if (source.charAt(i) === '\\') i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const CLASSIFIER_SOURCE = readFileSync(CLASSIFIER_PATH, 'utf8');
const POLICY_SOURCE = readFileSync(POLICY_PATH, 'utf8');

/* ================================================================== *
 * GROUPE 1 — L'UNION EST FERMÉE, ET SA VALEUR RUNTIME EST SA SOURCE
 * ================================================================== */

describe('direct-grant failure taxonomy — 1. l’union fermée', () => {
  it('DIRECT_GRANT_FAILURE_CODES porte EXACTEMENT les trois membres, sans doublon', () => {
    expect([...DIRECT_GRANT_FAILURE_CODES].sort()).toEqual([
      'account-setup-pending',
      'credentials-or-otp-rejected',
      'unclassified',
    ]);
    expect(new Set(DIRECT_GRANT_FAILURE_CODES).size).toBe(DIRECT_GRANT_FAILURE_CODES.length);
  });

  it('la valeur runtime et l’alias de type déclarent le MÊME ensemble', () => {
    // L'alias est PARSÉ depuis la source, jamais recopié ici : une union et une
    // constante qui divergent sont deux listes tenues à la main de plus.
    const alias = CLASSIFIER_SOURCE.split('export type DirectGrantFailureCode')[1] ?? '';
    const declaration = alias.split(';')[0] ?? '';
    const members = [...declaration.matchAll(/'([a-z-]+)'/g)].map((m) => m[1] ?? '').sort();
    expect(members).toEqual([...DIRECT_GRANT_FAILURE_CODES].sort());
  });

  it('AUCUN membre nommé « otp requis » n’existe — cette ABSENCE est le correctif', () => {
    for (const code of DIRECT_GRANT_FAILURE_CODES) {
      expect(code).not.toMatch(/^otp/);
      expect(code).not.toBe('otp_required');
      expect(code).not.toBe('invalid_credentials');
    }
  });
});

/* ================================================================== *
 * GROUPE 2 — RÉGRESSION NOMMÉE (a)(1) : LE MOT DE PASSE ERRONÉ
 * ================================================================== */

describe('direct-grant failure taxonomy — 2. régression (a)(1) : mot de passe erroné', () => {
  /**
   * La réponse MESURÉE au run 63 (2026-08-15) contre un conteneur Keycloak 26.0
   * important `infra/keycloak/realm-export.json`, candidat A →
   * `HTTP 401 Invalid user credentials`. Consignée à
   * `docs/daily-improvement-v3/traceability/CLOSED-L0.md:123`.
   */
  const MEASURED_WRONG_PASSWORD: DirectGrantFailureInput = {
    status: 401,
    error: 'invalid_grant',
    errorDescription: 'Invalid user credentials',
  };

  it('classe en `credentials-or-otp-rejected` — et NON en « OTP requis »', () => {
    expect(classifyDirectGrantFailure(MEASURED_WRONG_PASSWORD)).toBe(
      'credentials-or-otp-rejected',
    );
  });

  it('LE DÉFAUT LUI-MÊME : la sous-chaîne `credential` ne décide plus de rien', () => {
    // La cascade d'origine testait `description.includes('credential')` AVANT la
    // branche 401, si bien que cette chaîne exacte — qui contient `credential` —
    // classait une faute de frappe en `otp_required`. Le même contenu, sans le
    // statut ni l'`error`, ne doit produire AUCUN verdict confiant.
    expect(
      classifyDirectGrantFailure({ status: 500, errorDescription: 'Invalid user credentials' }),
    ).toBe('unclassified');
  });

  it('l’ambiguïté est PORTÉE PAR LE NOM : le même verdict couvre un TOTP faux', () => {
    // Keycloak répond la même chose ; il n'existe donc AUCUNE entrée qui
    // permette au classifieur de distinguer les deux. C'est asserté, pas espéré.
    const wrongOtp = classifyDirectGrantFailure(MEASURED_WRONG_PASSWORD);
    const wrongPassword = classifyDirectGrantFailure({
      status: 401,
      error: 'invalid_grant',
      errorDescription: 'invalid user credentials',
    });
    expect(wrongOtp).toBe(wrongPassword);
    expect(wrongOtp).toContain('or-otp');
  });
});

/* ================================================================== *
 * GROUPE 3 — RÉGRESSION NOMMÉE (a)(2) : LE COMPTE NON ACTIVÉ
 * ================================================================== */

describe('direct-grant failure taxonomy — 3. régression (a)(2) : actions requises en attente', () => {
  /**
   * Chaîne NON MESURÉE par cette routine. Affirmée par le commentaire du dépôt
   * `apps/api/src/modules/identity/register.controller.ts:241`. Grade : documentée
   * en interne, jamais observée. Décharge : sonde STEP 6, NOT EXECUTED.
   */
  const DOCUMENTED_SETUP_PENDING = 'Account is not fully set up';

  it('classe en `account-setup-pending`, et NON en refus d’identifiants', () => {
    expect(
      classifyDirectGrantFailure({
        status: 400,
        error: 'invalid_grant',
        errorDescription: DOCUMENTED_SETUP_PENDING,
      }),
    ).toBe('account-setup-pending');
  });

  it('l’ancre est la PHRASE ENTIÈRE — un fragment ne suffit pas', () => {
    // « on n'ancre jamais sur une aiguille qui est sous-chaîne propre d'une autre
    // phrase attendue » : la règle est ici EXÉCUTÉE, pas seulement écrite.
    for (const fragment of ['account', 'set up', 'not fully', 'setup']) {
      expect(
        classifyDirectGrantFailure({ status: 400, errorDescription: fragment }),
      ).toBe('unclassified');
    }
  });

  it('elle l’emporte même sur un 401 — les deux prédicats sont DISJOINTS', () => {
    expect(
      classifyDirectGrantFailure({
        status: 401,
        error: 'invalid_grant',
        errorDescription: `Account is not fully set up`,
      }),
    ).toBe('account-setup-pending');
  });
});

/* ================================================================== *
 * GROUPE 4 — NORMALISATION : CASSE ET ESPACES, ET RIEN D'AUTRE
 * ================================================================== */

describe('direct-grant failure taxonomy — 4. normalisation', () => {
  it('la casse et le ré-emballage d’espaces ne changent aucun verdict', () => {
    const variants = [
      'Account is not fully set up',
      'account is not fully set up',
      'ACCOUNT IS NOT FULLY SET UP',
      '  Account   is not\nfully  set up  ',
    ];
    for (const errorDescription of variants) {
      expect(classifyDirectGrantFailure({ status: 400, errorDescription })).toBe(
        'account-setup-pending',
      );
    }
  });

  it('la ponctuation N’EST PAS repliée — une normalisation plus large re-créerait des collisions', () => {
    expect(
      classifyDirectGrantFailure({ status: 400, errorDescription: 'Account-is-not-fully-set-up' }),
    ).toBe('unclassified');
  });
});

/* ================================================================== *
 * GROUPE 5 — DESCRIPTION ABSENTE, VIDE OU NULLE
 * ================================================================== */

describe('direct-grant failure taxonomy — 5. description absente / vide / nulle', () => {
  it('`null`, `undefined` et `\'\'` ne produisent aucun verdict confiant sans le statut', () => {
    expect(classifyDirectGrantFailure({ status: 500, errorDescription: null })).toBe(
      'unclassified',
    );
    expect(classifyDirectGrantFailure({ status: 500, errorDescription: undefined })).toBe(
      'unclassified',
    );
    expect(classifyDirectGrantFailure({ status: 500, errorDescription: '' })).toBe('unclassified');
    expect(classifyDirectGrantFailure({ status: 500 })).toBe('unclassified');
  });

  it('un 401 SANS corps reste un refus d’identifiants — le statut suffit', () => {
    expect(classifyDirectGrantFailure({ status: 401 })).toBe('credentials-or-otp-rejected');
    expect(classifyDirectGrantFailure({ status: 401, error: null, errorDescription: null })).toBe(
      'credentials-or-otp-rejected',
    );
  });
});

/* ================================================================== *
 * GROUPE 6 — `invalid_client` ET LES AUTRES `error` INCONNUS
 * ================================================================== */

describe('direct-grant failure taxonomy — 6. `error` inconnu', () => {
  it('`invalid_client` → `unclassified` : une mauvaise configuration n’est pas un mot de passe faux', () => {
    expect(
      classifyDirectGrantFailure({
        status: 400,
        error: 'invalid_client',
        errorDescription: 'Invalid client or Invalid client credentials',
      }),
    ).toBe('unclassified');
  });

  it('LE PIÈGE : ce corps contient DEUX fois `credential` et ne décide toujours rien', () => {
    // C'est la réponse d'un secret client erroné. Sous la cascade d'origine elle
    // annonçait « MFA requise » à l'utilisateur pour une panne de déploiement.
    const verdict = classifyDirectGrantFailure({
      status: 400,
      error: 'invalid_client',
      errorDescription: 'Invalid client credentials',
    });
    expect(verdict).toBe('unclassified');
    expect(verdict).not.toBe('credentials-or-otp-rejected');
  });

  it('`unauthorized_client` et `unsupported_grant_type` → `unclassified`', () => {
    for (const error of ['unauthorized_client', 'unsupported_grant_type', 'invalid_scope']) {
      expect(classifyDirectGrantFailure({ status: 400, error })).toBe('unclassified');
    }
  });
});

/* ================================================================== *
 * GROUPE 7 — TRANSPORT : KEYCLOAK À TERRE NE SE LIT PAS « MOT DE PASSE FAUX »
 * ================================================================== */

describe('direct-grant failure taxonomy — 7. transport', () => {
  it('502 / 503 / 504 et un corps illisible → `unclassified`, jamais un refus', () => {
    for (const status of [500, 502, 503, 504]) {
      const verdict = classifyDirectGrantFailure({ status, error: null, errorDescription: null });
      expect(verdict).toBe('unclassified');
      // La formulation négative est la garantie qui compte : c'est ce message-là
      // qui, rendu, dirait à tort « votre mot de passe est faux ».
      expect(verdict).not.toBe('credentials-or-otp-rejected');
    }
  });

  it('une passerelle HTML (aucun champ OAuth2) → `unclassified`', () => {
    expect(
      classifyDirectGrantFailure({ status: 502, errorDescription: '<html>Bad Gateway</html>' }),
    ).toBe('unclassified');
  });
});

/* ================================================================== *
 * GROUPE 8 — DISJONCTION, ORDRE, TOTALITÉ
 * ================================================================== */

describe('direct-grant failure taxonomy — 8. disjonction et totalité', () => {
  const STATUSES = [200, 400, 401, 403, 500, 502, Number.NaN];
  const ERRORS = [undefined, null, 'invalid_grant', 'invalid_client', 'INVALID_GRANT', ''];
  const DESCRIPTIONS = [
    undefined,
    null,
    '',
    'Invalid user credentials',
    'Account is not fully set up',
    'Account is disabled',
    'Invalid client credentials',
    'totp',
  ];

  /**
   * Implémentation de RÉFÉRENCE, écrite indépendamment et SANS ordre : chaque
   * prédicat est total et les deux sont exclusifs. Si le classifieur dépendait de
   * l'ordre de ses règles, il divergerait de celle-ci sur au moins un point du
   * produit cartésien ci-dessous.
   */
  function reference(input: DirectGrantFailureInput): DirectGrantFailureCode {
    const desc = (input.errorDescription ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const err = (input.error ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const setupPending = desc.includes('account is not fully set up');
    const rejected = !setupPending && (input.status === 401 || err === 'invalid_grant');
    if (setupPending) return 'account-setup-pending';
    if (rejected) return 'credentials-or-otp-rejected';
    return 'unclassified';
  }

  it('TOTALE : les 336 combinaisons rendent toutes un membre de l’union', () => {
    let seen = 0;
    for (const status of STATUSES) {
      for (const error of ERRORS) {
        for (const errorDescription of DESCRIPTIONS) {
          const verdict = classifyDirectGrantFailure({ status, error, errorDescription });
          expect(DIRECT_GRANT_FAILURE_CODES).toContain(verdict);
          seen += 1;
        }
      }
    }
    // Anti-vacuité : la boucle a réellement tourné.
    expect(seen).toBe(STATUSES.length * ERRORS.length * DESCRIPTIONS.length);
    expect(seen).toBeGreaterThanOrEqual(250);
  });

  it('INDÉPENDANTE DE L’ORDRE : identique à une référence à prédicats disjoints', () => {
    const disagreements: string[] = [];
    for (const status of STATUSES) {
      for (const error of ERRORS) {
        for (const errorDescription of DESCRIPTIONS) {
          const input = { status, error, errorDescription };
          if (classifyDirectGrantFailure(input) !== reference(input)) {
            disagreements.push(JSON.stringify(input));
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('les trois membres sont ATTEINTS par le produit — sinon la table serait morte', () => {
    const reached = new Set<DirectGrantFailureCode>();
    for (const status of STATUSES) {
      for (const error of ERRORS) {
        for (const errorDescription of DESCRIPTIONS) {
          reached.add(classifyDirectGrantFailure({ status, error, errorDescription }));
        }
      }
    }
    expect([...reached].sort()).toEqual([...DIRECT_GRANT_FAILURE_CODES].sort());
  });

  it('RÉSIDUEL NOMMÉ : le VERROUILLAGE de compte tombe sur le membre ambigu, DÉLIBÉRÉMENT', () => {
    // La politique du realm verrouille après 5 tentatives. Les phrases de cette
    // famille ne sont PAS mesurées ; sans mesure, un membre « verrouillé »
    // distinct serait un oracle inventé. Le comportement est donc figé ici pour
    // que la sonde puisse le CONTREDIRE le jour où elle tourne.
    for (const errorDescription of [
      'Account is disabled',
      'Account temporarily disabled',
      'Invalid user credentials',
    ]) {
      expect(
        classifyDirectGrantFailure({ status: 401, error: 'invalid_grant', errorDescription }),
      ).toBe('credentials-or-otp-rejected');
    }
  });
});

/* ================================================================== *
 * GROUPE 9 — LA POLITIQUE MFA, SUR LE DOMAINE COMPLET
 * ================================================================== */

describe('mfa enrolment policy — 9. table de vérité totale', () => {
  it('l’ensemble est EXACTEMENT `school_admin` + `teacher` (ADR-004)', () => {
    expect([...MFA_ENROLLED_REALM_ROLES].sort()).toEqual(['school_admin', 'teacher']);
  });

  it('COMPORTEMENT IDENTIQUE au littéral d’`invite.controller.ts` sur TOUS les rôles realm', () => {
    // Domaine COMPLET, pris de l'énumération partagée : un cinquième rôle ajouté
    // demain ne peut pas se glisser sans décision.
    const literalBehaviour = (role: string) => role === 'school_admin' || role === 'teacher';
    expect(REALM_ROLES.length).toBeGreaterThanOrEqual(4);
    for (const role of REALM_ROLES) {
      expect(isMfaEnrolledRealmRole(role)).toBe(literalBehaviour(role));
    }
    // `student` n'est pas dans `REALM_ROLES` mais est un rôle realm réel (E8-S1).
    expect(isMfaEnrolledRealmRole('student')).toBe(false);
  });

  it('`super_admin` → `false`, ENREGISTRÉ et non « corrigé »', () => {
    // Le canal d'invitation n'admet pas `super_admin` ; il ne reçoit donc AUCUN
    // `CONFIGURE_TOTP`. L'ajouter ferait affirmer `mfaRequired: true` pour des
    // comptes sans action requise en attente — un NOUVEAU mensonge. La vérité
    // mesurée est préservée ; l'écart est un résiduel à porter par sa propre
    // tranche (remède côté provisionnement Keycloak, insondable Docker à l'arrêt).
    expect(isMfaEnrolledRealmRole('super_admin')).toBe(false);
    expect(mfaRequiredByInvitePolicy(['super_admin'])).toBe(false);
  });

  it('TOTALE sur des entrées hostiles : jamais un `true` non mérité', () => {
    expect(isMfaEnrolledRealmRole('')).toBe(false);
    expect(isMfaEnrolledRealmRole('SCHOOL_ADMIN')).toBe(false);
    expect(isMfaEnrolledRealmRole(' teacher ')).toBe(false);
    expect(isMfaEnrolledRealmRole(null)).toBe(false);
    expect(isMfaEnrolledRealmRole(undefined)).toBe(false);
    expect(mfaRequiredByInvitePolicy([])).toBe(false);
    expect(mfaRequiredByInvitePolicy(null)).toBe(false);
    expect(mfaRequiredByInvitePolicy(undefined)).toBe(false);
    expect(mfaRequiredByInvitePolicy(['parent', 'student', 'inconnu'])).toBe(false);
  });

  it('la LISTE est vraie dès qu’UN rôle est enrôlé — c’est ce que `/me` projette', () => {
    expect(mfaRequiredByInvitePolicy(['teacher'])).toBe(true);
    expect(mfaRequiredByInvitePolicy(['school_admin'])).toBe(true);
    expect(mfaRequiredByInvitePolicy(['parent', 'teacher'])).toBe(true);
    expect(mfaRequiredByInvitePolicy(['offline_access', 'uma_authorization', 'parent'])).toBe(
      false,
    );
  });

  it('les deux prédicats partagent UN seul jugement — la liste délègue à l’unité', () => {
    for (const role of [...REALM_ROLES, 'student', 'inconnu']) {
      expect(mfaRequiredByInvitePolicy([role])).toBe(isMfaEnrolledRealmRole(role));
    }
  });
});

/* ================================================================== *
 * GROUPE 10 — PURETÉ : LA CONTRAINTE DE BUNDLE EDGE, EXÉCUTÉE
 * ================================================================== */

describe('les deux modules — 10. pureté', () => {
  const modules: [string, string][] = [
    ['direct-grant-failure.ts', CLASSIFIER_SOURCE],
    ['mfa-enrolment-policy.ts', POLICY_SOURCE],
  ];

  it('CONTRÔLE DU STRIPPER (PF-220) : le code exécutable n’a pas été blanchi', () => {
    // Sans ce contrôle, un stripper cassé rendrait TOUTES les assertions
    // négatives ci-dessous vacuement vertes.
    const classifier = executableCode(CLASSIFIER_SOURCE);
    const policy = executableCode(POLICY_SOURCE);
    expect(classifier).toContain('export function classifyDirectGrantFailure');
    expect(classifier).toContain('DIRECT_GRANT_FAILURE_CODES');
    expect(policy).toContain('export function mfaRequiredByInvitePolicy');
    expect(policy).toContain('export function isMfaEnrolledRealmRole');
    expect(classifier.length).toBeGreaterThan(400);
    expect(policy.length).toBeGreaterThan(300);
  });

  it('aucun des deux ne dépend de quoi que ce soit (bundle edge, PF-79)', () => {
    for (const [name, source] of modules) {
      const code = executableCode(source);
      expect(`${name}: ${/^\s*import\s/m.test(code)}`).toBe(`${name}: false`);
      expect(`${name}: ${code.includes('require(')}`).toBe(`${name}: false`);
      expect(`${name}: ${code.includes('process.env')}`).toBe(`${name}: false`);
      expect(`${name}: ${code.includes('node:')}`).toBe(`${name}: false`);
    }
  });

  it('aucune classe, aucun `instanceof` — la couture CJS `src`/`dist` (AC-1)', () => {
    for (const [name, source] of modules) {
      const code = executableCode(source);
      expect(`${name}: ${/\bclass\s+\w/.test(code)}`).toBe(`${name}: false`);
      expect(`${name}: ${code.includes('instanceof')}`).toBe(`${name}: false`);
    }
  });

  it('aucun interrupteur d’environnement (DNC-10) : rien ne peut désarmer la taxonomie', () => {
    for (const [name, source] of modules) {
      const code = executableCode(source);
      for (const token of ['NODE_ENV', 'SKIP_', 'ALLOW_', 'DISABLE_', 'BYPASS']) {
        expect(`${name}/${token}: ${code.includes(token)}`).toBe(`${name}/${token}: false`);
      }
    }
  });

  it('la PROVENANCE est portée par le fichier, avec ses deux grades distincts (AC-1 / C-14)', () => {
    // Le docblock DOIT citer la ligne de mesure et DOIT marquer la seconde chaîne
    // comme non mesurée. Présenter les deux comme également fondées serait
    // blanchir du folklore en mesure.
    expect(CLASSIFIER_SOURCE).toContain('CLOSED-L0.md:123');
    expect(CLASSIFIER_SOURCE).toContain('run 63');
    expect(CLASSIFIER_SOURCE).toMatch(/NON MESUR[ÉE]/);
    expect(CLASSIFIER_SOURCE).toContain('register.controller.ts:241');
    // La prémisse P-1 et sa décharge sont NOMMÉES (AC-13, PF-444).
    expect(CLASSIFIER_SOURCE).toContain('P-1');
    expect(CLASSIFIER_SOURCE).toContain('NOT EXECUTED');
  });
});
