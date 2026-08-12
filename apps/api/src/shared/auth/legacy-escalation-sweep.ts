import { REALM_ROLE_PERMISSIONS } from './permissions.constants';

/**
 * S-E05-2c — LE BALAYAGE DE DÉTECTION DES PRIVILÈGES HÉRITÉS (`PF-175` P2
 * BROKEN_SECURITY, couche L0 · gates G-AUTHZ + G-DNC).
 *
 * CE QUI EST OUVERT, MESURÉ
 * -------------------------
 * `privilege-ceiling.ts` (S-E05-2) est *relatif à l’octroyeur* : il compare un
 * code demandé à ce que l’octroyeur DÉTIENT EFFECTIVEMENT
 * (`user-sync.service.ts:64-87` — permissions du rôle de realm UNION celles de
 * chaque rôle personnalisé du porteur). Un rôle frappé AVANT l’existence du
 * plafond, via `PF-09`, est donc déjà dans l’ensemble effectif de son porteur :
 * le plafond le lit comme légitimement détenu. Ce n’est PAS un défaut du
 * plafond, c’est inhérent à un plafond relatif. Ce qui manque à `PF-175` est un
 * BALAYAGE DE DÉTECTION — et il n’existait jusqu’ici que sous forme de SQL en
 * prose dans une ligne de registre, jamais exécutée.
 *
 * UNE FONCTION PURE, EXPRÈS
 * -------------------------
 * Même posture que `privilege-ceiling.ts` : pas de classe, pas de fournisseur
 * injectable, pas de module Nest, pas d’import Prisma, pas de décorateur, pas
 * de sac d’options. Contrairement à `privilege-ceiling.ts`, ce module n’importe
 * même pas `@nestjs/common` : le plafond refuse une requête vivante (il lève et
 * journalise), un détecteur RETOURNE UNE VALEUR et c’est son appelant qui
 * imprime. Il n’y a pas de barillet dans `shared/auth/` (aucun `index.ts`), donc
 * rien ne réexporte ce module par accident.
 *
 * POURQUOI `school_admin` EST LA BASE DE RÉFÉRENCE
 * -----------------------------------------------
 * `school_admin` est le niveau d’octroyeur auquel `PF-09` permettait de frapper
 * n’importe quoi : il détient `roles.write` ET `roles.assign`
 * (`permissions.constants.ts:209-211`), donc la chaîne vivante tenait en deux
 * requêtes. Tout code hors de cette base est un code qu’un `school_admin`
 * n’aurait jamais dû pouvoir accorder. Cela ne rend PAS illégitimes les codes
 * concernés : `grades.revise` appartient légitimement à `teacher`
 * (`permissions.constants.ts:234`) et est simplement absent de `school_admin`.
 *
 * CE QUE CE BALAYAGE NE PROUVE PAS (à lire avant d’agir sur un signalement)
 * ------------------------------------------------------------------------
 *  - Le modèle `Role` ne porte AUCUNE traçabilité d’octroi (`grantedBy` est sur
 *    `user_role`, pas sur `role`). La provenance d’une ligne est donc
 *    irrécupérable : ce balayage ne peut pas distinguer un artefact `PF-09`
 *    d’un rôle frappé légitimement par le rôle de plateforme qui détient le
 *    catalogue entier. La sortie dit « rôles à examiner », jamais « escalade
 *    confirmée », et le code de sortie 1 signifie « des signalements existent,
 *    un humain arbitre ».
 *  - Un rôle dont les codes hérités ont été retirés depuis par un `PATCH` — une
 *    désescalade que le plafond autorise par construction
 *    (`privilege-ceiling.spec.ts` T-7) — ressort propre. Seul l’audit porte cet
 *    historique.
 *  - Le balayage ne dit RIEN sur QUI porte le rôle. Le compte des porteurs
 *    vivants est à un `_count` de distance sur la même requête, mais il est
 *    hors périmètre de cette tranche, et une liste de porteurs serait une
 *    nouvelle surface de données personnelles dans un journal d’exécution.
 *
 * LES RÔLES SYSTÈME SONT IGNORÉS STRUCTURELLEMENT, PAS PAR NOM
 * ------------------------------------------------------------
 * Aucun nom de rôle n’apparaît dans ce module et aucun rôle n’est exempté par
 * son nom. Un rôle `isSystem === true` est ignoré parce qu’il est AMORCÉ par
 * les semences, pas frappé par un octroyeur : il ne peut donc pas être un
 * artefact `PF-09`. Ce n’est pas une exemption, c’est une propriété du chemin
 * de création — vérifiée dans les fichiers voisins et testée ici : la création
 * de rôle force `isSystem: false` (`roles.controller.ts:160`), la mise à jour
 * et la suppression refusent un rôle système, et les seules lignes
 * `isSystem: true` viennent des semences.
 *
 * FERMÉ-EN-CAS-D’ÉCHEC ET TOTAL
 * -----------------------------
 *  - Un code inconnu ou fantaisiste n’est pas dans la base de référence, donc
 *    il est SIGNALÉ. Ce module ne consulte jamais le catalogue.
 *  - Une entrée malformée (candidats qui ne sont pas un tableau, entrée nulle,
 *    `permissionCodes` absent, code non-textuel) est SIGNALÉE avec
 *    `kind: 'malformed'`, jamais avalée en silence comme « propre ».
 *  - Un rôle à zéro code n’est PAS un signalement : zéro permission = zéro
 *    privilège. C’est l’UNIQUE autorisation-sur-vide, elle est commentée ici
 *    pour qu’elle ne puisse pas être prise pour une branche ouverte-en-échec,
 *    et elle est distincte de « `permissionCodes` absent », qui est malformé.
 *  - Une base de référence vide ou `undefined` SIGNALE TOUT. `baselineSize: 0`
 *    est une condition bruyante, jamais « inconnu donc propre ».
 *
 * TENANCE
 * -------
 * Le balayage ne prend AUCUN paramètre d’école et ne peut donc pas filtrer
 * silencieusement sur un seul tenant — un filtre silencieux sous-déclarerait.
 * Chaque signalement porte son `schoolId`. Attention à la lecture : `Role` n’a
 * pas de `tenantId`, la tenance est à un saut (`schoolId → School.tenantId`), et
 * `schoolId = null` ne veut PAS dire « aucun tenant » mais « rôle GLOBAL »,
 * assignable dans tout établissement (`ADR-015 D8.6`, et `PF-08` encore
 * ouverte). C’est la forme de signalement la PLUS sévère, pas la moins.
 * Mesuré : `roles.controller.ts` ne pose jamais `schoolId` à la création, donc
 * aujourd’hui tout rôle frappable est global. Le rapport ne rend donc jamais un
 * `null` nu : il porte un discriminant `scope` explicite.
 *
 * DNC-10 — aucun interrupteur et aucune place pour un. Ce module ne lit aucune
 * variable d’environnement, ne porte aucun drapeau de contournement, aucune
 * échappatoire de développement et aucun sac d’options. Les arités sont fixes
 * (2, 1, 1) et `legacy-escalation-sweep.spec.ts` les assère, donc un objet
 * d’options ne peut pas apparaître plus tard sans rougir un test.
 */

