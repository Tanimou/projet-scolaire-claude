import {
  type PageEnvelope,
  type PageOffset,
  type PageSize,
  type ResultTotal,
  pageEnvelope,
  requiredKey,
  resultTotal,
  unvalidatedItem,
} from '@pilotage/contracts';
import { z } from 'zod';

import type { AuditListResult } from '../../modules/analytics/analytics.service';
import { TeachingAssignmentsController } from '../../modules/teaching/teaching-assignments.controller';

/**
 * S-E03-11 / PF-50 / PF-427 / ADR-081 — LA PREUVE ROUGE-AVANT / VERT-APRÈS de
 * l'enveloppe de page canonique.
 *
 * CE QUE CETTE SUITE PROUVE, EXÉCUTÉE
 * ------------------------------------
 *  (1) AC-2, LE ROUGE-AVANT : un `z.object({data,total})` nu DÉPOUILLE `kpis` et
 *      `filters` d'une charge utile d'audit — silencieusement, à l'exécution.
 *  (2) AC-2, LE VERT-APRÈS : le cadre canonique, ET son extension, préservent
 *      l'ENSEMBLE DES CLÉS de l'enveloppe — y compris une clé qu'aucun des deux
 *      schémas ne déclare. L'assertion porte sur l'ÉGALITÉ DES ENSEMBLES DE
 *      CLÉS, jamais sur une liste de noms attendus : une telle liste serait une
 *      TROISIÈME liste tenue à la main, c'est-à-dire cette tranche répétant son
 *      propre défaut.
 *  (3) Le défaut EXACT du run 94 (`totals` émis, `summary` lu) est REJETÉ par le
 *      cadre, avec le chemin de la clé fautive dans l'erreur.
 *  (4) Une page légitimement VIDE s'analyse (aucun `.min(1)` n'a glissé sur
 *      `data`), et un `total` négatif ou fractionnaire est REJETÉ.
 *  (5) Le mode « cadre seul » : des LIGNES inattendues ne tuent pas la page.
 *  (6) AC-4, LE CONTRÔLE NÉGATIF DE COMPILATION : le handler du run 94, recopié
 *      dans sa forme fautive, NE COMPILE PLUS sous le type de retour désormais
 *      DÉCLARÉ par `TeachingAssignmentsController.list`. Ces assertions sont
 *      portées par `@ts-expect-error` et sont donc EXÉCUTÉES par ts-jest (qui
 *      remonte les diagnostics TypeScript comme des échecs) autant que par
 *      `tsc --noEmit` : une directive `@ts-expect-error` devenue inutile est
 *      elle aussi une erreur, donc le contrôle rougit dans LES DEUX SENS.
 *
 * CE QU'ELLE NE PROUVE PAS
 * -------------------------
 * Rien de tout cela n'a été observé sur une pile en vol. Docker Desktop refuse
 * de démarrer (6ᵉ run consécutif) et la base locale `pilotage@5432` est VIDE :
 * aucune sonde vivante n'a été lancée et aucune n'est revendiquée. C'est une
 * preuve de MÉCANISME (`project_proof_on_scratch_is_not_the_target`).
 *
 * ⚠ `@pilotage/contracts` est mappé vers la SOURCE par `apps/api/jest.config.js`.
 * Le vert d'ici ne dit RIEN du démarrage de l'API : `main` pointe sur le CJS
 * `dist/`, git-ignoré, que ce runner ne reconstruit pas. `pnpm --filter
 * @pilotage/contracts build` reste un PRÉ-REQUIS DE LAND (ADR-080 §6.2, le piège
 * `landed ≠ ran`).
 */

/* ================================================================== *
 * LA CHARGE UTILE D'AUDIT, DANS SA FORME RÉELLE
 * ================================================================== */

/**
 * La forme que `analytics.service.ts:auditList()` rend RÉELLEMENT, réduite à ses
 * clés. `surprise` n'existe pas côté serveur : c'est le témoin d'une clé que
 * PERSONNE ne déclare — si le cadre la préserve, il ne peut pas en dépouiller
 * une que le serveur ajouterait demain.
 */
