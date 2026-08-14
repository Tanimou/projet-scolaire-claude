import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { TENANT_GUC } from '../prisma/prisma.service';

/**
 * S-E01-2b — LE GARDE HERMÉTIQUE de la migration RLS et de son vérificateur.
 *
 * DEUX GARDES, ET LA RAISON DE LA SÉPARATION
 * ------------------------------------------
 * `scripts/rls-isolation-check.js` fait la PREUVE : il construit une base
 * scratch, y applique le ledger, se connecte comme `app_user` et regarde les
 * lignes apparaître et disparaître selon le GUC. Il a besoin d'un PostgreSQL, il
 * échoue (jamais « skip ») quand il n'y en a pas, et il tourne dans `ci-gate.sh`
 * et `ci.yml`, pas dans jest.
 *
 * CE fichier est l'autre moitié : il tourne SANS base, dans `pnpm test`, sur
 * toute machine, et il assertit ce qu'un texte peut porter — la forme du
 * prédicat, le sens du cast, l'absence de `FORCE`, le garde `pg_roles`,
 * l'ensemble des 44 noms, le chemin de rollback, et la forme du vérificateur
 * lui-même. Les specs d'`apps/api` sont hermétiques par décision (ADR-039) et le
 * cliquet de skips est DÉSARMÉ dans ce dépôt : un spec jest qui exigerait une
 * base échouerait sur toute machine sans base, ou disparaîtrait dans un skip
 * toléré que personne ne relit. D'où cette répartition, qui est la convention
 * déjà établie par `schema-drift-check.js` / `schema-drift-gate.spec.ts`.
 *
 * CE QU'AUCUNE ASSERTION ICI NE DOIT LAISSER CROIRE
 * ------------------------------------------------
 * Que l'application est isolée par RLS. Elle ne l'est pas : elle se connecte
 * comme le PROPRIÉTAIRE des tables. Le dernier `describe` de ce fichier est un
 * cliquet sur cette phrase-là.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const API_PRISMA = join(REPO_ROOT, 'apps', 'api', 'prisma');
const SCHEMA_PATH = join(API_PRISMA, 'schema.prisma');
const MIGRATIONS_DIR = join(API_PRISMA, 'migrations');
const MIGRATION_DIR_NAME = '20260813120000_tenant_rls_policies';
const MIGRATION_PATH = join(MIGRATIONS_DIR, MIGRATION_DIR_NAME, 'migration.sql');
const CHECKER_PATH = join(REPO_ROOT, 'scripts', 'rls-isolation-check.js');

/** Chemins NOMMÉS : lecture directe, échec au chargement s'ils manquent (TOOL-17b). */
const MIGRATION = readFileSync(MIGRATION_PATH, 'utf8');
const SCHEMA = readFileSync(SCHEMA_PATH, 'utf8');
const CHECKER = readFileSync(CHECKER_PATH, 'utf8');

/** Commentaires SQL retirés, longueur préservée — voir `prisma.service.spec.ts`. */
function executableSql(source: string): string {
  return source.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** Commentaires JS retirés, longueur préservée. */
function executableJs(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

const MIGRATION_CODE = executableSql(MIGRATION);
const CHECKER_CODE = executableJs(CHECKER);

/**
 * Les noms de tables du tableau littéral de la migration.
 *
 * Extraits du SQL EXÉCUTABLE : un nom cité dans l'en-tête (les 11 exclues le
 * sont) ne doit pas être compté comme placé sous policy.
 */
function sqlArrayNames(constant: string): string[] {
  const block = new RegExp(`${constant}\\s+CONSTANT\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([\\s\\S]*?)\\]\\s*;`).exec(
    MIGRATION_CODE,
  );
  if (!block) return [];
  return [...(block[1] ?? '').matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1] as string);
}

function migrationTableNames(): string[] {
  return sqlArrayNames('tenant_scoped');
}

/**
 * Les tables tenant-scopées selon `schema.prisma` : le nom `@@map` de chaque
 * modèle déclarant `tenantId String`.
 */
function schemaTenantTables(): { withTenant: string[]; withoutTenant: string[] } {
  const withTenant: string[] = [];
  const withoutTenant: string[] = [];
  const models = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = models.exec(SCHEMA)) !== null) {
    const name = match[1] as string;
    const body = match[2] ?? '';
    const mapped = /@@map\("([^"]+)"\)/.exec(body);
    const table = mapped ? (mapped[1] as string) : name;
    if (/^\s*tenantId\s+String/m.test(body)) withTenant.push(table);
    else withoutTenant.push(table);
  }
  return { withTenant: withTenant.sort(), withoutTenant: withoutTenant.sort() };
}

