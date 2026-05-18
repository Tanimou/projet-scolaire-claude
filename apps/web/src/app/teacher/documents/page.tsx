import {
  CalendarDays,
  FileArchive,
  FolderOpen,
  Megaphone,
  NotebookPen,
  Sparkles,
} from 'lucide-react';
import type { Metadata } from 'next';

import { PortalShell } from '@/components/PortalShell';
import { DocumentRowCard } from '@/components/documents/DocumentRowCard';
import { DocumentsFilters } from '@/components/documents/DocumentsFilters';
import type {
  DocumentKind,
  DocumentRow,
  KindFilter,
  SourceFilter,
} from '@/components/documents/types';
import {
  detectKind,
  parseAttachments,
  resolveLabel,
} from '@/components/documents/utils';
import { api, ApiError } from '@/lib/api-client';
import {
  EmptyState,
  KpiCard,
  PageHeader,
  Pagination,
  formatDateLong,
} from '@pilotage/ui';

export const metadata: Metadata = { title: 'Ressources' };
export const dynamic = 'force-dynamic';

interface AnnouncementApiRow {
  id: string;
  title: string;
  scope: string;
  publishedAt: string | null;
  cycle?: { name: string } | null;
  gradeLevel?: { name: string } | null;
  classSection?: { id?: string; name: string } | null;
  attachments?: unknown;
  _count?: { recipients: number };
}

interface LessonApiRow {
  id: string;
  date: string;
  title: string;
  status?: 'draft' | 'published' | string;
  attachments?: unknown;
  teachingAssignment: {
    subject: { id: string; name: string; color: string | null };
    classSection: { id: string; name: string };
  };
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

const PAGE_SIZE = 12;

const VALID_SOURCES: SourceFilter[] = ['all', 'announcement', 'lesson'];
const VALID_KINDS: KindFilter[] = [
  'all',
  'pdf',
  'image',
  'video',
  'audio',
  'doc',
  'sheet',
  'slide',
  'archive',
  'link',
  'file',
];

const SCOPE_LABEL: Record<string, string> = {
  school_wide: "Toute l'école",
  cycle_scope: 'Cycle',
  grade_level_scope: 'Niveau',
  class_section_scope: 'Classe',
  individual_student: 'Élève',
  individual_user: 'Personne',
};

function scopeLabel(a: AnnouncementApiRow): string | null {
  const main = SCOPE_LABEL[a.scope] ?? null;
  const target =
    a.classSection?.name ?? a.gradeLevel?.name ?? a.cycle?.name ?? null;
  if (target && main) return `${main} · ${target}`;
  return main ?? target;
}

/**
 * Flattens the `attachments` JSON of an announcement into N DocumentRow.
 * Teacher view → surfaces audience scope + recipient count.
 */
function fromAnnouncement(a: AnnouncementApiRow): DocumentRow[] {
  const attachments = parseAttachments(a.attachments);
  if (attachments.length === 0) return [];
  const publishedAt = a.publishedAt ?? new Date().toISOString();
  const audienceCount = a._count?.recipients ?? null;
  const audienceLabel = scopeLabel(a);
  const isDraft = !a.publishedAt;
  return attachments.map((att, idx) => {
    const label = resolveLabel(att);
    const mimeType = att.mimeType ?? att.contentType ?? att.type ?? null;
    const kind: DocumentKind = detectKind({
      mimeType,
      url: att.url ?? null,
      label,
    });
    return {
      id: `ann:${a.id}:${att.id ?? idx}`,
      source: 'announcement',
      sourceId: a.id,
      label,
      url: att.url ?? null,
      kind,
      mimeType,
      sizeBytes:
        typeof att.sizeBytes === 'number'
          ? att.sizeBytes
          : typeof att.size === 'number'
            ? att.size
            : null,
      publishedAt,
      context: {
        title: a.title,
        subjectName: null,
        subjectColor: null,
        classSectionId: a.classSection?.id ?? null,
        className: a.classSection?.name ?? null,
        teacherName: null,
        audienceCount,
        audienceLabel,
        isDraft,
      },
    };
  });
}

/**
 * Flattens the `attachments` JSON of a lesson into N DocumentRow.
 * Teacher view → suppresses the "teacher" line (they are the author) and
 * exposes the class section id so the source pill deep-links to the class.
 */
function fromLesson(l: LessonApiRow): DocumentRow[] {
  const attachments = parseAttachments(l.attachments);
  if (attachments.length === 0) return [];
  const isDraft = (l.status ?? 'published') !== 'published';
  return attachments.map((att, idx) => {
    const label = resolveLabel(att);
    const mimeType = att.mimeType ?? att.contentType ?? att.type ?? null;
    const kind: DocumentKind = detectKind({
      mimeType,
      url: att.url ?? null,
      label,
    });
    return {
      id: `les:${l.id}:${att.id ?? idx}`,
      source: 'lesson',
      sourceId: l.id,
      label,
      url: att.url ?? null,
      kind,
      mimeType,
      sizeBytes:
        typeof att.sizeBytes === 'number'
          ? att.sizeBytes
          : typeof att.size === 'number'
            ? att.size
            : null,
      publishedAt: l.date,
      context: {
        title: l.title,
        subjectName: l.teachingAssignment.subject.name,
        subjectColor: l.teachingAssignment.subject.color,
        classSectionId: l.teachingAssignment.classSection.id,
        className: l.teachingAssignment.classSection.name,
        teacherName: null,
        audienceCount: null,
        audienceLabel: null,
        isDraft,
      },
    };
  });
}

export default async function TeacherDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    source?: string;
    kind?: string;
    classId?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const query = (sp.q ?? '').trim();
  const source: SourceFilter = VALID_SOURCES.includes(sp.source as SourceFilter)
    ? (sp.source as SourceFilter)
    : 'all';
  const kind: KindFilter = VALID_KINDS.includes(sp.kind as KindFilter)
    ? (sp.kind as KindFilter)
    : 'all';
  const classId = sp.classId && sp.classId !== 'all' ? sp.classId : null;

