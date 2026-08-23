import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP_ROLE_REQUIRED_PRIVILEGES } from '../../shared/prisma/tenant-scope';

/**
 * S-E01-1l — `alerts` entre dans la portée tenant, la clôture de privilèges
 * passe de 38 à 47 paires, et la règle « une écriture LIT des colonnes » cesse
 * d'être accidentellement vraie (ADR-060).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS (DNC-06)             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * RIEN ICI NE TOUCHE POSTGRESQL. Aucune connexion, aucun GUC, aucune policy.
 * Ce fichier prouve des propriétés LEXICALES de la source — l'ordre `try` /
 * `run` / `catch`, l'absence de récupération DANS une portée, l'absence d'appel
 * au service de notifications DANS une portée, et le fait que le constructeur
 * de `MeetingRequestsService` ne détient plus de client propriétaire.
 *
 * POURQUOI LEXICALEMENT ET PAS PAR COMPORTEMENT (PF-247) : la règle ADR-058 §D1
 * est TRANSACTIONNELLE. Un faux `run` qui appelle `fn(client)` n'ouvre aucune
 * transaction, donc rien ne peut être AVORTÉ, donc AUCUN test à faux client —
 * y compris ceux de ce fichier — ne peut distinguer « la récupération ouvre une
 * portée fraîche » de « elle réutilise une transaction morte ». La preuve
 * exécutée vit ailleurs : `scripts/tenant-adversarial-check.js` et
 * `scripts/rls-isolation-check.js`, contre le conteneur `pilotage_postgres`.
 *
 * Cet agent n'exécute NI jest NI typecheck (budget CPU : seul le test-architect
 * lance la chaîne). Ce qui a réellement tourné dans cette tranche est
 * l'ATTRIBUTION (`node scripts/tenant-adversarial-check.js`, deux fois,
 * figures byte-identiques) et la requête de grants sur la base de la pile.
 */

const ALERTS = readFileSync(join(__dirname, 'alerts.service.ts'), 'utf8');
const MEETINGS = readFileSync(join(__dirname, 'meeting-requests.service.ts'), 'utf8');

/**
 * Les intervalles de texte couverts par un callback `this.scope.run(...)`.
 *
 * Même mécanique que le contrôleur d'attribution : on part de l'ouverture, on
 * apparie la parenthèse, et on FAIL-CLOSE si l'appariement échoue (un intervalle
 * qui court jusqu'à EOF marquerait tout le reste du fichier comme couvert).
 */
function scopeRanges(source: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const match of source.matchAll(/this\.scope\.run\s*\(/g)) {
    const open = match.index! + match[0].length - 1;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) {
          ranges.push({ start: open, end: i });
          break;
        }
      }
    }
  }
  return ranges;
}