const MIGRATION_TABLES = migrationTableNames();
/** Le sous-ensemble qui ne reçoit que `SELECT, INSERT` (ADR-032 §D7). */
const APPEND_ONLY = sqlArrayNames('append_only');
const { withTenant: SCHEMA_TENANT_TABLES, withoutTenant: SCHEMA_GLOBAL_TABLES } = schemaTenantTables();

describe('AC-1 — la migration existe, est RELUE À LA MAIN, et sa répétition seule est factorisée', () => {
  it('elle est au chemin attendu, dans le répertoire de migrations du ledger', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
    expect(readdirSync(MIGRATIONS_DIR)).toContain(MIGRATION_DIR_NAME);
  });

  it('elle n’a pas été produite par `db push`, et le dit', () => {
    // G-MIGRATION exige une migration RELUE. `db push` ne laisse pas de fichier,
    // donc l'absence de la chaîne est le seul témoin textuel disponible ; il est
    // faible seul, et c'est pourquoi l'en-tête l'énonce explicitement.
    expect(MIGRATION_CODE).not.toContain('db push');
    expect(MIGRATION).toContain('RELUE À LA MAIN');
  });

  it('les NOMS sont littéraux et diffables ; seule la boucle est factorisée', () => {
    // Une migration qui découvrirait ses tables depuis `information_schema` aurait
    // un effet dépendant de la base où elle atterrit — irrelisable, et non
    // déterministe sur les bases scratch du garde de dérive.
    expect(MIGRATION_CODE).not.toMatch(/from\s+information_schema/i);
    expect(MIGRATION_CODE).toMatch(/FOREACH\s+t\s+IN\s+ARRAY\s+tenant_scoped/);
    expect(MIGRATION_CODE).toContain("format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t)");
  });

  it('elle est RE-JOUABLE : chaque CREATE POLICY est précédé d’un DROP … IF EXISTS', () => {
    // `CREATE POLICY` n'a pas d'`IF NOT EXISTS` en PG 15 : sans le DROP, une
    // application partielle ne peut pas être relancée.
    expect(MIGRATION_CODE).toContain("DROP POLICY IF EXISTS tenant_isolation ON public.%I");
    const dropAt = MIGRATION_CODE.indexOf('DROP POLICY IF EXISTS tenant_isolation');
    const createAt = MIGRATION_CODE.indexOf('CREATE POLICY tenant_isolation');
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
  });

  it('une table absente FAIT ÉCHOUER la migration au lieu d’être sautée', () => {
    // Sauter reviendrait à livrer une policy manquante avec un `migrate deploy`
    // vert — la forme exacte du défaut que cette story existe pour refermer.
    expect(MIGRATION_CODE).toMatch(/to_regclass\(format\('public\.%I', t\)\) IS NULL/);
    expect(MIGRATION_CODE).toMatch(/RAISE EXCEPTION/);
  });
});

