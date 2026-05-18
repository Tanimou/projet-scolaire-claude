import { CalendarDays, FileArchive, FolderOpen, Megaphone, NotebookPen, Sparkles } from 'lucide-react';
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

import { ChildSelector } from '../_components/ChildSelector';

export const metadata: Metadata = { title: 'Documents' };
export const dynamic = 'force-dynamic';

interface StudentSummary {
  id: string;
  firstName: string;
  lastName: string;
}

interface AnnouncementApiRow {
  id: string;
  title: string;
  publishedAt: string | null;
  classSection?: { id?: string; name: string } | null;
  attachments?: unknown;
}

interface LessonApiRow {
  id: string;
  date: string;
  title: string;
  attachments?: unknown;
  teachingAssignment: {
    subject: { id: string; name: string; color: string | null };
    classSection: { id: string; name: string };
  };
  teacherProfile?: {
    userProfile: { firstName: string; lastName: string };
  } | null;
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

/**
 * Flattens the `attachments` JSON of an announcement into N DocumentRow.
 */
function fromAnnouncement(a: AnnouncementApiRow): DocumentRow[] {
  const attachments = parseAttachments(a.attachments);
  if (attachments.length === 0) return [];
  const publishedAt = a.publishedAt ?? new Date().toISOString();
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
      sizeBytes: typeof att.sizeBytes === 'number'
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
        audienceCount: null,
        audienceLabel: null,
        isDraft: false,
      },
    };
  });
}

/**
 * Flattens the `attachments` JSON of a lesson into N DocumentRow.
 */
function fromLesson(l: LessonApiRow): DocumentRow[] {
  const attachments = parseAttachments(l.attachments);
  if (attachments.length === 0) return [];
  const teacher = l.teacherProfile?.userProfile;
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
      sizeBytes: typeof att.sizeBytes === 'number'
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
        teacherName: teacher ? `${teacher.firstName} ${teacher.lastName}`.trim() : null,
        audienceCount: null,
        audienceLabel: null,
        isDraft: false,
      },
    };
  });
}

export default async function ParentDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    studentId?: string;
    page?: string;
    q?: string;
    source?: string;
    kind?: string;
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

  // Step 1 — children selector
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
            { label: 'Documents' },
          ]}
          title="Documents"
          subtitle="Bulletins, ressources de classe, pièces jointes des annonces"
        />
        <EmptyState
          icon={FolderOpen}
          title="Aucun enfant rattaché"
          description="Les documents partagés par l'établissement et les enseignants apparaîtront ici dès qu'un enfant sera lié à votre compte."
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

  // Step 2 — fetch announcements (parent-scoped) + lessons (active child)
  const [announcementsResp, lessonsResp] = await Promise.all([
    safe(
      api<{ data: AnnouncementApiRow[] }>('/api/v1/announcements', {
        cache: 'no-store',
      }),
    ),
    safe(
      api<{ data: LessonApiRow[] }>(
        `/api/v1/lessons?studentId=${activeStudentId}&limit=200`,
        { cache: 'no-store' },
      ),
    ),
  ]);

  const announcements = announcementsResp?.data ?? [];
  const lessons = lessonsResp?.data ?? [];

  // Step 3 — aggregate attachments into a flat document list
  const documents: DocumentRow[] = [
    ...announcements.flatMap(fromAnnouncement),
    ...lessons.flatMap(fromLesson),
  ].sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  // Step 4 — KPIs (always reflect the full unfiltered set)
  const totalDocs = documents.length;
  const fromAnnouncements = documents.filter((d) => d.source === 'announcement').length;
  const fromLessons = documents.filter((d) => d.source === 'lesson').length;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = documents.filter(
    (d) => new Date(d.publishedAt).getTime() >= sevenDaysAgo,
  ).length;

  // Step 5 — apply filters (search + source + kind)
  const q = query.toLowerCase();
  const filtered = documents.filter((d) => {
    if (source !== 'all' && d.source !== source) return false;
    if (kind !== 'all' && d.kind !== kind) return false;
    if (q.length > 0) {
      const haystack = [
        d.label,
        d.context.title,
        d.context.subjectName,
        d.context.className,
        d.context.teacherName,
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

  // Step 6 — group page rows by ISO date
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
    query.length > 0 || source !== 'all' || kind !== 'all';

  return (
    <PortalShell portal="parent">
      <PageHeader
        breadcrumb={[
          { label: 'Tableau de bord', href: '/parent/dashboard' },
          { label: 'Documents' },
        ]}
        title="Documents"
        subtitle="Toutes les pièces jointes partagées par l'établissement et les enseignants au même endroit"
      />

      <div className="mt-4">
        <ChildSelector items={children} activeStudentId={activeStudentId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={FolderOpen} tone="blue" label="DOCUMENTS" value={totalDocs}>
          Toutes sources confondues
        </KpiCard>
        <KpiCard icon={Sparkles} tone="violet" label="NOUVEAUX" value={recent}>
          Sur les 7 derniers jours
        </KpiCard>
        <KpiCard icon={Megaphone} tone="amber" label="ANNONCES" value={fromAnnouncements}>
          Pièces jointes annonces
        </KpiCard>
        <KpiCard icon={NotebookPen} tone="green" label="CAHIER DE TEXTE" value={fromLessons}>
          Ressources de cours
        </KpiCard>
      </div>

      <div className="mt-6">
        <DocumentsFilters
          portal="parent"
          initialQuery={query}
          source={source}
          kind={kind}
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
                  ? "Les pièces jointes des annonces et les ressources partagées par les enseignants apparaîtront ici dès qu'elles seront publiées."
                  : 'Essayez de réinitialiser le filtre type ou la recherche pour afficher plus de résultats.'
              }
              tone="slate"
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
                    <DocumentRowCard key={doc.id} doc={doc} portal="parent" />
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
            après application des filtres. Les bulletins PDF et certificats de
            scolarité arriveront via le worker R7.
          </>
        ) : (
          <>
            Les bulletins PDF et certificats de scolarité arriveront via le
            worker R7 (génération asynchrone). En attendant, retrouvez ici toutes
            les pièces jointes publiées dans les annonces et le cahier de texte.
          </>
        )}
      </p>
    </PortalShell>
  );
}