/** Une ligne `role` candidate, réduite à ce que la détection lit. */
export interface CandidateRole {
  id: string;
  slug: string;
  isSystem: boolean;
  /** `null` = rôle GLOBAL (toutes écoles), pas « sans tenant ». */
  schoolId: string | null;
  permissionCodes: string[];
}

/** Un signalement est soit un privilège hors base, soit une ligne malformée. */
export type FindingKind = 'escalation' | 'malformed';

/** Portée explicite : jamais un `null` nu dans la sortie. */
export type RoleScope = 'global' | 'school';

export interface RoleFinding {
  roleId: string;
  slug: string;
  schoolId: string | null;
  scope: RoleScope;
  kind: FindingKind;
  /** Redondant avec `kind` par construction, et exigé tel quel par AC-3. */
  malformed: boolean;
  /** Dé-dupliqués et triés (UTF-16 par défaut) — jamais `localeCompare`. */
  codes: string[];
}

export interface SweepReport {
  /** Rôles réellement balayés (les rôles système n’y sont pas comptés). */
  examined: number;
  skippedSystem: number;
  baselineSize: number;
  findings: RoleFinding[];
  clean: boolean;
}

/**
 * Sentinelle portée par un signalement dont l’identité de rôle est illisible.
 * Ce n’est pas un identifiant et personne ne peut le porter.
 */