describe('AC-2/AC-3/AC-4 — le prédicat, et les trois façons de l’écrire faux', () => {
  it('il caste en uuid, avec missing_ok ET nullif, à l’identique en USING et WITH CHECK', () => {
    const predicate = `nullif(current_setting('${TENANT_GUC}', true), '')::uuid = tenant_id`;
    // Deux occurrences : USING et WITH CHECK. Les compter interdit d'en écrire une
    // et d'oublier l'autre — cas où PostgreSQL retombe silencieusement sur USING.
    const occurrences = MIGRATION_CODE.split(predicate).length - 1;
    expect(occurrences).toBe(2);
    expect(MIGRATION_CODE).toContain('USING (');
    expect(MIGRATION_CODE).toContain('WITH CHECK (');
  });

  it('le second argument de current_setting (missing_ok) n’est jamais omis', () => {
    // Sans lui, toute connexion n'ayant jamais posé le GUC lève 42704 : migrations,
    // seeds, health checks et chaque job BullMQ cassent dès le premier jour.
    for (const call of MIGRATION_CODE.match(/current_setting\([^)]*\)/g) ?? []) {
      expect(call).toContain(', true)');
    }
  });

  it('le `nullif` est présent partout où `current_setting` est casté (F-1, mesuré)', () => {
    // APRÈS le COMMIT d'un `set_config(…, true)`, le GUC vaut `''` et NON NULL :
    // un cast nu lèverait 22P02 sur la DEUXIÈME requête de chaque connexion du
    // pool. Prisma mutualise ses connexions, donc c'est l'état de RÉGIME.
    const bareCast = new RegExp(`current_setting\\('${TENANT_GUC.replace(/\./g, '\\.')}',\\s*true\\)\\s*::\\s*uuid`);
    expect(MIGRATION_CODE).not.toMatch(bareCast);
  });

  it('il ne compare jamais en texte, dans aucun sens (AC-3)', () => {
    expect(MIGRATION_CODE).not.toMatch(/tenant_id\s*::\s*text/i);
    expect(MIGRATION_CODE).not.toMatch(/::\s*text\s*=\s*tenant_id/i);
  });

  it('il n’écrit JAMAIS la forme fail-open `IS NULL OR` (DNC-10)', () => {
    expect(MIGRATION_CODE).not.toMatch(/IS\s+NULL\s+OR/i);
    expect(MIGRATION_CODE).not.toMatch(/\bOR\s+true\b/i);
  });

  it('la policy est FOR ALL TO PUBLIC, jamais nominative', () => {
    // `TO app_user` exempterait en silence tout AUTRE rôle non-propriétaire.
    expect(MIGRATION_CODE).toMatch(/FOR\s+ALL\s+TO\s+PUBLIC/);
    expect(MIGRATION_CODE).not.toMatch(/CREATE POLICY[\s\S]{0,200}TO\s+app_user/);
  });
});

