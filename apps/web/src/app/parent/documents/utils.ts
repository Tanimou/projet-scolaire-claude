import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Link as LinkIcon,
  Presentation,
  type LucideIcon,
} from 'lucide-react';

import type { DocumentKind, RawAttachment } from './types';

/**
 * Lowercased extension extracted from a URL or filename (without the leading dot).
 * Returns an empty string if no extension is detectable.
 */
function extOf(text: string | null | undefined): string {
  if (!text) return '';
  const s = text.split('?')[0]?.split('#')[0] ?? '';
  const dot = s.lastIndexOf('.');
  if (dot < 0 || dot === s.length - 1) return '';
  return s.slice(dot + 1).toLowerCase();
}

/**
 * Resolves a `DocumentKind` from either a MIME type, a URL, or a filename.
 * Order of precedence: MIME → extension → fallback 'file'.
 */
export function detectKind(opts: {
  mimeType?: string | null;
  url?: string | null;
  label?: string | null;
}): DocumentKind {
  const mt = (opts.mimeType ?? '').toLowerCase();
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/')) return 'audio';
  if (mt === 'application/pdf') return 'pdf';
  if (
    mt === 'application/msword' ||
    mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mt === 'application/vnd.oasis.opendocument.text' ||
    mt.startsWith('text/')
  ) {
    return 'doc';
  }
  if (
    mt === 'application/vnd.ms-excel' ||
    mt === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mt === 'application/vnd.oasis.opendocument.spreadsheet' ||
    mt === 'text/csv'
  ) {
    return 'sheet';
  }
  if (
    mt === 'application/vnd.ms-powerpoint' ||
    mt === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    mt === 'application/vnd.oasis.opendocument.presentation'
  ) {
    return 'slide';
  }
  if (
    mt === 'application/zip' ||
    mt === 'application/x-rar-compressed' ||
    mt === 'application/x-7z-compressed' ||
    mt === 'application/gzip'
  ) {
    return 'archive';
  }

  const ext = extOf(opts.url) || extOf(opts.label);
  if (!ext) {
    // No extension and no MIME — if it has http(s):// treat as a link.
    if (opts.url && /^https?:\/\//i.test(opts.url)) return 'link';
    return 'file';
  }
  if (['pdf'].includes(ext)) return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'heic'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'audio';
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'ods', 'csv', 'tsv'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp', 'key'].includes(ext)) return 'slide';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive';
  return 'file';
}

/**
 * Defensive parser for the `attachments` JSON column. Filters out malformed
 * rows (no url). Always returns an array, never throws.
 */
export function parseAttachments(raw: unknown): RawAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row): row is RawAttachment => {
    if (!row || typeof row !== 'object') return false;
    const r = row as Record<string, unknown>;
    return typeof r.url === 'string' && r.url.length > 0;
  });
}

/**
 * Best-effort display name: prefer explicit label/name, else the trailing
 * URL segment, else "Document".
 */
export function resolveLabel(att: RawAttachment): string {
  if (att.label && att.label.trim().length > 0) return att.label.trim();
  if (att.name && att.name.trim().length > 0) return att.name.trim();
  const url = att.url ?? '';
  try {
    const u = new URL(url, 'https://placeholder.local');
    const seg = u.pathname.split('/').filter(Boolean).pop();
    if (seg) return decodeURIComponent(seg);
  } catch {
    /* ignore */
  }
  return 'Document';
}

const KIND_LABEL: Record<DocumentKind, string> = {
  pdf: 'PDF',
  image: 'Image',
  video: 'Vidéo',
  audio: 'Audio',
  doc: 'Document',
  sheet: 'Tableur',
  slide: 'Présentation',
  archive: 'Archive',
  link: 'Lien web',
  file: 'Fichier',
};

const KIND_ICON: Record<DocumentKind, LucideIcon> = {
  pdf: FileText,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  doc: FileText,
  sheet: FileSpreadsheet,
  slide: Presentation,
  archive: FileArchive,
  link: LinkIcon,
  file: File,
};

const KIND_BADGE_CLASS: Record<DocumentKind, string> = {
  pdf: 'bg-rose-100 text-rose-800 ring-rose-200',
  image: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  video: 'bg-violet-100 text-violet-800 ring-violet-200',
  audio: 'bg-fuchsia-100 text-fuchsia-800 ring-fuchsia-200',
  doc: 'bg-blue-100 text-blue-800 ring-blue-200',
  sheet: 'bg-teal-100 text-teal-800 ring-teal-200',
  slide: 'bg-amber-100 text-amber-800 ring-amber-200',
  archive: 'bg-slate-200 text-slate-800 ring-slate-300',
  link: 'bg-sky-100 text-sky-800 ring-sky-200',
  file: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const KIND_ICON_TONE: Record<DocumentKind, string> = {
  pdf: 'bg-rose-50 text-rose-600 ring-rose-200',
  image: 'bg-emerald-50 text-emerald-600 ring-emerald-200',
  video: 'bg-violet-50 text-violet-600 ring-violet-200',
  audio: 'bg-fuchsia-50 text-fuchsia-600 ring-fuchsia-200',
  doc: 'bg-blue-50 text-blue-600 ring-blue-200',
  sheet: 'bg-teal-50 text-teal-600 ring-teal-200',
  slide: 'bg-amber-50 text-amber-700 ring-amber-200',
  archive: 'bg-slate-100 text-slate-600 ring-slate-300',
  link: 'bg-sky-50 text-sky-600 ring-sky-200',
  file: 'bg-slate-50 text-slate-600 ring-slate-200',
};

export function kindLabel(kind: DocumentKind): string {
  return KIND_LABEL[kind];
}

export function kindIcon(kind: DocumentKind): LucideIcon {
  return KIND_ICON[kind];
}

export function kindBadgeClass(kind: DocumentKind): string {
  return KIND_BADGE_CLASS[kind];
}

export function kindIconToneClass(kind: DocumentKind): string {
  return KIND_ICON_TONE[kind];
}

/**
 * Pretty-formatted byte size (1 decimal for MB+, no decimal for B/KB).
 * Returns null when size is unknown so the caller can skip rendering.
 */
export function formatBytes(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} o`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} Ko`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} Mo`;
  return `${(mb / 1024).toFixed(1)} Go`;
}