export const MALFORMED_ROLE_SENTINEL = '<rôle illisible>';

/** Sentinelle portée à la place d’un code de permission non textuel. */
export const MALFORMED_CODE_SENTINEL = '<code de permission illisible>';

/**
 * La base de référence, DÉRIVÉE à l’exécution — jamais recopiée dans un
 * littéral, sinon elle se désynchronise du catalogue en silence.
 *
 * Le `?? []` est porteur et fermé-en-échec dans le bon sens : si la clé de realm
 * était renommée, la base deviendrait vide et le balayage signalerait TOUT,
 * jamais « propre ». Le typage `Record<string, PermissionCode[]>` rend cet accès
 * non-optionnel aux yeux du compilateur, donc le `?? []` n’est pas décoratif :
 * c’est la seule protection contre un `undefined` à typecheck vert.
 */
export const SCHOOL_ADMIN_BASELINE: ReadonlySet<string> = new Set<string>(
  REALM_ROLE_PERMISSIONS.school_admin ?? [],
);

/**
 * Code témoin de la base de référence. `school_admin` le détient de façon
 * démontrable (`permissions.constants.ts:210`), donc son absence signifie que la
 * dérivation a échoué — condition à traiter comme « balayage non concluant »,
 * pas comme « tout est à signaler ». Le prédicat, lui, reste fermé-en-échec.
 */