describe('AC-5 — les GRANTs portent sur les 44, et survivent à un cluster sans le rôle', () => {
  it('ils ne sont jamais `ON ALL TABLES IN SCHEMA public`', () => {
    // Cette forme donnerait à `app_user` les tables SANS policy — un accès non
    // filtré offert par le geste même qui prétend restreindre.
    expect(MIGRATION_CODE).not.toMatch(/ON\s+ALL\s+TABLES\s+IN\s+SCHEMA/i);
    expect(MIGRATION_CODE).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO app_user");
  });

  it('ils sont gardés par `pg_roles`, mais la moitié SÉCURITÉ reste inconditionnelle', () => {
    expect(MIGRATION_CODE).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM pg_roles WHERE rolname = 'app_user'\s*\)/);
    expect(MIGRATION_CODE).toMatch(/IF has_app_user THEN/);
    // La preuve que la garde n'enveloppe PAS l'ENABLE : l'ENABLE apparaît AVANT le
    // premier `IF has_app_user THEN` du corps de la boucle.
    const enableAt = MIGRATION_CODE.indexOf('ENABLE ROW LEVEL SECURITY');
    const guardAt = MIGRATION_CODE.indexOf('IF has_app_user THEN');
    expect(enableAt).toBeGreaterThan(-1);
    expect(enableAt).toBeLessThan(guardAt);
  });

  it('DEUX jeux de privilèges : les tables APPEND-ONLY ne reçoivent JAMAIS UPDATE ni DELETE', () => {
    // Un GRANT uniforme donnerait UPDATE/DELETE sur `audit_log` au rôle que
    // l'application s'apprête à utiliser. `prev_hash` serait réinscriptible, donc
    // une falsification pourrait être rendue COHÉRENTE — indétectable par
    // vérification de chaîne. L'audit append-only est non négociable
    // (GUARDRAILS §1). `GRANTED == tenantCols` ne voit RIEN de tout ça : le
    // nombre de tables est identique dans les deux cas.
    expect(MIGRATION_CODE).toContain("GRANT SELECT, INSERT ON public.%I TO app_user");
    expect(MIGRATION_CODE).toMatch(/IF\s+t\s*=\s*ANY\s*\(append_only\)\s*THEN/);

    // La branche restrictive vient AVANT la branche DML : un `ELSE` perdu par une
    // résolution de conflit retire des privilèges au lieu d'en ajouter.
    const restrictiveAt = MIGRATION_CODE.indexOf("GRANT SELECT, INSERT ON public.%I TO app_user");
    const fullDmlAt = MIGRATION_CODE.indexOf('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO app_user');
    expect(restrictiveAt).toBeGreaterThan(-1);
    expect(fullDmlAt).toBeGreaterThan(restrictiveAt);
  });

  it('le jeu APPEND-ONLY est nommé, sous-ensemble des 44, et ne peut pas s’élargir en silence', () => {
    expect(APPEND_ONLY).toEqual(['audit_log', 'conversation_message']);
    // Sous-ensemble strict des 44 : une table append-only hors `tenant_scoped` ne
    // recevrait AUCUN grant — l'exemption serait muette au lieu d'être
    // restrictive. La migration REFUSE de s'appliquer dans ce cas.
    for (const table of APPEND_ONLY) expect(MIGRATION_TABLES).toContain(table);
    expect(MIGRATION_CODE).toMatch(/NOT\s*\(\s*t\s*=\s*ANY\s*\(tenant_scoped\)\s*\)/);
    expect(MIGRATION_CODE).toMatch(/append-only public\.% est absente de tenant_scoped/);

    // La direction qui serait une PANNE, pas un durcissement : `conversation_report`
    // porte `status`/`reviewed_by`/`reviewed_at` — la modération la fait MUTER.
    expect(APPEND_ONLY).not.toContain('conversation_report');
    expect(MIGRATION).toContain("`conversation_report` n'est PAS dans ce jeu");
  });

  it('le vérificateur assertit la même coupure, dans les DEUX directions', () => {
    // Le sens « aucun privilège au-delà de SELECT/INSERT » est vert à vide si le
    // GRANT n'a jamais atterri. Le plancher d'atteignabilité vient donc d'abord.
    expect(CHECKER_CODE).toContain('APPEND_ONLY_REACHED');
    expect(CHECKER_CODE).toContain('APPEND_ONLY_WRITE');
    expect(CHECKER_CODE).toContain("privilege_type NOT IN ('SELECT', 'INSERT')");
    for (const table of APPEND_ONLY) expect(CHECKER_CODE).toContain(`'${table}'`);
  });

  it('le schéma est accordé nominativement, et aucune séquence ne l’est', () => {
    // Mesuré : zéro séquence dans `public` (clés primaires en uuid), donc
    // « l'accès aux séquences dont il a besoin » se résout à RIEN.
    expect(MIGRATION_CODE).toContain('GRANT USAGE ON SCHEMA public TO app_user');
    expect(MIGRATION_CODE).not.toMatch(/GRANT[^;]*ON\s+(ALL\s+)?SEQUENCE/i);
  });
});

describe('AC-13 — les 44 noms ne peuvent pas dériver de `schema.prisma`', () => {
  it('les deux ensembles sont NON VIDES avant toute comparaison', () => {
    // Deux listes vides sont « égales ». Le plancher vient en premier.
    expect(MIGRATION_TABLES.length).toBe(44);
    expect(SCHEMA_TENANT_TABLES.length).toBe(44);
    expect(new Set(MIGRATION_TABLES).size).toBe(44);
  });

  it('ÉGALITÉ D’ENSEMBLES dans les DEUX sens', () => {
    // Un seul sens laisserait passer la moitié dangereuse : un 45e modèle
    // tenant-scopé livré sans policy. Le garde de dérive de schéma ne peut PAS le
    // voir — `migrate diff` ignore les policies — donc c'est ici ou nulle part.
    const inSchemaNotInMigration = SCHEMA_TENANT_TABLES.filter((t) => !MIGRATION_TABLES.includes(t));
    const inMigrationNotInSchema = MIGRATION_TABLES.filter((t) => !SCHEMA_TENANT_TABLES.includes(t));
    expect(inSchemaNotInMigration).toEqual([]);
    expect(inMigrationNotInSchema).toEqual([]);
  });

  it('les tables SANS `tenant_id` sont nommées et classées dans l’en-tête', () => {
    // Écrire « RLS est activé » sans nommer celles-ci serait la surclamation PF-02
    // répétée un cran plus bas. Les six DÉRIVÉES sont le résidu de cette story.
    const derived = [
      'grade_revision',
      'announcement_receipt',
      'branding',
      'import_row',
      'user_role',
      'outbox_event',
    ];
    for (const table of derived) {
      expect(SCHEMA_GLOBAL_TABLES.concat('_prisma_migrations')).toContain(table);
      expect(MIGRATION).toContain(table);
      expect(MIGRATION_TABLES).not.toContain(table);
    }
    // `tenant` est exclue DÉLIBÉRÉMENT : la couture identité doit la lire PAR SLUG
    // avant qu'un tenant soit résolu.
    expect(MIGRATION_TABLES).not.toContain('tenant');
    expect(MIGRATION).toContain('AUTO-DISCRIMINANTE');
  });
});

