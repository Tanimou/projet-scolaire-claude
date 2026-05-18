import { Download, ExternalLink, FileText, Megaphone, NotebookPen } from 'lucide-react';
import Link from 'next/link';

import { formatDateShort } from '@pilotage/ui';

import type { DocumentRow } from './types';
import {
  formatBytes,
  kindBadgeClass,
  kindIcon,
  kindIconToneClass,
  kindLabel,
} from './utils';

/**
 * Single document card — renders one attachment row with file-type icon,
 * source badge, label, contextual line and a download/open button.
 */
export function DocumentRowCard({ doc }: { doc: DocumentRow }) {
  const Icon = kindIcon(doc.kind);
  const SourceIcon = doc.source === 'announcement' ? Megaphone : NotebookPen;
  const sourceLabel =
    doc.source === 'announcement' ? 'Annonce école' : 'Cahier de texte';
  const sourceHref =
    doc.source === 'announcement'
      ? `/parent/announcements?focusId=${doc.sourceId}`
      : `/parent/lessons`;

  const sizeLabel = formatBytes(doc.sizeBytes);
  const isExternal = doc.url ? /^https?:\/\//i.test(doc.url) : false;
  const isMissingUrl = !doc.url;

  return (
    <article className="group flex items-stretch gap-0 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/60 transition hover:shadow-md hover:ring-slate-300">
      <div
        className={`flex w-14 shrink-0 items-center justify-center ring-1 ring-inset sm:w-16 ${kindIconToneClass(doc.kind)}`}
        aria-hidden
      >
        <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${kindBadgeClass(doc.kind)}`}
          >
            {kindLabel(doc.kind)}
          </span>
          <Link
            href={sourceHref}
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-200"
            title={`Voir ${sourceLabel.toLowerCase()}`}
          >
            <SourceIcon className="h-3 w-3" />
            {sourceLabel}
          </Link>
          {sizeLabel && (
            <span className="text-[10px] font-medium text-slate-500">{sizeLabel}</span>
          )}
        </div>

        <h3
          className="truncate text-sm font-bold text-slate-900"
          title={doc.label}
        >
          {doc.label}
        </h3>

        <p className="truncate text-xs text-slate-600">
          <span className="font-medium text-slate-700">{doc.context.title}</span>
          {doc.context.subjectName && (
            <>
              <span className="mx-1 text-slate-400">·</span>
              <span
                className="font-medium"
                style={
                  doc.context.subjectColor
                    ? { color: doc.context.subjectColor }
                    : undefined
                }
              >
                {doc.context.subjectName}
              </span>
            </>
          )}
          {doc.context.className && (
            <>
              <span className="mx-1 text-slate-400">·</span>
              <span>{doc.context.className}</span>
            </>
          )}
          {doc.context.teacherName && (
            <>
              <span className="mx-1 text-slate-400">·</span>
              <span>{doc.context.teacherName}</span>
            </>
          )}
        </p>

        <p className="text-[11px] text-slate-500">{formatDateShort(doc.publishedAt)}</p>
      </div>

      <div className="flex shrink-0 items-center pr-3 sm:pr-4">
        {isMissingUrl ? (
          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-400 ring-1 ring-slate-200">
            <FileText className="h-3.5 w-3.5" />
            Indisponible
          </span>
        ) : (
          <a
            href={doc.url ?? '#'}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
            download={isExternal ? undefined : ''}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white shadow-sm ring-1 ring-blue-700/50 transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {isExternal ? (
              <>
                <ExternalLink className="h-3.5 w-3.5" />
                Ouvrir
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                Télécharger
              </>
            )}
          </a>
        )}
      </div>
    </article>
  );
}