export const BASELINE_CANARY_CODE = 'roles.write';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Tri UTF-16 par défaut, explicite pour qu’aucun `localeCompare` ne s’y glisse. */
function compareUtf16(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Clé de comparaison SÉRIALISÉE plutôt que concaténée avec un séparateur : un
 * séparateur — quel qu’il soit — laisserait deux listes de codes distinctes
 * produire la même clé, donc une dé-duplication silencieuse et fausse.
 * `JSON.stringify` est sans ambiguïté, et son ordre reste l’ordre UTF-16.
 */
function codesKey(codes: readonly string[]): string {
  return JSON.stringify(codes);
}

function keyOf(finding: RoleFinding): string {
  return JSON.stringify([
    finding.kind,
    finding.roleId,
    finding.slug,
    finding.schoolId,
    finding.codes,
  ]);
}

/**
 * Les codes de `candidates` qui sortent de `baseline`, rôle par rôle.
 *
 * Déterministe : les signalements sont triés par `slug`, puis par `roleId`
 * (les identifiants sont des uuid, donc non stables pour un humain), puis par
 * leurs codes ; les codes sont dé-dupliqués et triés ; les signalements
 * strictement identiques sont fusionnés. Le même ensemble de rôles dans
 * n’importe quel ordre produit donc un rapport profondément égal.
 *
 * @param candidates les lignes `role` à examiner. Un non-tableau est SIGNALÉ.
 * @param baseline l’ensemble de référence. `undefined` ou vide signale TOUT.
 *   Il n’y a volontairement pas de troisième paramètre : ni école, ni options.
 */
export function sweepLegacyEscalations(
  candidates: readonly CandidateRole[],
  baseline: ReadonlySet<string> | undefined,
): SweepReport {
  const baselineSize = baseline?.size ?? 0;
  const held = baseline ?? new Set<string>();

  if (!Array.isArray(candidates)) {
    return {
      examined: 0,
      skippedSystem: 0,
      baselineSize,
      findings: [
        {
          roleId: MALFORMED_ROLE_SENTINEL,
          slug: MALFORMED_ROLE_SENTINEL,
          schoolId: null,
          scope: 'global',
          kind: 'malformed',
          malformed: true,
          codes: [MALFORMED_CODE_SENTINEL],
        },
      ],
      clean: false,
    };
  }

  let examined = 0;
  let skippedSystem = 0;
  const collected: RoleFinding[] = [];

  for (const candidate of candidates) {
    const entry = candidate as unknown;

    if (entry === null || typeof entry !== 'object') {
      examined += 1;
      collected.push({
        roleId: MALFORMED_ROLE_SENTINEL,
        slug: MALFORMED_ROLE_SENTINEL,
        schoolId: null,
        scope: 'global',
        kind: 'malformed',
        malformed: true,
        codes: [MALFORMED_CODE_SENTINEL],
      });
      continue;
    }

    const row = entry as Partial<CandidateRole>;

    // Ignoré STRUCTURELLEMENT, et en premier : un rôle amorcé n’est pas frappé,
    // donc il ne peut pas être un artefact PF-09. Comparaison stricte : un
    // `isSystem` non booléen n’est pas une exemption, il tombe plus bas et est
    // signalé comme malformé.
    if (row.isSystem === true) {
      skippedSystem += 1;
      continue;
    }

    examined += 1;

    const roleId = isNonEmptyString(row.id) ? row.id : MALFORMED_ROLE_SENTINEL;
    const slug = isNonEmptyString(row.slug) ? row.slug : MALFORMED_ROLE_SENTINEL;
    const schoolId = isNonEmptyString(row.schoolId) ? row.schoolId : null;
    const scope: RoleScope = schoolId === null ? 'global' : 'school';

    let malformed =
      roleId === MALFORMED_ROLE_SENTINEL ||
      slug === MALFORMED_ROLE_SENTINEL ||
      typeof row.isSystem !== 'boolean' ||
      !(row.schoolId === null || row.schoolId === undefined || isNonEmptyString(row.schoolId));

    const outside = new Set<string>();

    if (!Array.isArray(row.permissionCodes)) {
      // `permissionCodes` absent ou non-tableau : illisible, donc SIGNALÉ.
      // Surtout pas `?? []`, qui le confondrait avec « zéro code » et le
      // rendrait propre — l’exact contraire de la posture fermée-en-échec.
      malformed = true;
      outside.add(MALFORMED_CODE_SENTINEL);
    } else {
      for (const code of row.permissionCodes as unknown[]) {
        if (typeof code !== 'string') {
          malformed = true;
          outside.add(MALFORMED_CODE_SENTINEL);
          continue;
        }
        if (held.has(code)) continue;
        outside.add(code);
      }
    }

    // L’UNIQUE autorisation-sur-vide : un rôle bien formé portant zéro code
    // accorde zéro privilège, donc ce n’est pas un signalement. Elle ne couvre
    // QUE le cas bien formé — un `permissionCodes` illisible est passé par la
    // branche ci-dessus et porte déjà la sentinelle.
    if (outside.size === 0 && !malformed) continue;

    collected.push({
      roleId,
      slug,
      schoolId,
      scope,
      kind: malformed ? 'malformed' : 'escalation',
      malformed,
      codes: [...outside].sort(compareUtf16),
    });
  }

  const deduplicated = new Map<string, RoleFinding>();
  for (const finding of collected) {
    const key = keyOf(finding);
    if (!deduplicated.has(key)) deduplicated.set(key, finding);
  }

  const findings = [...deduplicated.values()].sort(
    (a, b) =>
      compareUtf16(a.slug, b.slug) ||
      compareUtf16(a.roleId, b.roleId) ||
      compareUtf16(codesKey(a.codes), codesKey(b.codes)),
  );

  return { examined, skippedSystem, baselineSize, findings, clean: findings.length === 0 };
}

/**
 * Les trois issues, en une fonction pure d’arité 1, pour qu’une panne
 * opérationnelle ne puisse jamais être lue comme un signalement de sécurité —
 * ni l’inverse. `null` = « le balayage n’a pas pu aboutir ».
 *
 * 0 = propre · 1 = signalements (un humain arbitre) · 2 = non concluant.
 */
export function exitCodeForSweep(report: SweepReport | null): 0 | 1 | 2 {
  if (report === null) return 2;
  return report.clean ? 0 : 1;
}

const TITLE = 'Balayage des privilèges hérités (PF-175) — rôles à examiner';

/**
 * Le rapport, en français, formaté UNE seule fois et à un seul endroit.
 *
 * Choix de lisibilité opérateur, délibérés : la distinction propre/signalement
 * n’est jamais portée par une couleur (elle survit à un tube, à un fichier de
 * journal et à un lecteur d’écran) mais par un jeton de tête `OK` / `ALERTE` /
 * `MALFORMÉ` ; la portée (le tenant) vient en tête de bloc pour qu’un lecteur
 * groupe visuellement ; les codes sont indentés un par ligne parce qu’une longue
 * liste sur une seule ligne se replie de façon imprévisible à 80 colonnes ; et un
 * décompte final ferme le rapport, pour qu’« aucune sortie » et « propre » ne
 * soient jamais confondus.
 */
export function formatSweepReportFr(report: SweepReport): string {
  const lines: string[] = [];

  lines.push(`=== ${TITLE} ===`);
  lines.push(
    'Base de données balayée : celle que DATABASE_URL désigne dans l’environnement ' +
      'd’exécution — ce module ne la lit pas (DNC-10).',
  );
  lines.push(
    `Base de référence : ${report.baselineSize} permission(s) du niveau school_admin, ` +
      'dérivées à l’exécution.',
  );
  if (report.baselineSize === 0) {
    lines.push(
      'ALERTE  base de référence VIDE : tout code est signalé. Ce rapport ne dit pas ' +
        'que la base est compromise, il dit que la référence est introuvable.',
    );
  }
  lines.push(
    `Rôles examinés : ${report.examined} · rôles système ignorés : ${report.skippedSystem} ` +
      '(amorcés par les semences, donc jamais frappés par un octroyeur).',
  );
  lines.push('');

  if (report.clean) {
    lines.push(
      `OK  Aucun rôle à examiner : ${report.examined} rôle(s) non système balayé(s), ` +
        'aucun code hors de la base de référence.',
    );
    return lines.join('\n');
  }

  for (const finding of report.findings) {
    const marker = finding.kind === 'malformed' ? 'MALFORMÉ' : 'ALERTE';
    const scopeLine =
      finding.scope === 'global'
        ? 'portée : GLOBALE (aucune école) — assignable dans tout établissement, cf. PF-08'
        : `portée : école ${finding.schoolId ?? ''} (le tenant est à un saut : School.tenantId)`;

    lines.push(`${marker}  ${scopeLine}`);
    lines.push(`        rôle : ${finding.slug} (id ${finding.roleId})`);
    lines.push(
      finding.kind === 'malformed'
        ? '        ligne illisible — à inspecter à la main, elle ne peut pas être déclarée propre :'
        : '        privilège hérité à examiner (hors base de référence) :',
    );
    for (const code of finding.codes) lines.push(`          - ${code}`);
    lines.push('');
  }

  lines.push(`${report.findings.length} rôle(s) signalé(s) sur ${report.examined} examiné(s).`);
  lines.push(
    'Un signalement n’est pas une escalade prouvée : la table role ne porte aucune ' +
      'traçabilité d’octroi, donc un octroi légitime ressort de la même façon. ' +
      'La révocation est une décision humaine.',
  );

  return lines.join('\n');
}