describe('AC-12 — le rollback est écrit EN ENTIER, et la logique expand/contract est explicite', () => {
  it('l’en-tête porte le DROP, le DISABLE et les REVOKE', () => {
    expect(MIGRATION).toContain('DROP POLICY IF EXISTS tenant_isolation ON public.%I');
    expect(MIGRATION).toContain('DISABLE ROW LEVEL SECURITY');
    expect(MIGRATION).toContain('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM app_user');
    expect(MIGRATION).toContain('REVOKE USAGE ON SCHEMA public FROM app_user');
  });

  it('il énonce POURQUOI un DROP/DISABLE suffit — expand pur, aucune phase contract', () => {
    expect(MIGRATION).toContain('EXPAND PUR');
    expect(MIGRATION).toContain("Il n'y a pas de phase contract");
  });

  it('et il est EXÉCUTÉ par le vérificateur, pas seulement écrit', () => {
    // Un rollback jamais joué est une assertion sur un commentaire.
    expect(CHECKER_CODE).toContain('AC-12 the rollback removes every policy');
    expect(CHECKER_CODE).toContain('AC-12 the rollback returns relrowsecurity to false');
  });
});

describe('Le vérificateur exécuté — il ÉCHOUE, il ne saute jamais, et il prouve qui il est', () => {
  it('il partage l’adresse et le client PostgreSQL des autres gardes, jamais un littéral', () => {
    expect(CHECKER_CODE).toMatch(/require\(\s*'\.\/lib\/default-database-url'\s*\)/);
    expect(CHECKER_CODE).toMatch(/require\(\s*'\.\/lib\/postgres-client-path'\s*\)/);
    expect(CHECKER_CODE).toMatch(/process\.env\.DATABASE_URL\s*\|\|/);
    expect(CHECKER_CODE).not.toMatch(/postgresql:\/\/[^'"\s]*@/);
  });

  it('le mot de passe passe par l’ENVIRONNEMENT, jamais par argv (ADR-025 D6)', () => {
    expect(CHECKER_CODE).toContain('PGPASSWORD');
    // Une chaîne de connexion en argument publierait le mot de passe dans la table
    // des processus de l'hôte.
    expect(CHECKER_CODE).not.toMatch(/'--dbname'|`postgresql:\/\//);
  });

  it('il REFUSE de faire du DDL sur une adresse non-loopback, sans échappatoire', () => {
    expect(CHECKER_CODE).toContain('isLoopbackHost');
    expect(CHECKER_CODE).toContain('non-loopback address');
    // DNC-10 : aucune variable ni drapeau ne doit pouvoir lever ce refus.
    expect(CHECKER_CODE).not.toMatch(/process\.env\.[A-Z_]*(FORCE|SKIP|ALLOW|BYPASS)/);
  });

  it('il n’a AUCUN verdict « skipped » : une tenancy gate qui ne tourne pas n’a pas d’avis', () => {
    // DNC-08. Le cliquet de skips de ce dépôt est DÉSARMÉ : un « skip » serait
    // définitivement invisible.
    expect(CHECKER_CODE).toMatch(/isolated:\s*0/);
    expect(CHECKER_CODE).toMatch(/tooling_unavailable:\s*1/);
    expect(CHECKER_CODE).toMatch(/not_isolated:\s*2/);
    expect(CHECKER_CODE).not.toMatch(/skipped:\s*0/);
  });

  it('il porte LE CONTRÔLE POSITIF, sans quoi tout serait vert pour la mauvaise raison', () => {
    // `app_user` n'avait AUCUN privilège avant cette migration : un test qui
    // n'assertait que « les lignes étrangères sont invisibles » aurait été vert
    // sur une base sans la moindre policy.
    expect(CHECKER_CODE).toContain('POSITIVE CONTROL: with GUC = tenant A, A rows ARE VISIBLE');
    expect(CHECKER_CODE).toContain('POSITIVE CONTROL: an OWN-tenant INSERT is accepted');
    // Et un « permission denied » est un ÉCHEC bruyant, jamais lu comme isolation.
    expect(CHECKER_CODE).toContain('permission denied');
    expect(CHECKER_CODE).toContain('which is a MISSING GRANT and not evidence of isolation');
  });

  it('il prouve AS QUI il s’est connecté avant la moindre assertion de visibilité (AC-14)', () => {
    expect(CHECKER_CODE).toContain('AC-14 the connection under test is NOT the table owner');
    expect(CHECKER_CODE).toContain('AC-14 the connection under test does not carry BYPASSRLS');
  });

  it('il assertit l’ACCORD des trois comptes, jamais un 44 en dur (anti-dérive)', () => {
    // Un 44 en dur serait satisfaisable en SUPPRIMANT une table. Un accord ne
    // l'est pas, et il survit à la croissance du schéma.
    expect(CHECKER_CODE).toContain('tenantCols');
    expect(CHECKER_CODE).not.toMatch(/toBe\(\s*44\s*\)|===\s*44/);
  });

  it('il nomme le même GUC que le TypeScript', () => {
    expect(CHECKER_CODE).toContain(`const TENANT_GUC = '${TENANT_GUC}'`);
  });

  it('il ne s’exécute PAS à l’import — le spec peut le lire sans créer de base', () => {
    expect(CHECKER_CODE).toContain('require.main === module');
  });
});

describe('Le vérificateur est CÂBLÉ — dans `ci-gate.sh` ET dans `ci.yml`, qui ne s’appellent pas', () => {
  const GATE_SH = readFileSync(join(REPO_ROOT, 'scripts', 'ci-gate.sh'), 'utf8');
  const CI_YML = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  /** Lignes de commentaire retirées — un stage commenté n'exécute rien. */
  const stripShellComments = (source: string): string => source.replace(/^\s*#.*$/gm, '');
  const stripYamlComments = (source: string): string => source.replace(/^\s*#.*$/gm, '');

  it('un stage COMMENTÉ ne satisfait pas l’ancrage (la direction qui échoue)', () => {
    expect(stripShellComments('  # run_stage 600 "x" node scripts/rls-isolation-check.js')).not.toContain(
      'rls-isolation-check.js',
    );
    expect(stripShellComments('  run_stage 600 "x" node scripts/rls-isolation-check.js')).toContain(
      'rls-isolation-check.js',
    );
  });

  it('`ci-gate.sh` le lance, avec une borne numérique (TOOL-06)', () => {
    expect(stripShellComments(GATE_SH)).toMatch(
      /run_stage\s+\d+\s+"rls isolation"\s+node\s+scripts\/rls-isolation-check\.js/,
    );
  });

  it('`ci.yml` le lance AUSSI — il re-liste les stages, il n’appelle pas `ci-gate.sh`', () => {
    // Sans cette moitié, un stage ajouté au seul `ci-gate.sh` ne tournerait JAMAIS
    // en CI (S-E02-2 AC-4).
    expect(CI_YML).not.toContain('bash scripts/ci-gate.sh');
    expect(stripYamlComments(CI_YML)).toContain('- run: node scripts/rls-isolation-check.js');
    // …et le rôle non-propriétaire est fourni au job, faute de quoi le checker
    // échouerait faute d'adresse — ce qui serait un rouge honnête mais inutile.
    expect(stripYamlComments(CI_YML)).toMatch(/DATABASE_URL_APP:\s*postgresql:\/\/app_user/);
  });

  it('il tourne AVANT `prisma generate` et AVANT le build, comme le garde de dérive', () => {
    // Le ledger doit être refusé avant qu'un client soit généré contre lui.
    //
    // Ancré sur le STAGE `run_stage … "prisma generate"`, pas sur la chaîne
    // « prisma generate » : celle-ci apparaît d'abord dans la DÉFINITION de la
    // fonction shell, bien avant son appel, et l'ancrage naïf compare donc deux
    // choses sans rapport. Vérifié dans la direction qui échoue.
    const code = stripShellComments(GATE_SH);
    const rlsAt = code.indexOf('scripts/rls-isolation-check.js');
    const generateAt = code.search(/run_stage\s+\d+\s+"prisma generate"/);
    expect(rlsAt).toBeGreaterThan(-1);
    expect(generateAt).toBeGreaterThan(-1);
    expect(rlsAt).toBeLessThan(generateAt);
  });

  it('aucun `continue-on-error` ne le rend décoratif', () => {
    const step = CI_YML.slice(CI_YML.indexOf('- run: node scripts/rls-isolation-check.js'));
    expect(step.slice(0, 200)).not.toContain('continue-on-error');
  });
});

describe('Règle ADR — une citation qui ne résout pas est pire que pas de citation', () => {
  const ADR_DIR = join(REPO_ROOT, 'docs', 'adr');
  /** Les numéros d'ADR réellement présents sur le disque. */
  const ADR_NUMBERS = new Set(
    readdirSync(ADR_DIR)
      .map((name) => /^ADR-(\d{3})-/.exec(name)?.[1])
      .filter((n): n is string => Boolean(n)),
  );
  /** Les numéros CITÉS par les artefacts de cette story, commentaires COMPRIS. */
  const cited = (source: string): string[] => [
    ...new Set([...source.matchAll(/ADR-(\d{3})/g)].map((m) => m[1] as string)),
  ];

  it('le registre lu n’est pas vide, et la direction qui échoue échoue bien', () => {
    // Un répertoire vide rendrait chaque « résout » vrai pour rien.
    expect(ADR_NUMBERS.size).toBeGreaterThanOrEqual(20);
    expect(ADR_NUMBERS.has('032')).toBe(true);
    // Le contrôle négatif — `has()` doit pouvoir répondre `false`, sinon les deux
    // cas ci-dessous passent pour rien.
    //
    // Il est ancré sur `000`, RÉSERVÉ PAR CONSTRUCTION : la numérotation des ADR
    // commence à `001`, donc aucun ADR légitime ne peut jamais occuper ce numéro.
    // La version précédente ancrait ce contrôle sur le PROCHAIN numéro libre du
    // moment (`042`) : elle prenait donc en OTAGE le numéro suivant, et le premier
    // ADR écrit après elle faisait rougir cette suite sans avoir rien cassé.
    //
    // Ce n'est pas une hypothèse : DEUX slices ont réclamé `042` en deux jours —
    // `S-E01-2c` / `PF-183` (isolation par chemin de clé étrangère, PR #245, encore
    // ouverte) et `S-E01-1a` (cette couture d'identité, renumérotée en `ADR-043` au
    // moment du land, justement à cause de cette collision). Le premier des deux à
    // fusionner aurait rendu `main` rouge ici, sur un fichier que ni l'un ni l'autre
    // n'aurait eu de raison de regarder.
    //
    // Un contrôle négatif ne doit pas être une réservation de numéro.
    expect(ADR_NUMBERS.has('000')).toBe(false);
    expect(cited('voir ADR-000 D1')).toEqual(['000']);
  });

  it.each([
    ['migration.sql', MIGRATION],
    ['rls-isolation-check.js', CHECKER],
  ])('%s ne cite QUE des ADR qui existent dans docs/adr/', (_name, source) => {
    // Un lecteur qui suit la citation pour comprendre POURQUOI il n'y a pas de
    // `FORCE` doit trouver un fichier. Rien ne détectait ça auparavant : une
    // décision architecturale nouvelle peut atterrir en citant un document qui
    // n'existe pas, et tous les autres gardes restent verts.
    const numbers = cited(source);
    expect(numbers.length).toBeGreaterThan(0);
    for (const number of numbers) expect([...ADR_NUMBERS]).toContain(number);
  });

  it('la migration cite la décision qui porte VRAIMENT le choix « pas de FORCE »', () => {
    // ADR-032 §D5 — et non un commentaire de migration qui se déclarerait
    // supersédant : une décision de record ne peut pas être supersédée par du SQL.
    expect(MIGRATION).toContain('ADR-032 §D5');
    expect(MIGRATION).toContain('ADR-032 §D6');
    expect(MIGRATION).toContain('ADR-032 §D7');
    expect(MIGRATION).toContain('ADR-032 §D8');
    // Cette ligne ne dit PAS « le numéro 042 est vide » — elle dit « cette
    // migration-ci ne cite pas la décision d'un AUTRE seam ». `042` est réservé à
    // l'isolation par chemin de clé étrangère (`PF-183`, PR #245, encore ouverte)
    // et `043` à la couture d'identité (`S-E01-1a`) ; les trois seams sont voisins
    // et faciles à confondre. L'assertion reste donc vraie quand `ADR-042`
    // atterrira, et c'est le but : elle porte sur ce que la migration CITE, pas sur
    // ce que `docs/adr/` CONTIENT.
    expect(MIGRATION).not.toContain('ADR-042');
    expect(MIGRATION).not.toContain('ADR-043');
  });

  it('ADR-032 porte réellement §D5–§D8, et son §Deferred item 1 ne dit plus le contraire', () => {
    // La moitié qui manquait : le fichier CITÉ doit contenir la décision citée,
    // sinon la citation résout vers un document qui dit l'inverse.
    const adr = readFileSync(join(ADR_DIR, 'ADR-032-tenant-enforcement.md'), 'utf8');
    for (const heading of ['### D5 —', '### D6 —', '### D7 —', '### D8 —']) {
      expect(adr).toContain(heading);
    }
    expect(adr).toContain('Partially superseded by §D5');
    expect(adr).toContain('Satisfied and extended by §D6');
    // Et l'ADR ne doit pas se mettre à surclamer non plus : le décalage qu'il
    // enregistre est exactement ce que PF-02 reproche à la prose d'origine.
    expect(adr).toContain('stays `in-progress`');
    expect(adr).toContain('connection cutover');
  });
});

describe('G-TRUTH — aucune phrase du diff ne peut se lire « l’app est isolée par RLS »', () => {
  /** Les artefacts que cette story écrit ou réécrit, et qui parlent d'isolation. */
  const ARTEFACTS: Array<[string, string]> = [
    ['migration.sql', MIGRATION],
    ['rls-isolation-check.js', CHECKER],
    [
      'prisma.service.ts',
      readFileSync(join(REPO_ROOT, 'apps', 'api', 'src', 'shared', 'prisma', 'prisma.service.ts'), 'utf8'),
    ],
  ];

  it.each(ARTEFACTS)('%s énonce explicitement la limite au lieu de la taire', (_name, source) => {
    // La surclamation EST le défaut que PF-02 enregistre. Chaque artefact doit
    // porter la phrase, pas seulement l'ADR que personne n'ouvre.
    expect(source).toMatch(/PAS ISOL|NOT isolated|n'est TOUJOURS PAS isolée|N'EST PAS ISOLÉE/i);
    expect(source).toMatch(/propriétaire|owner/i);
  });

  it('la migration nomme la bascule de connexion comme l’étape restante', () => {
    expect(MIGRATION).toContain('BASCULE DE CONNEXION');
    expect(CHECKER).toContain('CONNECTION CUTOVER');
  });

  it('l’absence de FORCE est une DÉCISION consignée, pas un oubli', () => {
    expect(MIGRATION_CODE).not.toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
    // …et l'en-tête, lui, en parle : c'est la différence entre un oubli et un choix.
    expect(MIGRATION).toContain('POURQUOI PAS `FORCE ROW LEVEL SECURITY`');
  });
});
