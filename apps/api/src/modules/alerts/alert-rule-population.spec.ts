import { $Enums } from '@prisma/client';

import {
  ALERT_RULE_CATALOGUE_SIZE,
  ALERT_RULE_CODES,
  ALERT_RULES_SCOPE_LABEL,
  alertRuleScopeWhere,
  countEnabledAlertRules,
  enabledAlertRuleWhere,
} from './alert-rule-population';
import { RULE_CODES } from './alerts.types';

/**
 * S-E03-6 / `PF-20` — le KPI « Alertes configurées » et la page `/admin/alerts`
 * comptaient deux populations différentes sous un accord supposé.
 */
describe('alert-rule-population (S-E03-6, PF-20)', () => {
  describe('le catalogue est UN', () => {
    it('dérive de l’enum Prisma plutôt que d’une liste recopiée', () => {
      expect([...ALERT_RULE_CODES].sort()).toEqual(
        Object.values($Enums.AlertRuleCode).sort(),
      );
    });

    it('anti-vacuité : le catalogue n’est pas vide', () => {
      expect(ALERT_RULE_CATALOGUE_SIZE).toBeGreaterThan(0);
    });

    /**
     * LE test rouge-avant. `AnalyticsService.DEFAULT_ALERT_RULES` comptait
     * QUATRE codes quand l’enum en portait HUIT : la seconde liste tenue à la
     * main avait dérivé, et le tableau de bord affichait « 4 » pour une raison
     * que personne ne pouvait lire. Ce test aurait été rouge avant le correctif.
     */
    it('RULE_CODES (ordre d’affichage) couvre exactement l’enum — aucune liste ne dérive', () => {
      expect([...RULE_CODES].sort()).toEqual([...ALERT_RULE_CODES].sort());
      expect(RULE_CODES).toHaveLength(ALERT_RULE_CATALOGUE_SIZE);
    });
  });

  describe('la portée est UNE', () => {
    it('traite un schoolId absent comme `null`, la valeur que ensureRules écrit', () => {
      // `@@unique([tenantId, schoolId, code])` traite `null` comme une valeur.
      // Écrire avec `null` et compter avec `undefined` rendrait deux nombres
      // différents pour la même école.
      expect(alertRuleScopeWhere({ tenantId: 't1', schoolId: null })).toEqual({
        tenantId: 't1',
        schoolId: null,
      });
      expect(alertRuleScopeWhere({ tenantId: 't1', schoolId: 's1' })).toEqual({
        tenantId: 't1',
        schoolId: 's1',
      });
    });

    it('« activée » est la portée PLUS enabled — jamais une clause parallèle', () => {
      const scope = alertRuleScopeWhere({ tenantId: 't1', schoolId: 's1' });
      expect(enabledAlertRuleWhere({ tenantId: 't1', schoolId: 's1' })).toEqual({
        ...scope,
        enabled: true,
      });
    });
  });

  describe('countEnabledAlertRules — LA dérivation', () => {
    function counter(rows: Array<{ enabled: boolean }>) {
      const calls: unknown[] = [];
      return {
        calls,
        db: {
          alertRule: {
            count: async (args: { where: unknown }) => {
              calls.push(args.where);
              return rows.filter((r) => r.enabled).length;
            },
          },
        },
      };
    }

    it('compte les règles activées de cette école, et les scope', async () => {
      const c = counter([{ enabled: true }, { enabled: true }, { enabled: false }]);
      const n = await countEnabledAlertRules(c.db, { tenantId: 't1', schoolId: 's1' });
      expect(n).toBe(2);
      expect(c.calls[0]).toEqual({ tenantId: 't1', schoolId: 's1', enabled: true });
    });

    /**
     * L’invariant qui rend la projection de LECTURE correcte sans écrire.
     * `ensureRules` matérialise les huit lignes à la première ouverture de
     * `/admin/alerts`, toutes à `enabled: false`. Un tenant qui n’a jamais
     * ouvert la page n’a AUCUNE ligne. Les deux états répondent `0` — par
     * construction, pas par chance — donc ce compte ne doit rien matérialiser.
     */
    it('rend 0 aussi bien avant qu’après matérialisation — donc n’écrit jamais', async () => {
      const jamais = counter([]);
      await expect(
        countEnabledAlertRules(jamais.db, { tenantId: 't1', schoolId: 's1' }),
      ).resolves.toBe(0);

      const materialise = counter(
        ALERT_RULE_CODES.map(() => ({ enabled: false })),
      );
      await expect(
        countEnabledAlertRules(materialise.db, { tenantId: 't1', schoolId: 's1' }),
      ).resolves.toBe(0);
    });

    it('ne rend JAMAIS la taille du catalogue quand rien n’est activé', async () => {
      // Le défaut d’origine, énoncé comme test : le tableau de bord rendait la
      // longueur d’une constante, donc un nombre non nul sur un établissement
      // qui n’avait activé aucune règle.
      const c = counter(ALERT_RULE_CODES.map(() => ({ enabled: false })));
      const n = await countEnabledAlertRules(c.db, { tenantId: 't1', schoolId: 's1' });
      expect(n).toBe(0);
      expect(n).not.toBe(ALERT_RULE_CATALOGUE_SIZE);
    });
  });

  describe('les portées sont ÉTIQUETÉES', () => {
    it('nomme deux populations distinctes et ne les confond pas', () => {
      expect(ALERT_RULES_SCOPE_LABEL.enabled).not.toEqual(
        ALERT_RULES_SCOPE_LABEL.catalogue,
      );
      expect(ALERT_RULES_SCOPE_LABEL.enabled).toMatch(/activ/i);
    });
  });
});
