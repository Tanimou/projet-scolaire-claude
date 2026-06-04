import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Lightbulb,
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
  SubjectChip,
  formatDateLong,
  formatInDays,
} from '@pilotage/ui';

import { ChildSelector } from '../_components/ChildSelector';

import { AlertActions } from './AlertActions';
import { AlertNextSteps } from './AlertNextSteps';
import { RecommendationsFilters } from './RecommendationsFilters';
import type {
  AcknowledgedFilter,
  AlertCode,
  AlertCodeFilter,
  AlertItem,
  AlertSeverity,
  SeverityFilter,
  SubjectOption,
} from './types';

export const metadata: Metadata = { title: 'Recommandations' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const VALID_SEVERITIES: ReadonlyArray<AlertSeverity> = ['low', 'medium', 'high'];
const VALID_CODES: ReadonlyArray<AlertCode> = [
  'LOW_SUBJECT_AVG',
  'NEGATIVE_TREND',
  'REPEATED_FAILURE',
  'MISSING_ASSESSMENT',
  'HIGH_ABSENCE',
  'TEACHER_COMMENT_FLAG',
  'BEHAVIOR_ALERT',
];
const VALID_ACK: ReadonlyArray<AcknowledgedFilter> = ['open', 'acknowledged'];

const CODE_LABEL: Record<AlertCode, string> = {
  LOW_SUBJECT_AVG: 'Moyenne basse',
  NEGATIVE_TREND: 'Tendance négative',
  REPEATED_FAILURE: 'Échecs répétés',
  MISSING_ASSESSMENT: 'Évaluation manquante',
  HIGH_ABSENCE: 'Absences élevées',
  TEACHER_COMMENT_FLAG: 'Signalement enseignant',
  BEHAVIOR_ALERT: 'Comportement',
};

const CODE_ICON: Record<AlertCode, typeof AlertTriangle> = {
  LOW_SUBJECT_AVG: TrendingDown,
  NEGATIVE_TREND: TrendingDown,
  REPEATED_FAILURE: AlertTriangle,
  MISSING_ASSESSMENT: AlertTriangle,
  HIGH_ABSENCE: UserX,
  TEACHER_COMMENT_FLAG: ShieldAlert,
  BEHAVIOR_ALERT: ShieldAlert,
};

const SEVERITY_CARD_CLS: Record<AlertSeverity, string> = {
  low: 'bg-sky-50 ring-sky-200',
  medium: 'bg-amber-50 ring-amber-200',
  high: 'bg-rose-50 ring-rose-200',
};

const SEVERITY_ICON_CLS: Record<AlertSeverity, string> = {
  low: 'bg-sky-100 text-sky-700',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-rose-100 text-rose-700',
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  low: 'Faible',
  medium: 'Modérée',
  high: 'Critique',
};

const SEVERITY_HEADER_CLS: Record<AlertSeverity, string> = {
  high: 'bg-rose-50/70 text-rose-800 ring-rose-200',
  medium: 'bg-amber-50/70 text-amber-800 ring-amber-200',
  low: 'bg-sky-50/70 text-sky-800 ring-sky-200',
};

const SEVERITY_ORDER: ReadonlyArray<AlertSeverity> = ['high', 'medium', 'low'];

export default async function ParentRecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    severity?: string;
    code?: string;
    subjectId?: string;
    status?: string;
    q?: string;
  }>;
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
  const all = resp?.data ?? [];

  // KPIs computed on the full dataset (stable across filters).
  const totalAll = all.length;
  const highAll = all.filter((a) => a.severity === 'high').length;
  const mediumAll = all.filter((a) => a.severity === 'medium').length;
  const withRecoAll = all.filter((a) => a.recommendation).length;

  // Derive subject options from the data so the dropdown matches what's visible.
  const subjectMap = new Map<string, SubjectOption>();
  for (const a of all) {
    if (a.subjectId && a.subjectCode && a.subjectName && !subjectMap.has(a.subjectId)) {
      subjectMap.set(a.subjectId, {
        id: a.subjectId,
        code: a.subjectCode,
        name: a.subjectName,
      });
    }
  }
  const subjects = Array.from(subjectMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'fr'),
  );

  // Validate filters against what we actually have.
  const severityFilter: SeverityFilter =
    sp.severity && VALID_SEVERITIES.includes(sp.severity as AlertSeverity)
      ? (sp.severity as AlertSeverity)
      : '';
  const codeFilter: AlertCodeFilter =
    sp.code && VALID_CODES.includes(sp.code as AlertCode) ? (sp.code as AlertCode) : '';
  const activeSubjectId =
    sp.subjectId && subjectMap.has(sp.subjectId) ? sp.subjectId : '';
  const ackFilter: AcknowledgedFilter =
    sp.status && VALID_ACK.includes(sp.status as AcknowledgedFilter)
      ? (sp.status as AcknowledgedFilter)
      : '';
  const search = (sp.q ?? '').trim().toLowerCase();

  // Apply filters: severity → code → subject → status → search.
  const filtered = all
    .filter((a) => (severityFilter ? a.severity === severityFilter : true))
    .filter((a) => (codeFilter ? a.code === codeFilter : true))
    .filter((a) => (activeSubjectId ? a.subjectId === activeSubjectId : true))
    .filter((a) => (ackFilter ? a.status === ackFilter : true))
    .filter((a) => {
      if (!search) return true;
      const hay = [a.title, a.body, a.recommendation ?? '', a.subjectName ?? '']
        .join(' ')
        .toLowerCase();
      return hay.includes(search);
    });

  // Group by severity, preserving high → medium → low order.
  const groups: Array<{ severity: AlertSeverity; items: AlertItem[] }> = [];
  for (const sev of SEVERITY_ORDER) {
    const items = filtered.filter((a) => a.severity === sev);
    if (items.length > 0) groups.push({ severity: sev, items });
  }

  // Active filter chips for the recap line.
  const activeFilterChips: string[] = [];
  if (severityFilter) activeFilterChips.push(`Sévérité : ${SEVERITY_LABEL[severityFilter]}`);
  if (codeFilter) activeFilterChips.push(`Type : ${CODE_LABEL[codeFilter]}`);
  if (activeSubjectId)
    activeFilterChips.push(`Matière : ${subjectMap.get(activeSubjectId)!.name}`);
  if (ackFilter)
    activeFilterChips.push(`Statut : ${ackFilter === 'open' ? 'À examiner' : 'Lues'}`);
  if (search) activeFilterChips.push(`Recherche : « ${search} »`);

  const headerSubtitle =
    totalAll > 0
      ? "Alertes explicables détectées par le moteur, avec des pistes d'action concrètes"
      : 'Aucune alerte ouverte — les recommandations apparaîtront ici dès qu’une situation sera détectée';

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Recommandations' },
        ]}
        title="Recommandations"
        subtitle={headerSubtitle}
      />

      <div className="mt-4">
        <ChildSelector items={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Lightbulb} tone="blue" label="ALERTES OUVERTES" value={totalAll}>
          À examiner
        </KpiCard>
        <KpiCard icon={ShieldAlert} tone="rose" label="CRITIQUES" value={highAll}>
          Sévérité élevée
        </KpiCard>
        <KpiCard icon={AlertTriangle} tone="amber" label="MODÉRÉES" value={mediumAll}>
          Sévérité moyenne
        </KpiCard>
        <KpiCard icon={CheckCircle2} tone="green" label="AVEC PISTE D'ACTION" value={withRecoAll}>
          Recommandation associée
        </KpiCard>
      </div>

      {/* Contextual alert strip when there are critical items. */}
      {highAll > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 text-sm text-rose-900">
            <p className="font-bold">
              {highAll} alerte{highAll > 1 ? 's' : ''} critique{highAll > 1 ? 's' : ''} à examiner
              en priorité
            </p>
            <p className="mt-0.5 text-xs text-rose-800/80">
              Les recommandations associées proposent des pistes d&apos;action pour soutenir
              votre enfant. N&apos;hésitez pas à en discuter avec l&apos;équipe enseignante.
            </p>
          </div>
        </div>
      )}

      {totalAll > 0 && (
        <div className="mt-6">
          <RecommendationsFilters
            subjects={subjects}
            severity={severityFilter}
            alertCode={codeFilter}
            subjectId={activeSubjectId}
            ackStatus={ackFilter}
            q={search}
          />
        </div>
      )}

      <section className="mt-4 space-y-6">
        {totalAll === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Aucune alerte ouverte — bravo !"
            description="Le moteur d'alertes n'a détecté aucune situation préoccupante. Les recommandations apparaîtront ici dès qu'une alerte sera déclenchée."
            tone="slate"
          />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Lightbulb}
            title="Aucune alerte avec ces filtres"
            description="Élargissez la sélection, retirez un filtre, ou videz la recherche pour voir plus de résultats."
            tone="slate"
          />
        ) : (
          groups.map((g) => (
            <div key={g.severity} className="space-y-3">
              <div
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ring-1 ${SEVERITY_HEADER_CLS[g.severity]}`}
              >
                <span className={`h-2 w-2 rounded-full ${
                  g.severity === 'high'
                    ? 'bg-rose-500'
                    : g.severity === 'medium'
                      ? 'bg-amber-500'
                      : 'bg-sky-500'
                }`} />
                Sévérité {SEVERITY_LABEL[g.severity].toLowerCase()}
                <span className="rounded-full bg-white/70 px-1.5 text-[10px] font-bold text-slate-600">
                  {g.items.length}
                </span>
              </div>
              <ul className="space-y-3">
                {g.items.map((a) => {
                  const Icon = CODE_ICON[a.code];
                  const isAcknowledged = a.status === 'acknowledged';
                  return (
                    <li
                      key={a.id}
                      className={`rounded-2xl p-5 ring-1 transition-shadow hover:shadow-sm ${SEVERITY_CARD_CLS[a.severity]}`}
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
                            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                              {CODE_LABEL[a.code]}
                            </span>
                            {a.subjectCode && a.subjectName && (
                              <SubjectChip
                                subjectCode={a.subjectCode}
                                label={a.subjectName}
                                size="sm"
                              />
                            )}
                            {isAcknowledged && (
                              <StatusBadge
                                label="Lue"
                                tone="sky"
                                size="sm"
                                withDot
                              />
                            )}
                          </div>
                          <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                            {a.body}
                          </p>
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
                          <AlertNextSteps
                            alertId={a.id}
                            code={a.code}
                            studentId={activeStudentId}
                            subjectId={a.subjectId}
                            subjectCode={a.subjectCode}
                            subjectName={a.subjectName}
                            title={a.title}
                            meetingRequestedAt={a.meetingRequestedAt}
                          />
                          <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            <span>Détectée le {formatDateLong(a.detectedAt)}</span>
                            <span className="text-slate-300">·</span>
                            <span>{formatInDays(a.detectedAt)}</span>
                            {isAcknowledged && a.acknowledgedAt && (
                              <>
                                <span className="text-slate-300">·</span>
                                <span className="inline-flex items-center gap-1 font-medium text-sky-700">
                                  <Eye className="h-3 w-3" />
                                  Lue le {formatDateLong(a.acknowledgedAt)}
                                </span>
                              </>
                            )}
                          </p>
                          <AlertActions
                            alertId={a.id}
                            status={a.status}
                            title={a.title}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      {activeFilterChips.length > 0 && (
        <p className="mt-4 text-[11px] text-slate-500">
          Filtres actifs :{' '}
          {activeFilterChips.map((chip, idx) => (
            <span key={chip}>
              <span className="font-bold text-slate-700">{chip}</span>
              {idx < activeFilterChips.length - 1 && (
                <span className="text-slate-400"> · </span>
              )}
            </span>
          ))}
        </p>
      )}
    </PortalShell>
  );
}