const AUDIT_PAYLOAD = {
  data: [{ id: 'a1', action: 'user.create' }],
  total: 2,
  kpis: {
    eventsInRange: { value: 2, scope: 'filtered', label: 'Actions filtrées' },
    criticalChanges: { value: 1, scope: 'filtered', label: 'Modifications critiques' },
  },
  filters: { timezone: 'Africa/Abidjan', from: '2026-08-01', to: '2026-08-28' },
  surprise: true,
} as const;

/* ================================================================== *
 * (1) AC-2 — LE ROUGE-AVANT : le cadre NAÏF supprime des clés
 * ================================================================== */

describe('AC-2 (i) — le rouge-avant : un `z.object` nu DÉPOUILLE, en silence', () => {
  /** Le cadre que la façon « évidente » d'écrire cette tranche aurait produit. */
  const naiveFrame = z.object({
    data: z.array(z.unknown()),
    total: z.number().int().nonnegative(),
  });

  it('SUPPRIME `kpis` et `filters` de la charge utile d’audit', () => {
    const parsed = naiveFrame.parse(AUDIT_PAYLOAD);

    // Le défaut, nommé : la charge utile est ACCEPTÉE, et amputée.
    expect(parsed).not.toHaveProperty('kpis');
    expect(parsed).not.toHaveProperty('filters');
    expect(Object.keys(parsed).sort()).toEqual(['data', 'total']);
  });

  it('et le fait SANS erreur — c’est pourquoi aucun type ne l’aurait vu', () => {
    expect(naiveFrame.safeParse(AUDIT_PAYLOAD).success).toBe(true);
  });
});

/* ================================================================== *
 * (2) AC-2 — LE VERT-APRÈS : égalité des ENSEMBLES DE CLÉS
 * ================================================================== */

describe('AC-2 (ii) — le vert-après : le cadre canonique ne dépouille JAMAIS', () => {
  const base = pageEnvelope(unvalidatedItem<{ id: string; action: string }>());

  const extended = base.extend({
    kpis: z.record(z.object({ value: z.number(), scope: z.string(), label: z.string() })),
    filters: z.object({ timezone: z.string(), from: z.string(), to: z.string() }),
  });

  it('CADRE DE BASE — l’ensemble des clés de l’enveloppe est PRÉSERVÉ à l’identique', () => {
    const parsed = base.parse(AUDIT_PAYLOAD);
    // ÉGALITÉ DES ENSEMBLES, jamais une liste de noms attendus (ce serait une
    // troisième liste tenue à la main).
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(AUDIT_PAYLOAD).sort());
  });

  it('CADRE ÉTENDU — `.extend()` HÉRITE du passthrough, il ne le ré-arme pas', () => {
    const parsed = extended.parse(AUDIT_PAYLOAD);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(AUDIT_PAYLOAD).sort());
    // Y COMPRIS la clé qu'AUCUN des deux schémas ne déclare.
    expect(parsed).toHaveProperty('surprise', true);
  });

  it('les deux cadres rendent la MÊME enveloppe, clé pour clé', () => {
    expect(Object.keys(base.parse(AUDIT_PAYLOAD)).sort()).toEqual(
      Object.keys(extended.parse(AUDIT_PAYLOAD)).sort(),
    );
  });
});

/* ================================================================== *
 * (3) LE DÉFAUT DU RUN 94 — `totals` émis, `summary` lu
 * ================================================================== */

