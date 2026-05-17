import { AlertTriangle, CheckCircle2, Lightbulb, ShieldAlert, TrendingDown, UserX } from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  formatDateLong,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';

export const metadata: Metadata = { title: 'Recommandations' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

type AlertCode =
  | 'LOW_SUBJECT_AVG'
  | 'NEGATIVE_TREND'
  | 'REPEATED_FAILURE'
  | 'MISSING_ASSESSMENT'
  | 'HIGH_ABSENCE'
  | 'TEACHER_COMMENT_FLAG'
  | 'BEHAVIOR_ALERT';

interface AlertItem {
  id: string;
  code: AlertCode;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  title: string;
  body: string;
  recommendation: string | null;
  subjectName: string | null;
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

const CODE_ICON: Record<AlertCode, typeof AlertTriangle> = {
  LOW_SUBJECT_AVG: TrendingDown,
  NEGATIVE_TREND: TrendingDown,
  REPEATED_FAILURE: AlertTriangle,
  MISSING_ASSESSMENT: AlertTriangle,
  HIGH_ABSENCE: UserX,
  TEACHER_COMMENT_FLAG: ShieldAlert,
  BEHAVIOR_ALERT: ShieldAlert,
};

const SEVERITY_CARD_CLS: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-sky-50 ring-sky-200',
  medium: 'bg-amber-50 ring-amber-200',
  high: 'bg-rose-50 ring-rose-200',
};

const SEVERITY_ICON_CLS: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-sky-100 text-sky-700',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-rose-100 text-rose-700',
};

export default async function ParentRecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string }>;
}) {
  const sp = await searchParams;
  const studentsResp = await safe(
    api<{ data: StudentSummary[] }>('/api/v1/students', { cache: 'no-store' }),
  );
  const children = studentsResp?.data ?? [];

  if (children.length === 0) {
    return (
      <PortalShell portal="parent">
        <PageHeader
          breadcrumb={[
            { label: 'Tableau de bord', href: '/parent/dashboard' },
            { label: 'Recommandations' },
          ]}
          title="Recommandations"
        />
        <EmptyState
          icon={Lightbulb}
          title="Aucun enfant rattaché"
          description="Les recommandations apparaîtront ici."
          tone="amber"
          className="mt-6"
        />
      </PortalShell>
    );
  }

  const activeStudentId =
    sp.studentId && children.find((c) => c.id === sp.studentId)
      ? sp.studentId
      : children[0]!.id;

  const resp = await safe(
    api<{ data: AlertItem[] }>(`/api/v1/alerts/parent/${activeStudentId}`, {
      cache: 'no-store',
    }),
  );
  const alerts = resp?.data ?? [];

  const high = alerts.filter((a) => a.severity === 'high').length;
  const medium = alerts.filter((a) => a.severity === 'medium').length;
  const withReco = alerts.filter((a) => a.recommendation).length;

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Recommandations' },
        ]}
        title="Recommandations"
        subtitle="Alertes explicables détectées par le moteur, avec des pistes d'action concrètes"
      />

      <div className="mt-4">
        <ChildSelector items={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Lightbulb} tone="blue" label="ALERTES OUVERTES" value={alerts.length}>
          À examiner
        </KpiCard>
        <KpiCard icon={ShieldAlert} tone="rose" label="CRITIQUES" value={high}>
          Sévérité élevée
        </KpiCard>
        <KpiCard icon={AlertTriangle} tone="amber" label="MODÉRÉES" value={medium}>
          Sévérité moyenne
        </KpiCard>
        <KpiCard icon={CheckCircle2} tone="green" label="AVEC PISTE D'ACTION" value={withReco}>
          Recommandation associée
        </KpiCard>
      </div>

      <section className="mt-6">
        {alerts.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Aucune alerte ouverte — bravo !"
            description="Le moteur d'alertes n'a détecté aucune situation préoccupante. Les recommandations apparaîtront ici dès qu'une alerte sera déclenchée."
            tone="slate"
          />
        ) : (
          <ul className="space-y-3">
            {alerts.map((a) => {
              const Icon = CODE_ICON[a.code];
              return (
                <li
                  key={a.id}
                  className={`rounded-2xl p-5 ring-1 ${SEVERITY_CARD_CLS[a.severity]}`}
                >
                  <div className="flex items-start gap-4">
                    <span
                      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${SEVERITY_ICON_CLS[a.severity]}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">{a.title}</h3>
                        {a.subjectName && (
                          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                            {a.subjectName}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-700">{a.body}</p>
                      {a.recommendation && (
                        <div className="mt-3 rounded-lg bg-white/80 p-3 ring-1 ring-white">
                          <div className="flex items-start gap-2">
                            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                            <p className="text-sm font-medium text-slate-800">
                              {a.recommendation}
                            </p>
                          </div>
                        </div>
                      )}
                      <p className="mt-2 text-[11px] text-slate-500">
                        Détectée le {formatDateLong(a.detectedAt)}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}
