import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  UserX,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  StatusBadge,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatDateLong,
  type SelectOption,
} from '@pilotage/ui';

import { AlertInstanceActions } from './AlertInstanceActions';
import { AlertRuleToggle } from './AlertRuleToggle';
import { AlertsExportButton, type AlertsExportButtonProps } from './AlertsExportButton';
import { AlertsFilters } from './AlertsFilters';
import { AlertsTabsRouter } from './AlertsTabsRouter';
import type { AlertRuleCode } from './actions';
import { EvaluateNowButton } from './EvaluateNowButton';
import {
  parseTab,
  RULE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  SEVERITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  type AlertInstance,
  type AlertRule,
  type AlertSeverity,
  type AlertStatus,
  type AlertsTabKey,
} from './types';

export const metadata: Metadata = { title: 'Alertes' };
export const dynamic = 'force-dynamic';

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const RULE_ICON: Record<AlertRuleCode, typeof AlertTriangle> = {
  LOW_SUBJECT_AVG: TrendingDown,
  NEGATIVE_TREND: TrendingDown,
  REPEATED_FAILURE: AlertTriangle,
  MISSING_ASSESSMENT: AlertTriangle,
  HIGH_ABSENCE: UserX,
  TEACHER_COMMENT_FLAG: ShieldAlert,
  BEHAVIOR_ALERT: ShieldAlert,
};

const RULE_IMPLEMENTED: Partial<Record<AlertRuleCode, true>> = {
  LOW_SUBJECT_AVG: true,
  HIGH_ABSENCE: true,
  REPEATED_FAILURE: true,
  NEGATIVE_TREND: true,
  MISSING_ASSESSMENT: true,
  TEACHER_COMMENT_FLAG: true,
};

