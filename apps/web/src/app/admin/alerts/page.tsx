import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ShieldAlert,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  formatDateLong,
} from '@pilotage/ui';

import { AlertInstanceActions } from './AlertInstanceActions';
import { AlertRuleToggle } from './AlertRuleToggle';
import type { AlertRuleCode } from './actions';
import { EvaluateNowButton } from './EvaluateNowButton';

export const metadata: Metadata = { title: 'Alertes' };
export const dynamic = 'force-dynamic';

interface AlertRule {
  id: string | null;
  code: AlertRuleCode;
  label: string;
  description: string;
  enabled: boolean;
  severity: 'low' | 'medium' | 'high';
  parameters: Record<string, unknown>;
  openInstances: number;
}

interface AlertInstance {
  id: string;
  code: AlertRuleCode;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  studentId: string;
  studentName: string;
  subjectId: string | null;
  subjectName: string | null;
  classSectionId: string | null;
  classSectionName: string | null;
  title: string;
  body: string;
  recommendation: string | null;
  detectedAt: string;
}

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

const SEVERITY_LABEL: Record<'low' | 'medium' | 'high', string> = {
  low: 'Faible',
  medium: 'Moyenne',
  high: 'Élevée',
};

const SEVERITY_TONE: Record<'low' | 'medium' | 'high', 'sky' | 'warning' | 'danger'> = {
  low: 'sky',
  medium: 'warning',
  high: 'danger',
};

const STATUS_LABEL: Record<AlertInstance['status'], string> = {
  open: 'À traiter',
  acknowledged: 'Vue',
  resolved: 'Résolue',
  dismissed: 'Ignorée',
};

const STATUS_TONE: Record<AlertInstance['status'], 'danger' | 'warning' | 'success' | 'neutral'> = {
  open: 'danger',
  acknowledged: 'warning',
  resolved: 'success',
  dismissed: 'neutral',
};

const RULE_IMPLEMENTED: Partial<Record<AlertRuleCode, true>> = {
  LOW_SUBJECT_AVG: true,
  HIGH_ABSENCE: true,
  REPEATED_FAILURE: true,
};

export default async function AlertsPage() {
  const [rulesResp, openResp, historyResp] = await Promise.all([
    safe(api<{ data: AlertRule[] }>('/api/v1/alerts/rules', { cache: 'no-store' })),
    safe(
      api<{ data: AlertInstance[]; total: number }>(
        '/api/v1/alerts/instances?status=open&limit=50',
        { cache: 'no-store' },
      ),
    ),
    safe(
      api<{ data: AlertInstance[]; total: number }>(
        '/api/v1/alerts/instances?status=resolved&limit=50',
        { cache: 'no-store' },
      ),
    ),
  ]);

  const rules = rulesResp?.data ?? [];
  const openAlerts = openResp?.data ?? [];
  const history = historyResp?.data ?? [];

  const enabledRules = rules.filter((r) => r.enabled).length;
  const openCount = openResp?.total ?? openAlerts.length;
  const highOpen = openAlerts.filter((a) => a.severity === 'high').length;
  const resolvedCount = historyResp?.total ?? history.length;

  return (
    <PortalShell portal="admin">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/admin/dashboard' },
          { label: 'Alertes' },
        ]}
        title="Alertes"
        subtitle="Configurez les règles, lancez l'évaluation, traitez les alertes ouvertes"
        actions={<EvaluateNowButton />}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Bell} tone="blue" label="RÈGLES ACTIVES" value={enabledRules}>
          {rules.length} règles disponibles
        </KpiCard>
        <KpiCard icon={AlertTriangle} tone="orange" label="ALERTES OUVERTES" value={openCount}>
          À traiter
        </KpiCard>
        <KpiCard icon={ShieldAlert} tone="rose" label="ALERTES CRITIQUES" value={highOpen}>
          Sévérité élevée
        </KpiCard>
        <KpiCard icon={CheckCircle2} tone="green" label="ALERTES RÉSOLUES" value={resolvedCount}>
          Historique
        </KpiCard>
      </div>

      <div className="mt-6">
        <Tabs defaultValue="rules" variant="underline">
          <TabsList>
            <TabsTrigger value="rules">Règles d&apos;alerte</TabsTrigger>
            <TabsTrigger value="active">Alertes actives</TabsTrigger>
            <TabsTrigger value="history">Historique</TabsTrigger>
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
            <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
              {openAlerts.length === 0 ? (
                <EmptyState
                  icon={CheckCircle2}
                  title="Aucune alerte ouverte"
                  description="Toutes les alertes ont été traitées. Le moteur vérifie automatiquement toutes les 15 minutes."
                  tone="slate"
                />
              ) : (
                <AlertTable rows={openAlerts} />
              )}
            </section>
          </TabsContent>

          {/* ────────────── Historique ────────────── */}
          <TabsContent value="history">
            <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
              {history.length === 0 ? (
                <EmptyState
                  icon={Bell}
                  title="Historique vide"
                  description="L'historique des alertes résolues apparaîtra ici."
                  tone="slate"
                />
              ) : (
                <AlertTable rows={history} />
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </PortalShell>
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