describe('le défaut du run 94 est REJETÉ, et l’erreur NOMME la clé fautive', () => {
  const assignmentsFrame = pageEnvelope(unvalidatedItem<{ id: string }>()).extend({
    limit: z.number().int(),
    offset: z.number().int(),
    totals: z.object({ assignments: z.number() }),
  });

  it('une clé `totals` renommée en `summary` ne passe plus', () => {
    const result = assignmentsFrame.safeParse({
      data: [],
      total: 0,
      limit: 100,
      offset: 0,
      summary: { assignments: 1 },
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual(['totals']);
  });

  it('⚠ le chemin est DIAGNOSTIQUE, et il ne porte AUCUNE valeur de réponse', () => {
    const result = assignmentsFrame.safeParse({ data: [], limit: 100, offset: 0 });
    if (result.success) throw new Error('unreachable');
    const paths = result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('total');
    // Cette plateforme manipule des données d'ENFANTS : un diagnostic de forme
    // nomme des CLÉS, jamais des valeurs. Aucun `issue.path` ne peut en porter.
    expect(JSON.stringify(paths)).not.toContain('Abidjan');
  });

  /**
   * ⚠ L'ASSERTION CI-DESSUS EST VRAIE À VIDE, ET C'EST POURQUOI CELLE-CI EXISTE
   * (`PF-438`, passe de land du run 95 — condition de land nº 5, que la tranche
   * avait NOMMÉE elle-même).
   *
   * Un `issue.path` zod est une liste de NOMS DE CLÉS : il ne peut, par
   * construction, jamais contenir une valeur de réponse. Le test précédent
   * passerait donc à l'identique si la projection PII n'existait pas du tout —
   * il n'exerce pas le mécanisme qu'il prétend garantir.
   *
   * LE PIÈGE EST RÉEL ET MESURÉ, pas théorique. `zod@3` place la VALEUR BRUTE
   * dans `issue.received` pour `invalid_literal` et `invalid_enum_value` :
   *
   *     z.object({ scope: z.literal('establishment') }).safeParse({ scope: X })
   *       →  issues[0].received === X        ← la valeur, telle quelle
   *
   * Or l'enveloppe `/admin/assignments` porte exactement un littéral de ce type
   * (`coverage.scope: 'establishment'`). L'« amélioration » évidente du run
   * suivant — *« rendons le diagnostic plus utile, ajoutons `received` »* — est
   * UNE LIGNE, elle rouvre toute la classe, et elle laisserait le test ci-dessus
   * au vert. L'invariant à tenir n'est donc pas « le chemin ne fuit pas » mais
   * « LA PROJECTION NE PORTE QUE TROIS CLÉS ».
   *
   * Le CONTRÔLE POSITIF est la première moitié du test : il prouve que la
   * sentinelle est réellement ATTEIGNABLE dans l'issue brute. Sans lui, la
   * seconde moitié affirmerait une coïncidence.
   */
  it('⚠ CONTRÔLE POSITIF + INVARIANT : la valeur EST atteignable dans l’issue brute, et la projection ne la porte pas', () => {
    const SENTINEL = 'PII-SENTINEL-abidjan';
    const literalFrame = pageEnvelope(unvalidatedItem<unknown>()).extend({
      coverage: z.object({ scope: z.literal('establishment') }),
    });
    const result = literalFrame.safeParse({
      data: [],
      total: 0,
      coverage: { scope: SENTINEL },
    });
    if (result.success) throw new Error('unreachable');

    // CONTRÔLE POSITIF — la valeur atteint bel et bien l'issue BRUTE. Si cette
    // assertion tombe un jour, la seconde ne prouve plus rien et ce test doit
    // être relu, pas supprimé.
    expect(JSON.stringify(result.error.issues)).toContain(SENTINEL);

    // L'INVARIANT — la projection expédiée ne porte QUE ces trois clés. Ajouter
    // `received` fait ROUGIR ce test, ce qui est tout l'objet de l'exercice.
    const projected = result.error.issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      expected: (issue as { expected?: unknown }).expected,
    }));
    for (const issue of projected) {
      expect(Object.keys(issue).sort()).toEqual(['code', 'expected', 'path']);
    }
    expect(JSON.stringify(projected)).not.toContain(SENTINEL);
  });

  it('⚠ PIÈGE CONNU, ÉNONCÉ : sur `undefined` (un 204), le chemin est VIDE', () => {
    // `api()` rend `undefined` sur un 204 (`api-client.ts:123`). Analysé tel
    // quel, zod rend `path: []` et le message le plus indiscernable qui soit.
    // Le point d'entrée d'analyse côté client DOIT donc traiter le 204 à part —
    // c'est une exigence pour `apps/web`, enregistrée ici parce que c'est ICI
    // qu'elle est MESURÉE.
    const result = pageEnvelope(z.unknown()).safeParse(undefined);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues[0]?.path).toEqual([]);
  });
});