interface AlertsSearchParams {
  tab?: string;
  q?: string;
  ruleCode?: string;
  severity?: string;
  classSection?: string;
  status?: string;
}

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<AlertsSearchParams>;
}) {
  const sp = await searchParams;
  const currentTab: AlertsTabKey = parseTab(sp.tab);

  const [rulesResp, openResp, ackResp, resolvedResp, dismissedResp] = await Promise.all([
    safe(api<{ data: AlertRule[] }>('/api/v1/alerts/rules', { cache: 'no-store' })),
    safe(
      api<{ data: AlertInstance[]; total: number }>(
        '/api/v1/alerts/instances?status=open&limit=100',
        { cache: 'no-store' },
      ),
    ),
    safe(
      api<{ data: AlertInstance[]; total: number }>(
        '/api/v1/alerts/instances?status=acknowledged&limit=100',
        { cache: 'no-store' },
      ),
    ),
    safe(
      api<{ data: AlertInstance[]; total: number }>(
        '/api/v1/alerts/instances?status=resolved&limit=100',
        { cache: 'no-store' },
      ),
    ),
    safe(
      api<{ data: AlertInstance[]; total: number }>(
        '/api/v1/alerts/instances?status=dismissed&limit=100',
        { cache: 'no-store' },
      ),
    ),
  ]);

  const rules = rulesResp?.data ?? [];
  const openRows = openResp?.data ?? [];
  const ackRows = ackResp?.data ?? [];
  const resolvedRows = resolvedResp?.data ?? [];
  const dismissedRows = dismissedResp?.data ?? [];

  const allRows: AlertInstance[] = [...openRows, ...ackRows, ...resolvedRows, ...dismissedRows];
  const activeRows: AlertInstance[] = [...openRows, ...ackRows];
  const historyRows: AlertInstance[] = [...resolvedRows, ...dismissedRows];

  const enabledRules = rules.filter((r) => r.enabled).length;
  const openCount = openResp?.total ?? openRows.length;
  const ackCount = ackResp?.total ?? ackRows.length;
  const highOpen = openRows.filter((a) => a.severity === 'high').length;
  const resolvedCount = resolvedResp?.total ?? resolvedRows.length;

  // ── filter options derived from the full dataset so dropdowns stay stable
  //    across tabs.
  const ruleCodeOptions: SelectOption[] = Array.from(
    new Map(
      allRows.map((r) => [r.code, { value: r.code, label: RULE_LABEL[r.code] ?? r.code }]),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  const severityOptions: SelectOption[] = SEVERITY_ORDER.filter((s) =>
    allRows.some((r) => r.severity === s),
  ).map((s) => ({ value: s, label: SEVERITY_LABEL[s] }));

  const classSectionOptions: SelectOption[] = Array.from(
    new Map(
      allRows
        .filter((r) => r.classSectionId && r.classSectionName)
        .map((r) => [
          r.classSectionId!,
          { value: r.classSectionId!, label: r.classSectionName! },
        ]),
    ).values(),
  ).sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  const statusOptionsForTab: SelectOption[] =
    currentTab === 'active'
      ? [
          { value: 'open', label: STATUS_LABEL.open },
          { value: 'acknowledged', label: STATUS_LABEL.acknowledged },
        ].filter((o) =>
          activeRows.some((r) => r.status === (o.value as AlertStatus)),
        )
      : currentTab === 'history'
        ? [
            { value: 'resolved', label: STATUS_LABEL.resolved },
            { value: 'dismissed', label: STATUS_LABEL.dismissed },
          ].filter((o) =>
            historyRows.some((r) => r.status === (o.value as AlertStatus)),
          )
        : [];

  // ── apply filters
  const q = (sp.q ?? '').trim().toLowerCase();
  function applyFilters(rows: AlertInstance[]): AlertInstance[] {
    return rows.filter((r) => {
      if (q && !r.studentName.toLowerCase().includes(q)) return false;
      if (sp.ruleCode && r.code !== sp.ruleCode) return false;
      if (sp.severity && r.severity !== sp.severity) return false;
      if (sp.classSection && r.classSectionId !== sp.classSection) return false;
      if (sp.status && r.status !== sp.status) return false;
      return true;
    });
  }

  const filteredActive = applyFilters(activeRows);
  const filteredHistory = applyFilters(historyRows);

  // ── context-aware CSV export: mirrors whatever the current tab shows
  //    (filters included), so the download matches the view on screen.
  const exportProps: AlertsExportButtonProps =
    currentTab === 'rules'
      ? { mode: 'rules', rules, disabled: rules.length === 0 }
      : currentTab === 'active'
        ? {
            mode: 'instances',
            rows: filteredActive,
            slug: 'alertes-actives',
            heading: 'Alertes actives',
            disabled: filteredActive.length === 0,
          }
        : {
            mode: 'instances',
            rows: filteredHistory,
            slug: 'alertes-historique',
            heading: 'Historique des alertes',
            disabled: filteredHistory.length === 0,
          };

  // ── group active by severity
  const activeBySeverity = new Map<AlertSeverity, AlertInstance[]>();
  for (const s of SEVERITY_ORDER) activeBySeverity.set(s, []);
  for (const r of filteredActive) activeBySeverity.get(r.severity)?.push(r);

  // ── group history by month (descending)
  const historyByMonth = groupByMonth(filteredHistory);

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Alertes' },
        ]}
        title="Alertes"
        subtitle="Configurez les règles, lancez l'évaluation, traitez les alertes ouvertes"
        actions={
          <div className="flex items-start gap-2">
            <AlertsExportButton {...exportProps} />
            <EvaluateNowButton />
          </div>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Bell} tone="blue" label="RÈGLES ACTIVES" value={enabledRules}>
          {rules.length > 0 ? `${rules.length} règles disponibles` : 'Aucune règle configurée'}
        </KpiCard>
        <KpiCard
          icon={AlertTriangle}
          tone={openCount > 0 ? 'orange' : 'green'}
          label="À TRAITER"
          value={openCount}
        >
          {highOpen > 0
            ? `${highOpen} critique${highOpen > 1 ? 's' : ''} à prioriser`
            : 'Aucune alerte ouverte'}
        </KpiCard>
        <KpiCard
          icon={ShieldAlert}
          tone={ackCount > 0 ? 'amber' : 'slate'}
          label="EN COURS"
          value={ackCount}
        >
          Vues, pas encore résolues
        </KpiCard>
        <KpiCard
          icon={CheckCircle2}
          tone="green"
          label="RÉSOLUES"
          value={resolvedCount}
        >
          {dismissedRows.length > 0
            ? `+ ${dismissedRows.length} ignorée${dismissedRows.length > 1 ? 's' : ''}`
            : 'Historique des interventions'}
        </KpiCard>
      </div>

      <div className="mt-6">
        <AlertsTabsRouter value={currentTab}>
          <TabsList>
            <TabsTrigger value="rules">
              Règles d&apos;alerte
              <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                {rules.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="active">
              Alertes actives
              <span
                className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  openCount + ackCount > 0
                    ? 'bg-rose-100 text-rose-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {openCount + ackCount}
              </span>
            </TabsTrigger>
            <TabsTrigger value="history">
              Historique
              <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                {resolvedCount + dismissedRows.length}
              </span>
            </TabsTrigger>
          </TabsList>

          {/* ────────────── Règles ────────────── */}
          <TabsContent value="rules">
            <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Règles disponibles</h2>
                  <p className="text-xs text-slate-500">
                    Activez les règles à évaluer. Le worker exécute le moteur toutes les 15 min ;
                    le bouton ci-dessus déclenche un passage immédiat.
                  </p>
                </div>
              </div>

              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {rules.map((rule) => {
                  const Icon = RULE_ICON[rule.code];
                  const implemented = !!RULE_IMPLEMENTED[rule.code];
                  return (
                    <li
                      key={rule.code}
                      className="rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-slate-200">
                          <Icon className="h-4 w-4 text-slate-600" />
                        </span>
                        <AlertRuleToggle code={rule.code} initial={rule.enabled} />
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">{rule.label}</h3>
                        <StatusBadge
                          label={SEVERITY_LABEL[rule.severity]}
                          tone={SEVERITY_TONE[rule.severity]}
                          size="sm"
                        />
                        {!implemented && (
                          <span
                            className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700"
                            title="Évaluateur non implémenté — UI seulement"
                          >
                            UI seulement
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{rule.description}</p>
                      <div className="mt-3 rounded-md bg-white px-2 py-1.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-100">
                        {formatParameters(rule.parameters)}
                      </div>
                      {rule.enabled && rule.openInstances > 0 && (
                        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                          {rule.openInstances} alerte{rule.openInstances > 1 ? 's' : ''} ouverte
                          {rule.openInstances > 1 ? 's' : ''}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </TabsContent>

          {/* ────────────── Alertes actives ────────────── */}
          <TabsContent value="active">
            {currentTab === 'active' && (
              <div className="space-y-4">
                <AlertsFilters
                  currentTab="active"
                  initialQ={sp.q ?? ''}
                  initialRuleCode={sp.ruleCode ?? ''}
                  initialSeverity={sp.severity ?? ''}
                  initialClassSection={sp.classSection ?? ''}
                  initialStatus={sp.status ?? ''}
                  ruleCodeOptions={ruleCodeOptions}
                  severityOptions={severityOptions}
                  classSectionOptions={classSectionOptions}
                  statusOptions={statusOptionsForTab}
                />

                {highOpen > 0 && (
                  <ActionStrip
                    title={`${highOpen} alerte${highOpen > 1 ? 's' : ''} critique${highOpen > 1 ? 's' : ''} à prioriser`}
                    body="Ces situations correspondent à des règles à sévérité élevée. Convoquer le tuteur, déclencher un PAI ou contacter la famille selon le cas."
                  />
                )}

                {filteredActive.length === 0 ? (
                  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                    <EmptyState
                      icon={CheckCircle2}
                      title={
                        activeRows.length === 0
                          ? 'Aucune alerte ouverte'
                          : 'Aucune alerte ne correspond aux filtres'
                      }
                      description={
                        activeRows.length === 0
                          ? "Toutes les alertes ont été traitées. Le moteur vérifie automatiquement toutes les 15 minutes."
                          : 'Élargissez la sévérité, la règle ou réinitialisez les filtres pour voir les alertes en cours.'
                      }
                      tone="slate"
                    />
                  </section>
                ) : (
                  SEVERITY_ORDER.map((sev) => {
                    const rows = activeBySeverity.get(sev) ?? [];
                    if (rows.length === 0) return null;
                    return (
                      <SeveritySection
                        key={sev}
                        severity={sev}
                        rows={rows}
                        totalForSeverity={activeRows.filter((r) => r.severity === sev).length}
                      />
                    );
                  })
                )}
              </div>
            )}
          </TabsContent>

          {/* ────────────── Historique ────────────── */}
          <TabsContent value="history">
            {currentTab === 'history' && (
              <div className="space-y-4">
                <AlertsFilters
                  currentTab="history"
                  initialQ={sp.q ?? ''}
                  initialRuleCode={sp.ruleCode ?? ''}
                  initialSeverity={sp.severity ?? ''}
                  initialClassSection={sp.classSection ?? ''}
                  initialStatus={sp.status ?? ''}
                  ruleCodeOptions={ruleCodeOptions}
                  severityOptions={severityOptions}
                  classSectionOptions={classSectionOptions}
                  statusOptions={statusOptionsForTab}
                />

                {filteredHistory.length === 0 ? (
                  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
                    <EmptyState
                      icon={Bell}
                      title={
                        historyRows.length === 0
                          ? 'Historique vide'
                          : 'Aucune alerte ne correspond aux filtres'
                      }
                      description={
                        historyRows.length === 0
                          ? "L'historique des alertes résolues apparaîtra ici."
                          : 'Élargissez la période, la sévérité ou la règle pour retrouver les alertes archivées.'
                      }
                      tone="slate"
                    />
                  </section>
                ) : (
                  historyByMonth.map((bucket) => (
                    <MonthSection key={bucket.key} bucket={bucket} />
                  ))
                )}
              </div>
            )}
          </TabsContent>
        </AlertsTabsRouter>
      </div>
    </PortalShell>
  );
}

interface MonthBucket {
  key: string;
  label: string;
  rows: AlertInstance[];
}

function groupByMonth(rows: AlertInstance[]): MonthBucket[] {
  const map = new Map<string, MonthBucket>();
  const fmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });
  for (const r of rows) {
    const d = new Date(r.detectedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!map.has(key)) {
      const label = fmt.format(d);
      map.set(key, {
        key,
        label: label.charAt(0).toUpperCase() + label.slice(1),
        rows: [],
      });
    }
    map.get(key)!.rows.push(r);
  }
  return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
}

function SeveritySection({
  severity,
  rows,
  totalForSeverity,
}: {
  severity: AlertSeverity;
  rows: AlertInstance[];
  totalForSeverity: number;
}) {
  const tone = SEVERITY_TONE[severity];
  const stripe = tone === 'danger' ? 'bg-rose-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-sky-500';
  const headerBg =
    tone === 'danger' ? 'bg-rose-50/70' : tone === 'warning' ? 'bg-amber-50/70' : 'bg-sky-50/70';
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <div className={`flex items-center justify-between gap-2 border-l-4 ${stripe} ${headerBg} px-5 py-3`}>
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-bold text-slate-900">
            Sévérité {SEVERITY_LABEL[severity].toLowerCase()}
          </h3>
          <StatusBadge
            label={`${rows.length}/${totalForSeverity}`}
            tone={SEVERITY_TONE[severity]}
            size="sm"
          />
        </div>
        {severity === 'high' && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-700">
            <Sparkles className="h-3 w-3" />
            À prioriser
          </span>
        )}
      </div>
      <AlertTable rows={rows} />
    </section>
  );
}

function MonthSection({ bucket }: { bucket: MonthBucket }) {
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200/60 bg-slate-50/70 px-5 py-3">
        <h3 className="text-sm font-bold text-slate-900">{bucket.label}</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
          {bucket.rows.length} alerte{bucket.rows.length > 1 ? 's' : ''}
        </span>
      </div>
      <AlertTable rows={bucket.rows} />
    </section>
  );
}

function ActionStrip({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50/70 px-4 py-3">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
      <div className="space-y-0.5">
        <p className="text-sm font-bold text-orange-900">{title}</p>
        <p className="text-xs text-orange-800/90">{body}</p>
      </div>
    </div>
  );
}

function AlertTable({ rows }: { rows: AlertInstance[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50">
          <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <th className="px-4 py-3">Alerte</th>
            <th className="px-4 py-3">Élève</th>
            <th className="px-4 py-3">Matière</th>
            <th className="px-4 py-3">Sévérité</th>
            <th className="px-4 py-3">Détectée</th>
            <th className="px-4 py-3">Statut</th>
            <th className="px-4 py-3 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50/60">
              <td className="px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-slate-900">{a.title}</span>
                  <span className="text-xs text-slate-500">{a.body}</span>
                  {a.recommendation && (
                    <span className="mt-0.5 text-[11px] italic text-slate-400">
                      → {a.recommendation}
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-sm">
                <span className="font-bold text-slate-900">{a.studentName}</span>
                {a.classSectionName && (
                  <span className="ml-1 text-[11px] text-slate-500">({a.classSectionName})</span>
                )}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">{a.subjectName ?? '—'}</td>
              <td className="px-4 py-3">
                <StatusBadge
                  label={SEVERITY_LABEL[a.severity]}
                  tone={SEVERITY_TONE[a.severity]}
                  size="sm"
                />
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">{formatDateLong(a.detectedAt)}</td>
              <td className="px-4 py-3">
                <StatusBadge
                  label={STATUS_LABEL[a.status]}
                  tone={STATUS_TONE[a.status]}
                  size="sm"
                  withDot
                />
              </td>
              <td className="px-4 py-3 text-right">
                <AlertInstanceActions id={a.id} status={a.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatParameters(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return '— pas de paramètre —';
  return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(' · ');
}
