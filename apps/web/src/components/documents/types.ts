/**
 * Shape of an attachment stored in `Announcement.attachments` or
 * `LessonEntry.attachments` (JSON array). Each row is defensively parsed
 * because legacy seeds may carry partial fields.
 */
export interface RawAttachment {
  id?: string;
  url?: string;
  label?: string;
  name?: string;
  mimeType?: string;
  contentType?: string;
  type?: string;
  sizeBytes?: number;
  size?: number;
}

export type DocumentKind =
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'doc'
  | 'sheet'
  | 'slide'
  | 'archive'
  | 'link'
  | 'file';

export type DocumentSource = 'announcement' | 'lesson';

/**
 * A flattened document row ready to render in a documents hub.
 * Aggregates attachments from announcements + lesson entries across portals.
 */
export interface DocumentRow {
  /** Stable id for React keys (sourceId + index). */
  id: string;
  /** Where the file comes from. */
  source: DocumentSource;
  /** Parent entity id (announcement.id / lesson.id) — used for links. */
  sourceId: string;
  /** Human-readable file name displayed in the row. */
  label: string;
  /** Resolved download URL (may be null if attachment is malformed). */
  url: string | null;
  /** Normalized file kind for icon + filter. */
  kind: DocumentKind;
  /** Optional file size in bytes. */
  sizeBytes: number | null;
  /** Optional MIME type for tooltip. */
  mimeType: string | null;
  /** Publication date (announcement.publishedAt / lesson.date). */
  publishedAt: string;
  /** Context info for the card subtitle. */
  context: {
    /** Top-level title (announcement title / lesson title). */
    title: string;
    /** Subject name (lessons only). */
    subjectName: string | null;
    /** Subject color hex (lessons only). */
    subjectColor: string | null;
    /** Class section id (used by teacher deep links). */
    classSectionId: string | null;
    /** Class section name (lessons + class-targeted announcements). */
    className: string | null;
    /** Teacher full name (lessons only — null when "self" view). */
    teacherName: string | null;
    /** Audience reach (teacher view only — number of recipients). */
    audienceCount: number | null;
    /** Human-readable audience label for teacher view (e.g. "Classe 6A", "Cycle 3"). */
    audienceLabel: string | null;
    /** Whether the underlying entry is still a draft (teacher view). */
    isDraft: boolean;
  };
}

export type SourceFilter = 'all' | DocumentSource;
export type KindFilter = 'all' | DocumentKind;