  // Step 1 — fetch teacher's own announcements + lessons in parallel
  const [announcementsResp, lessonsResp] = await Promise.all([
    safe(
      api<{ data: AnnouncementApiRow[] }>('/api/v1/announcements?mine=true', {
        cache: 'no-store',
      }),
    ),
    safe(
      api<{ data: LessonApiRow[] }>('/api/v1/lessons?mine=true&limit=500', {
        cache: 'no-store',
      }),
    ),
  ]);

  const announcements = announcementsResp?.data ?? [];
  const lessons = lessonsResp?.data ?? [];

  // Step 2 — aggregate attachments into a flat document list
  const documents: DocumentRow[] = [
    ...announcements.flatMap(fromAnnouncement),
    ...lessons.flatMap(fromLesson),
  ].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  // Step 3 — KPIs (always reflect the full unfiltered set)
  const totalDocs = documents.length;
  const fromAnnouncements = documents.filter((d) => d.source === 'announcement').length;
  const fromLessons = documents.filter((d) => d.source === 'lesson').length;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = documents.filter(
    (d) => new Date(d.publishedAt).getTime() >= sevenDaysAgo,
  ).length;

  // Step 4 — build class filter options from what's actually attached
  const classMap = new Map<string, string>();
  for (const d of documents) {
    if (d.context.classSectionId && d.context.className) {
      classMap.set(d.context.classSectionId, d.context.className);
    }
  }
  const classOptions = Array.from(classMap.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));

  // Step 5 — apply filters (search + source + kind + classId)
  const q = query.toLowerCase();
  const filtered = documents.filter((d) => {
    if (source !== 'all' && d.source !== source) return false;
    if (kind !== 'all' && d.kind !== kind) return false;
    if (classId && d.context.classSectionId !== classId) return false;
    if (q.length > 0) {
      const haystack = [
        d.label,
        d.context.title,
        d.context.subjectName,
        d.context.className,
        d.context.audienceLabel,
      ]
        .filter((x): x is string => typeof x === 'string')
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const total = filtered.length;
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // Step 6 — group page rows by ISO date (visual day separators)
  const grouped = pageRows.reduce<Array<{ key: string; date: string; rows: DocumentRow[] }>>(
    (acc, row) => {
      const key = row.publishedAt.slice(0, 10);
      const last = acc[acc.length - 1];
      if (last && last.key === key) {
        last.rows.push(row);
      } else {
        acc.push({ key, date: row.publishedAt, rows: [row] });
      }
      return acc;
    },
    [],
  );

  const hasActiveFilter =
    query.length > 0 ||
    source !== 'all' ||
    kind !== 'all' ||
    classId !== null;

  // Audience cumulé (somme des destinataires touchés sur les annonces publiées)
  const totalAudienceReached = announcements
    .filter((a) => !!a.publishedAt)
    .reduce((sum, a) => sum + (a._count?.recipients ?? 0), 0);

  return (
    <PortalShell portal="teacher">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/teacher/dashboard' },
          { label: 'Ressources' },
        ]}
        title="Ressources pédagogiques"
        subtitle="Vos pièces jointes — supports de cours et fichiers attachés à vos messages, tout au même endroit"
      />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={FolderOpen} tone="blue" label="MES DOCUMENTS" value={totalDocs}>
          Cahier de texte + messages
        </KpiCard>
        <KpiCard icon={Sparkles} tone="violet" label="NOUVEAUX" value={recent}>
          Sur les 7 derniers jours
        </KpiCard>
        <KpiCard icon={NotebookPen} tone="green" label="CAHIER DE TEXTE" value={fromLessons}>
          Supports de cours
        </KpiCard>
        <KpiCard icon={Megaphone} tone="amber" label="MES MESSAGES" value={fromAnnouncements}>
          {totalAudienceReached > 0
            ? `${totalAudienceReached} destinataire${totalAudienceReached > 1 ? 's' : ''} cumulé${totalAudienceReached > 1 ? 's' : ''}`
            : "Pièces jointes d'annonces"}
        </KpiCard>
      </div>

      <div className="mt-6">
        <DocumentsFilters
          portal="teacher"
          initialQuery={query}
          source={source}
          kind={kind}
          classId={classId ?? 'all'}
          classes={classOptions}
        />
      </div>

      <section className="mt-6">
        {pageRows.length === 0 ? (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60">
            <EmptyState
              icon={totalDocs === 0 ? FolderOpen : FileArchive}
              title={
                totalDocs === 0
                  ? 'Aucun document pour le moment'
                  : 'Aucun document avec ces filtres'
              }
              description={
                totalDocs === 0
                  ? 'Dès que vous joindrez un fichier à une entrée de cahier de texte ou à un message, il apparaîtra ici, prêt à être partagé avec les familles.'
                  : 'Essayez de réinitialiser le filtre type, classe ou la recherche pour afficher plus de résultats.'
              }
              tone="slate"
              action={
                totalDocs === 0
                  ? { label: 'Composer un message', href: '/teacher/messages/new' }
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <div key={group.key}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <CalendarDays className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    {formatDateLong(group.date)}
                  </span>
                  <span className="h-px flex-1 bg-slate-200" aria-hidden />
                  <span className="text-[10px] font-medium text-slate-400">
                    {group.rows.length} doc
                    {group.rows.length > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="space-y-3">
                  {group.rows.map((doc) => (
                    <DocumentRowCard key={doc.id} doc={doc} portal="teacher" />
                  ))}
                </div>
              </div>
            ))}
            <Pagination
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              itemLabel={{ singular: 'document', plural: 'documents' }}
            />
          </div>
        )}
      </section>

      <p className="mt-4 text-[11px] text-slate-500">
        {hasActiveFilter ? (
          <>
            {filtered.length} document{filtered.length > 1 ? 's' : ''} sur {totalDocs}{' '}
            après application des filtres. L&apos;upload direct d&apos;un fichier via une zone de dépôt arrivera avec le worker R7.
          </>
        ) : (
          <>
            Les pièces jointes ajoutées à vos entrées de cahier de texte et à vos messages sont automatiquement listées ici. L&apos;upload direct d&apos;un fichier via une zone de dépôt arrivera avec le worker R7.
          </>
        )}
      </p>
    </PortalShell>
  );
}