/* ================================================================== *
 * (3b) ⚠ LE PIÈGE QUI AURAIT LAISSÉ LE DÉFAUT DU RUN 94 SURVIVRE AU CONTRAT
 * ================================================================== */

describe('`requiredKey()` — sans lui, le contrat aurait eu l’air d’être là sans rien protéger', () => {
  it('MESURE — pour zod, `z.custom()` et `z.unknown()` sont OPTIONNELS', () => {
    // Ce n'est pas une opinion sur zod : c'est la propriété qui décide si une
    // clé DÉCLARÉE de l'enveloppe est obligatoire ou non.
    expect(z.custom().isOptional()).toBe(true);
    expect(z.unknown().isOptional()).toBe(true);
    expect(requiredKey<{ a: number }>().isOptional()).toBe(false);
  });

  it('ROUGE-AVANT — avec `z.custom()` en clé supplémentaire, `totals` renommé en `summary` PASSE', () => {
    const loose = pageEnvelope(z.unknown()).extend({
      totals: z.custom<{ assignments: number }>(),
      coverage: z.custom<{ scope: string }>(),
    });

    // LE défaut du run 94, ACCEPTÉ par un contrat qui a pourtant l'air complet.
    expect(
      loose.safeParse({ data: [], total: 0, summary: { assignments: 1 }, coverage: {} }).success,
    ).toBe(true);
  });

  it('VERT-APRÈS — avec `requiredKey()`, le même payload est REJETÉ, en nommant `totals`', () => {
    const strict = pageEnvelope(z.unknown()).extend({
      totals: requiredKey<{ assignments: number }>(),
      coverage: requiredKey<{ scope: string }>(),
    });

    const result = strict.safeParse({
      data: [],
      total: 0,
      summary: { assignments: 1 },
      coverage: {},
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual(['totals']);
  });

  /**
   * `null` EST UNE ABSENCE (`PF-434`, passe de land du run 95 — condition de
   * land nº 6 de la tranche, qu'elle avait NOMMÉE elle-même).
   *
   * Le refinement livré testait `v !== undefined` SEULEMENT. Un serveur qui
   * émet `totals: null` — la forme exacte que produit un `?? null` défensif ou
   * un sous-agrégat en échec — traversait donc le contrat AU VERT, et la page
   * mourait ensuite au rendu sur `resp.totals.assignments` avec un `TypeError`
   * qui ne nomme AUCUNE clé et ne porte AUCUN chemin : précisément le
   * diagnostic muet que ce module existe pour remplacer.
   *
   * Mesuré des deux côtés avant correction ; ce test est la moitié rouge-avant
   * qui manquait. La clé ABSENTE reste couverte par le test ci-dessus, donc la
   * correction ne troque pas un trou contre un autre.
   */
  it('ROUGE-AVANT/VERT-APRÈS — `totals: null` est une ABSENCE, et il est REJETÉ en nommant la clé', () => {
    const strict = pageEnvelope(z.unknown()).extend({
      totals: requiredKey<{ assignments: number }>(),
    });

    const result = strict.safeParse({ data: [], total: 0, totals: null });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');
    expect(result.error.issues.map((issue) => issue.path)).toContainEqual(['totals']);
  });

  it('et `requiredKey()` ne vérifie RIEN d’autre : le contenu reste non analysé, et rien n’est dépouillé', () => {
    const strict = pageEnvelope(z.unknown()).extend({ totals: requiredKey<unknown>() });
    const parsed = strict.parse({
      data: [],
      total: 0,
      totals: { nimporte: 'quoi', imbriqué: { profond: true } },
      surprise: 1,
    });
    expect(parsed).toHaveProperty('surprise', 1);
    expect(parsed.totals).toEqual({ nimporte: 'quoi', imbriqué: { profond: true } });
  });
});

/* ================================================================== *
 * (4) LES BORNES DU CADRE
 * ================================================================== */

describe('les bornes du cadre — ni trop laxistes, ni trop strictes', () => {
  const frame = pageEnvelope(unvalidatedItem<{ id: string }>());

  it('une page légitimement VIDE s’analyse (aucun `.min(1)` n’a glissé sur `data`)', () => {
    const parsed = frame.parse({ data: [], total: 0 });
    expect(parsed.data).toEqual([]);
    expect(parsed.total).toBe(0);
  });

  it('`total` est REQUIS — l’absence est un rejet, jamais un zéro inventé (DNC-08)', () => {
    expect(frame.safeParse({ data: [] }).success).toBe(false);
  });

  it('`total` négatif ou fractionnaire est REJETÉ', () => {
    expect(frame.safeParse({ data: [], total: -1 }).success).toBe(false);
    expect(frame.safeParse({ data: [], total: 1.5 }).success).toBe(false);
  });

  it('`data` non tableau est REJETÉ', () => {
    expect(frame.safeParse({ data: { id: 'x' }, total: 1 }).success).toBe(false);
  });
});

/* ================================================================== *
 * (5) LE MODE « CADRE SEUL » — l’item n’est pas le contrat
 * ================================================================== */

describe('mode cadre seul — une LIGNE inattendue ne tue pas la page (ADR-081 §D3)', () => {
  const frame = pageEnvelope(unvalidatedItem<{ id: string }>());

  it('une ligne portant un champ en trop et un `null` inattendu s’analyse quand même', () => {
    const result = frame.safeParse({
      data: [{ id: 'a1', champEnTrop: 42, actorName: null }],
      total: 1,
    });
    expect(result.success).toBe(true);
  });

  it('mais le CADRE, lui, reste vérifié sur la même charge utile', () => {
    const result = frame.safeParse({
      data: [{ id: 'a1', champEnTrop: 42 }],
      // `total` absent : le cadre rougit, la ligne n'y est pour rien.
    });
    expect(result.success).toBe(false);
  });
});

/* ================================================================== *
 * (6) AC-4 — LE CONTRÔLE NÉGATIF, À LA COMPILATION
 * ================================================================== */

/** Le type de retour RÉELLEMENT DÉCLARÉ par le handler, lu depuis le handler. */
type DeclaredAssignmentsEnvelope = Awaited<ReturnType<TeachingAssignmentsController['list']>>;

const COVERAGE = {
  scope: 'establishment',
  classSectionIdsWithPrincipal: [],
  classSectionIdsWithAssistant: [],
  subjectIdsWithTeacher: [],
} as const;

/**
 * LA CHARGE UTILE DU RUN 94, RECOPIÉE DANS SA FORME FAUTIVE : `summary` là où le
 * serveur émet `totals`.
 *
 * Elle est déclarée comme une VARIABLE, et non comme un littéral rendu depuis
 * une fonction, pour une raison de méthode : un littéral FRAIS produit DEUX
 * diagnostics (la clé en trop À SA LIGNE, la clé manquante à la ligne du
 * littéral), et `@ts-expect-error` n'en couvre qu'un. En passant par une
 * variable, l'unique diagnostic — « il manque `totals` » — tombe sur l'unique
 * ligne que la directive garde. Un contrôle négatif qui laisse échapper une
 * erreur non couverte ne teste pas ce qu'il croit tester.
 */
const RUN_94_DRIFTED_PAYLOAD = {
  data: [] as unknown[],
  total: resultTotal(0),
  limit: 100 as PageSize,
  offset: 0 as PageOffset,
  summary: {
    assignments: resultTotal(0),
    teachers: resultTotal(0),
    classes: resultTotal(0),
    subjectsWithoutTeacher: resultTotal(0),
  },
  coverage: COVERAGE,
};

/**
 * LE CONTRÔLE NÉGATIF LUI-MÊME.
 *
 * Au run 94 ce corps typait VERT, parce que `list()` ne déclarait AUCUNE forme :
 * le type de retour était INFÉRÉ du littéral, donc le littéral ne pouvait pas se
 * contredire lui-même. Sous le type désormais DÉCLARÉ par le handler, il ne
 * compile plus — et si un jour il recompilait, la directive deviendrait inutile,
 * ce qui est AUSSI une erreur. Le contrôle rougit donc dans les deux sens.
 */
// @ts-expect-error AC-4 — `summary` au lieu de `totals` : LE défaut du run 94.
const RUN_94_REJECTED: DeclaredAssignmentsEnvelope = RUN_94_DRIFTED_PAYLOAD;

/** LE CONTRÔLE POSITIF — la forme CORRECTE, elle, compile. Sans lui, le contrôle négatif prouverait seulement « quelque chose casse ». */
async function correctHandler(): Promise<DeclaredAssignmentsEnvelope> {
  return {
    data: [],
    total: resultTotal(0),
    limit: 100 as PageSize,
    offset: 0 as PageOffset,
    totals: {
      assignments: resultTotal(0),
      teachers: resultTotal(0),
      classes: resultTotal(0),
      subjectsWithoutTeacher: resultTotal(0),
    },
    coverage: COVERAGE,
  };
}

describe('AC-4 — la dérive de clé serveur ne COMPILE plus', () => {
  it('le contrôle POSITIF compile et rend l’enveloppe attendue', async () => {
    const envelope = await correctHandler();
    expect(Object.keys(envelope).sort()).toEqual(
      ['coverage', 'data', 'limit', 'offset', 'total', 'totals'].sort(),
    );
  });

  it('le contrôle NÉGATIF existe, et sa preuve est la directive `@ts-expect-error` qu’il porte', () => {
    // La VRAIE assertion est portée par le compilateur : si `summary` devenait
    // acceptable, la directive deviendrait inutile et ts-jest / tsc rougiraient
    // sur « unused '@ts-expect-error' directive ». Cette lecture n'est là que
    // pour que la constante ne soit pas éliminée comme morte — et elle DIT au
    // passage que le défaut du run 94 portait bien la clé `summary`.
    expect(Object.keys(RUN_94_REJECTED)).toContain('summary');
    expect(Object.keys(RUN_94_REJECTED)).not.toContain('totals');
  });

  it('DNC-01 — `total: data.length` ne compile pas sur l’enveloppe serveur', () => {
    const rows = ['a', 'b'];
    // @ts-expect-error G-DNC — une LONGUEUR ne porte pas l'étiquette d'un TOTAL.
    const forbidden: PageEnvelope<string> = { data: rows, total: rows.length };
    // `forbidden` est délibérément mal typé ; on ne lit que sa forme runtime.
    expect(forbidden.data).toHaveLength(2);
  });

  it('DNC-01 — la même règle vaut pour l’enveloppe d’audit RE-LOGÉE', () => {
    const rows: AuditListResult['data'] = [];
    // @ts-expect-error G-DNC — `AuditListResult.total` est un `ResultTotal`.
    const forbidden: Pick<AuditListResult, 'data' | 'total'> = { data: rows, total: rows.length };
    expect(forbidden.data).toEqual([]);
  });

  it('le seul chemin vers un `total` est `resultTotal()`, et il REJETTE un non-entier', () => {
    const total: ResultTotal = resultTotal(7);
    expect(total).toBe(7);
    expect(() => resultTotal(-1)).toThrow();
    expect(() => resultTotal(1.5)).toThrow();
  });
});
