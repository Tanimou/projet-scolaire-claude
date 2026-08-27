import { $Enums, type AlertRuleCode, type Prisma } from '@prisma/client';

/**
 * `alert-rule-population` — LA définition unique de « quelles règles d'alerte
 * existent » et de « combien sont configurées » (S-E03-6, `PF-20`).
 *
 * ## Le défaut qu'il remplace, mesuré
 *
 * « Alertes configurées » sur `/admin/dashboard` affichait
 * `AnalyticsService.DEFAULT_ALERT_RULES.length` — **la longueur d'une
 * constante privée**. Aucune lecture de la base ne pouvait la contredire : le
 * nombre ne consultait jamais les données. C'est le moteur réel du « 4 alertes
 * vs 0 règles » de `PF-20`.
 *
 * Pire, et c'est ce qui rend la classe entière du défaut visible : cette
 * constante était une **seconde liste tenue à la main** du catalogue des
 * règles, et elle avait **déjà dérivé**. Le catalogue canonique `RULE_CODES`
 * (`alerts.types.ts`, aligné sur l'enum `AlertRuleCode` de Prisma) compte
 * **huit** codes ; la copie de `analytics.service.ts` en comptait **quatre** —
 * `REPEATED_FAILURE`, `MISSING_ASSESSMENT`, `TEACHER_COMMENT_FLAG` et
 * `IMPROVEMENT` manquaient. Le tableau de bord ne se contentait donc pas
 * d'afficher un nombre non vérifiable : il affichait un nombre **faux**, et
 * personne ne pouvait le voir parce que les deux listes ne se rencontraient
 * jamais dans le code.
 *
 * ## La décision, et pourquoi elle n'est pas technique
 *
 * « configurées » est-il une **constante** (« combien de règles le produit
 * connaît-il ») ou une **collection persistée** (« combien l'établissement
 * en a-t-il activées ») ? Le schéma tranche : `model AlertRule` existe, porte
 * `enabled` avec `@default(false)`, et `/admin/alerts` compte déjà
 * `rules.filter((r) => r.enabled).length` sous l'étiquette « Règles activées ».
 * Le tableau de bord et la page nommaient donc deux populations différentes
 * sous un accord supposé. C'est **une collection persistée** ; voir `ADR-077`.
 *
 * ## L'invariant qui rend le compte indépendant de la matérialisation
 *
 * `AlertsService.ensureRules` matérialise les huit lignes **à la première
 * lecture** de `/admin/alerts`, toutes à `enabled: false`. Un tenant qui n'a
 * jamais ouvert la page n'a donc **aucune** ligne `alert_rule`. Compter les
 * règles activées reste néanmoins correct dans les deux états — non par
 * chance, mais **par construction** : une règle non matérialisée n'est pas
 * activée, et une règle matérialisée par défaut ne l'est pas non plus. Les
 * deux mondes répondent `0`. C'est pour cela que cette projection de LECTURE
 * n'a pas besoin d'écrire, et elle ne doit pas : `countEnabledRules` ne
 * matérialise rien. `alert-rule-population.spec.ts` gèle cet invariant.
 */

/**
 * Le catalogue canonique, **dérivé de l'enum Prisma** plutôt que ré-écrit.
 *
 * `RULE_CODES` (`alerts.types.ts`) fixe l'ORDRE d'affichage et reste la source
 * pour l'UI ; cet ensemble-ci sert à prouver qu'aucune autre liste ne prétend
 * énumérer les mêmes règles. Deux listes tenues à la main dérivent en silence —
 * c'est exactement ce qui vient de se produire — donc celle-ci n'est pas tenue
 * à la main du tout.
 */
export const ALERT_RULE_CODES: ReadonlyArray<AlertRuleCode> = Object.values(
  $Enums.AlertRuleCode,
);

/** Nombre de règles que le produit connaît. Jamais un littéral. */
export const ALERT_RULE_CATALOGUE_SIZE: number = ALERT_RULE_CODES.length;

/**
 * LA clause de portée des règles d'une école. `ensureRules`, `listRules` et le
 * KPI du tableau de bord la partagent, ce qui est la seule raison pour laquelle
 * ils ne peuvent plus se contredire.
 *
 * Le `?? null` n'est pas une coquetterie : `AlertRule.schoolId` est nullable et
 * `@@unique([tenantId, schoolId, code])` traite `null` comme une valeur. Écrire
 * les lignes avec `null` puis les compter avec `undefined` (donc « sans
 * filtre ») rendrait deux nombres différents pour la même école.
 */
export function alertRuleScopeWhere(args: {
  tenantId: string;
  schoolId: string | null;
}): Prisma.AlertRuleWhereInput {
  return { tenantId: args.tenantId, schoolId: args.schoolId ?? null };
}

/** La clause « cette règle est activée », dans cette école. */
export function enabledAlertRuleWhere(args: {
  tenantId: string;
  schoolId: string | null;
}): Prisma.AlertRuleWhereInput {
  return { ...alertRuleScopeWhere(args), enabled: true };
}

/**
 * Interface minimale acceptée par `countEnabledRules` : le client Prisma
 * complet comme une transaction de portée tenant satisfont tous deux ce
 * contrat, si bien que l'appelant choisit sa connexion sans que cette
 * dérivation ait à en connaître deux.
 */
export type AlertRuleCounter = {
  alertRule: { count(args: { where: Prisma.AlertRuleWhereInput }): Promise<number> };
};

/**
 * LA dérivation de « Alertes configurées ». Le tableau de bord admin et la
 * page `/admin/alerts` doivent tous deux passer par ici.
 */
export async function countEnabledAlertRules(
  db: AlertRuleCounter,
  args: { tenantId: string; schoolId: string | null },
): Promise<number> {
  return db.alertRule.count({ where: enabledAlertRuleWhere(args) });
}

/**
 * Les étiquettes de portée des deux populations que l'on peut légitimement
 * appeler « alertes configurées ». Elles existent pour que le choix soit
 * **visible à l'écran** plutôt que deviné : `PF-20` n'est pas né d'un mauvais
 * `count`, il est né de deux nombres corrects qui comptaient des choses
 * différentes sous un accord supposé.
 *
 * `catalogue` n'a pas d'appelant aujourd'hui et c'est voulu : il nomme la
 * lecture que le tableau de bord faisait **par accident**, pour qu'un futur
 * KPI qui voudrait vraiment celle-là doive l'écrire.
 */
export const ALERT_RULES_SCOPE_LABEL = {
  /** Les règles activées dans cette école — la population persistée. */
  enabled: 'Règles activées dans cette école',
  /** Les règles que le produit connaît — une constante du produit. */
  catalogue: 'Règles disponibles dans le produit',
} as const;