const bodyOf = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(to, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

// ---------------------------------------------------------------------------
// (a) ADR-058 §D1 — TOUTE RÉCUPÉRATION D'ERREUR SORT DE SA PORTÉE
// ---------------------------------------------------------------------------

describe('ADR-058 §D1 — aucun `catch` ne vit dans un callback de portée', () => {
  /**
   * LA FORME INTERDITE est « rattraper DANS la portée et continuer d'y émettre ».
   * `alerts` porte CINQ récupérations qui avalent et continuent, contre trois
   * pour `remediation` : c'est le module qui rend la règle majoritaire, et donc
   * celui où l'oublier coûterait le plus. Un `catch` avalé À L'INTÉRIEUR d'une
   * transaction interactive fait dégénérer le `COMMIT` en `ROLLBACK` : la
   * mutation que le `catch` promettait de ne jamais annuler disparaît, pendant
   * que le handler rend 200.
   */
  const files: ReadonlyArray<readonly [string, string, number]> = [
    ['alerts.service.ts', ALERTS, 22],
    ['meeting-requests.service.ts', MEETINGS, 3],
  ];

  for (const [name, source, minimum] of files) {
    it(`${name} — aucun callback de portée ne contient le mot-clé \`catch\``, () => {
      const ranges = scopeRanges(source);
      // NON-VACUITÉ dans les deux sens : un fichier dont les portées ne
      // s'apparient pas rendrait `ranges` vide et l'assertion vide aussi.
      expect(ranges.length).toBeGreaterThanOrEqual(minimum);
      const offenders = ranges
        .filter((r) => source.slice(r.start, r.end).includes('catch'))
        .map((r) => source.slice(r.start, r.start + 80));
      expect(offenders).toEqual([]);
    });
  }

  it('recordMeetingIntent : `try` AVANT la portée de création, `catch` APRÈS, gagnant dans une portée NEUVE', () => {
    const body = bodyOf(ALERTS, 'async recordMeetingIntent(args: {', 'private async resolveMeetingAssignee(');
    const iTry = body.indexOf('let created: { id: string; createdAt: Date };');
    const iCreateRun = body.indexOf('this.scope.run(', iTry);
    const iCatch = body.indexOf('} catch (err) {', iCreateRun);
    const iWinnerRun = body.indexOf('this.scope.run(', iCatch);

    expect(iTry).toBeGreaterThan(-1);
    expect(iCreateRun).toBeGreaterThan(iTry);
    expect(iCatch).toBeGreaterThan(iCreateRun);
    expect(iWinnerRun).toBeGreaterThan(iCatch);
    // …et la portée fraîche relit bien le GAGNANT, pas autre chose.
    expect(body.indexOf('tx.meetingRequest.findUnique(', iWinnerRun)).toBeGreaterThan(iWinnerRun);
  });

  it('writeAuditEntry / loadMeetingRequestedAt / resolveMeetingAssignee : `try` avant `run`', () => {
    for (const [from, to] of [
      ['private async writeAuditEntry(args: {', '// ----- Evaluator'],
      ['private async loadMeetingRequestedAt(args: {', '// -- helpers'],
      ['private async resolveMeetingAssignee(args: {', '/**\n   * Append-only audit row'],
    ] as const) {
      const body = bodyOf(ALERTS, from, to);
      const iTry = body.indexOf('try {');
      const iRun = body.indexOf('this.scope.run(');
      const iCatch = body.indexOf('} catch (err) {');
      expect(iTry).toBeGreaterThan(-1);
      expect(iRun).toBeGreaterThan(iTry);
      expect(iCatch).toBeGreaterThan(iRun);
    }
  });

  it('meeting-requests.resolve : l’audit ouvre SA portée, `try` dehors, `catch` dehors', () => {
    const body = bodyOf(MEETINGS, 'async resolve(args: {', 'private toDto(');
    const iTry = body.lastIndexOf('try {');
    const iRun = body.indexOf('this.scope.run(', iTry);
    const iCatch = body.indexOf('} catch (err) {', iRun);
    expect(iTry).toBeGreaterThan(-1);
    expect(iRun).toBeGreaterThan(iTry);
    expect(iCatch).toBeGreaterThan(iRun);
    expect(body.indexOf('tx.auditLog.create(', iRun)).toBeGreaterThan(iRun);
  });
});

// ---------------------------------------------------------------------------
// (b) G-AUDIT — LA RELATION TRANSACTIONNELLE EST INCHANGÉE
// ---------------------------------------------------------------------------

describe('G-AUDIT — l’audit garde EXACTEMENT sa relation d’avant à la mutation', () => {
  /**
   * MESURÉ : `alerts.service.ts` n'a AUCUN `$transaction`. Chaque
   * `auditLog.create` était donc déjà post-mutation, best-effort, sa propre
   * instruction, avec un `catch` qui avale. Cette tranche ne les rend PAS
   * transactionnels — la lecture naïve « une portée par handler » aurait fait
   * exactement l'inverse de ce qu'un audit best-effort promet.
   */
  it('aucun APPEL à `$transaction` n’existe dans les deux services convertis', () => {
    // L'assertion porte sur un APPEL, pas sur le mot : le docblock de classe
    // NOMME `$transaction` pour dire que ce fichier n'en a aucun, et une
    // assertion sur le mot nu virerait au rouge à cause de sa propre
    // documentation — un test qui interdit d'écrire ce qu'il vérifie.
    for (const source of [ALERTS, MEETINGS]) {
      expect(source).not.toMatch(/\$transaction\s*\(/);
    }
  });

  it('chaque `tx.auditLog.create` est SEUL dans sa portée', () => {
    for (const source of [ALERTS, MEETINGS]) {
      const auditRanges = scopeRanges(source).filter((r) =>
        source.slice(r.start, r.end).includes('tx.auditLog.create('),
      );
      expect(auditRanges.length).toBeGreaterThanOrEqual(1);
      for (const range of auditRanges) {
        const inner = source.slice(range.start, range.end);
        // Une SEULE instruction Prisma dans le callback : partager la portée
        // avec la mutation ferait de l'échec avalé un ROLLBACK de celle-ci.
        const statements = inner.match(/(?<![.\w])tx\.[A-Za-z][A-Za-z0-9_]*\.[A-Za-z]/g) ?? [];
        expect(statements).toHaveLength(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (c) PF-200 INVERSÉ — LE CLIENT PROPRIÉTAIRE N'ENTRE PAS DANS UNE PORTÉE
// ---------------------------------------------------------------------------

describe('aucun service à connexion PROPRIÉTAIRE n’est appelé depuis une portée', () => {
  /**
   * `NotificationsService` injecte `PrismaService` et lit `user_profile` — la
   * table d'identité que la couture garde HORS portée (PF-199). Appelé depuis
   * un callback, il prendrait une SECONDE connexion du pool, sans GUC, pendant
   * que la connexion `app_user` tient une transaction interactive ouverte : la
   * forme dont `teacher-profile.service.ts` porte déjà la raison, et dont le
   * `catch` empoisonnerait en prime la portée hôte.
   */
  it('`this.notifications.` n’apparaît dans AUCUN callback de portée', () => {
    const ranges = scopeRanges(ALERTS);
    expect(ranges.length).toBeGreaterThanOrEqual(22);
    const offenders = ranges.filter((r) => ALERTS.slice(r.start, r.end).includes('this.notifications.'));
    expect(offenders).toEqual([]);
    // NON-VACUITÉ : le service EST appelé, simplement toujours dehors.
    expect(ALERTS).toContain('this.notifications.markReadBySource(');
    expect(ALERTS).toContain('this.notifications.createMany(');
  });

  it('`this.prisma.` n’apparaît dans AUCUN callback de portée (l’inverse dangereux de PF-200)', () => {
    const ranges = scopeRanges(ALERTS);
    const offenders = ranges.filter((r) => ALERTS.slice(r.start, r.end).includes('this.prisma.'));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (d) LE CONSTRUCTEUR EST LA PREUVE — POUR CELUI QUI L'A MÉRITÉ
// ---------------------------------------------------------------------------

describe('ADR-060 §D4 — le cliquet du constructeur s’applique à UN des deux services', () => {
  it('MeetingRequestsService ne détient PLUS aucune référence au client propriétaire', () => {
    expect(MEETINGS).toContain('constructor(private readonly scope: TenantScopeService) {}');
    expect(MEETINGS).not.toContain('this.prisma.');
    expect(MEETINGS).not.toContain("from '../../shared/prisma/prisma.service'");
  });

  it('AlertsService GARDE le sien, et c’est une décision NOMMÉE — pas un oubli', () => {
    // Le simuler en masquant le client derrière un helper serait une preuve
    // FAUSSE : `evaluateAll` et `tenantsWithEnabledRules` sont réellement sur
    // la connexion du propriétaire, et la liste d'énumération le dit.
    expect(ALERTS).toContain('private readonly prisma: PrismaService');
    expect(ALERTS).toContain('private readonly scope: TenantScopeService');
    expect(ALERTS).toContain('HORS PORTÉE PAR CONSTRUCTION');
  });

  it('G-AUTHZ — les deux contrôleurs n’ouvrent AUCUNE portée', () => {
    // Les murs ABAC (`canAccessStudent`) et les `@RequiresPermission` tournent
    // AVANT les services, sur la connexion du propriétaire, hors transaction.
    for (const file of ['alerts.controller.ts', 'meeting-requests.controller.ts']) {
      const controller = readFileSync(join(__dirname, file), 'utf8');
      expect(controller).not.toContain('this.scope.run(');
    }
  });
});

// ---------------------------------------------------------------------------
// (e) G-DNC + LES GARDES `tenantId` QUI SURVIVENT À LA CONVERSION
// ---------------------------------------------------------------------------

describe('G-DNC — aucun drapeau, aucun SQL, et les gardes tenant SURVIVENT', () => {
  it('ni `process.env`, ni SQL brut, ni port en dur dans les deux services', () => {
    for (const source of [ALERTS, MEETINGS]) {
      expect(source).not.toMatch(/\$queryRaw|\$executeRaw/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toContain('5432');
    }
  });

  it('les `tenantId: args.tenantId` explicites restent dans les `where` (ADR-056)', () => {
    // Sur un déploiement sans `DATABASE_URL_APP`, `run` s'exécute sur le
    // PROPRIÉTAIRE, qui échappe à ses propres policies : ces gardes sont alors
    // la SEULE isolation qui reste. Les retirer ferait de l'isolation une
    // propriété d'un fichier d'environnement.
    expect(ALERTS.match(/tenantId: args\.tenantId/g)?.length ?? 0).toBeGreaterThanOrEqual(15);
    expect(MEETINGS.match(/tenantId: args\.tenantId/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('la clé de portée est TOUJOURS `args.tenantId`, jamais la donnée filtrée', () => {
    for (const source of [ALERTS, MEETINGS]) {
      for (const match of source.matchAll(/this\.scope\.run\(\s*([A-Za-z_$][\w.$]*)/g)) {
        expect(match[1]).toBe('args.tenantId');
      }
    }
  });

  it('le filtre de RÔLE de meeting-requests est INTACT — RLS n’isole pas deux enseignants', () => {
    expect(MEETINGS).toContain(
      "base.OR = [{ assignedToId: args.scope.userProfileId }, { assignedToId: null }];",
    );
  });

  it('le filtre `requestedBy` du marqueur parent est INTACT — pas de fuite entre co-tuteurs', () => {
    const body = bodyOf(ALERTS, 'private async loadMeetingRequestedAt(args: {', '// -- helpers');
    expect(body).toContain('requestedBy: userProfileId,');
  });
});

// ---------------------------------------------------------------------------
// (f) LA CLÔTURE DÉCLARÉE COUVRE CE QUE CE MODULE ÉCRIT
// ---------------------------------------------------------------------------

describe('ADR-059 / ADR-060 §D2 — les paires que ce module ajoute sont déclarées', () => {
  const declared = new Set(APP_ROLE_REQUIRED_PRIVILEGES.map((r) => `${r.table}.${r.privilege}`));

  /**
   * La clôture DÉRIVÉE est calculée par `scripts/tenant-adversarial-check.js`
   * contre la base réelle et comparée dans les DEUX SENS. Ce test-ci n'est pas
   * cette dérivation : il fige les NEUF paires que cette tranche a fait naître,
   * pour qu'un retrait accidentel devienne rouge ici aussi, sans base.
   */
  it('les neuf paires de la tranche sont présentes', () => {
    for (const key of [
      'alert_rule.SELECT',
      'alert_rule.INSERT',
      'alert_rule.UPDATE',
      'alert_instance.UPDATE',
      'meeting_request.SELECT',
      'meeting_request.INSERT',
      'meeting_request.UPDATE',
      'audit_log.INSERT',
      'audit_log.SELECT',
    ]) {
      expect(declared.has(key)).toBe(true);
    }
  });

  it('`audit_log.SELECT` est déclaré ALORS QUE ce module ne lit JAMAIS audit_log', () => {
    // C'est le cœur d'ADR-060 §D2 : le SELECT n'est pas une lecture métier,
    // c'est l'exigence du `RETURNING` que Prisma émet sur un `create`. Aucune
    // lecture d'`audit_log` n'existe dans le module — l'assertion serait fausse
    // si quelqu'un en ajoutait une et « expliquait » le SELECT par elle.
    expect(declared.has('audit_log.SELECT')).toBe(true);
    for (const source of [ALERTS, MEETINGS]) {
      expect(source).not.toMatch(/auditLog\.(findMany|findFirst|findUnique|count|aggregate|groupBy)/);
    }
  });

  it('AUCUN `audit_log.UPDATE` / `.DELETE` — la matrice les retient (ADR-032 §D7)', () => {
    // Les déclarer rendrait `refused_unusable` au démarrage : vert au boot,
    // puis 503 sur les QUATRE portails, pas seulement sur alerts.
    expect(declared.has('audit_log.UPDATE')).toBe(false);
    expect(declared.has('audit_log.DELETE')).toBe(false);
  });
});
