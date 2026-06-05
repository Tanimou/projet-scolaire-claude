import {
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  CalendarClock,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Compass,
  FileSpreadsheet,
  FolderOpen,
  GraduationCap,
  Headphones,
  HeartHandshake,
  History,
  Languages,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  PenTool,
  School,
  Send,
  Settings,
  ShieldCheck,
  Trophy,
  Upload,
  User,
  UserCog,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react';
import type { SidebarGroup, SidebarItemDef } from '@pilotage/ui';

export type PortalKey = 'admin' | 'teacher' | 'parent';

/** Internal item config used at module level — adds `matches` regex helper. */
export interface SidebarItemConfig extends Omit<SidebarItemDef, 'active'> {
  /** Path-match pattern (defaults to `href`). Lets parent items stay active on subpaths. */
  matches?: RegExp;
}

/** A sidebar group keyed by uppercase section label. */
export interface SidebarGroupConfig {
  /** Section label (rendered uppercase 10px tracking-wider). Omit for an unlabeled group. */
  label?: string;
  items: SidebarItemConfig[];
}

// =============================================================================
// Active-state resolution
// =============================================================================

/** Resolve which item should appear active given the current pathname. */
function isItemActive(it: SidebarItemConfig, pathname: string): boolean {
  if (it.matches) return it.matches.test(pathname);
  return pathname === it.href || pathname.startsWith(it.href + '/');
}

/** Convert grouped config to runtime `SidebarGroup[]` with computed `active` flags. */
export function resolveGroupsActive(
  groups: SidebarGroupConfig[],
  pathname: string,
): SidebarGroup[] {
  return groups.map((g) => ({
    label: g.label,
    items: g.items.map((it) => ({ ...it, active: isItemActive(it, pathname) })),
  }));
}

/** Flat helper (legacy) — preserved for callers that still pass a single flat list. */
export function resolveActive(items: SidebarItemConfig[], pathname: string): SidebarItemDef[] {
  return items.map((it) => ({ ...it, active: isItemActive(it, pathname) }));
}

// =============================================================================
// Admin sidebar — 7 groups, EN-aligned routes per spec §5
// =============================================================================

export const adminSidebarGroups: SidebarGroupConfig[] = [
  {
    label: 'Main',
    items: [
      { key: 'dashboard', icon: LayoutDashboard, label: 'Tableau de bord', href: '/admin/dashboard' },
    ],
  },
  {
    label: 'Gestion scolaire',
    items: [
      { key: 'establishment', icon: School, label: 'Établissement', href: '/admin/establishment' },
      { key: 'academic-years', icon: Calendar, label: 'Années académiques', href: '/admin/academic-years' },
      { key: 'levels', icon: Layers, label: 'Cycles & niveaux', href: '/admin/levels' },
      { key: 'classes', icon: Users, label: 'Classes', href: '/admin/classes' },
      { key: 'subjects', icon: BookOpen, label: 'Matières', href: '/admin/subjects' },
    ],
  },
  {
    label: 'Personnes',
    items: [
      { key: 'students', icon: User, label: 'Élèves', href: '/admin/students' },
      { key: 'teachers', icon: GraduationCap, label: 'Enseignants', href: '/admin/teachers' },
      { key: 'guardians', icon: HeartHandshake, label: 'Parents / Tuteurs', href: '/admin/guardians' },
      { key: 'users', icon: UserCog, label: 'Utilisateurs', href: '/admin/users' },
    ],
  },
  {
    label: 'Pédagogie',
    items: [
      { key: 'assessments', icon: PenTool, label: 'Notes & Évaluations', href: '/admin/assessments' },
      { key: 'attendance', icon: CheckSquare, label: 'Présences', href: '/admin/attendance' },
      { key: 'enrollments', icon: UserPlus, label: 'Inscriptions', href: '/admin/enrollments' },
      { key: 'assignments', icon: ClipboardCheck, label: 'Affectations', href: '/admin/assignments' },
      { key: 'alerts', icon: Bell, label: 'Alertes', href: '/admin/alerts' },
      { key: 'meeting-requests', icon: MessageSquarePlus, label: 'Demandes de RDV', href: '/admin/meeting-requests' },
    ],
  },
  {
    label: 'Communication',
    items: [
      { key: 'communications', icon: Megaphone, label: 'Annonces', href: '/admin/communications' },
      { key: 'notifications', icon: Bell, label: 'Notifications', href: '/admin/notifications' },
      {
        key: 'conversation-moderation',
        icon: ShieldCheck,
        label: 'Modération messagerie',
        href: '/admin/conversations',
        // E2-S4 read-only moderation oversight of reported parent↔teacher threads.
        matches: /^\/admin\/conversations(\/|$)/,
      },
    ],
  },
  {
    label: 'Documents & suivi',
    items: [
      { key: 'imports', icon: Upload, label: 'Imports', href: '/admin/imports' },
      { key: 'exports', icon: FileSpreadsheet, label: 'Exports', href: '/admin/exports' },
      { key: 'reports', icon: BarChart3, label: 'Rapports', href: '/admin/reports' },
      { key: 'audit', icon: History, label: 'Audit', href: '/admin/audit' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { key: 'roles', icon: ShieldCheck, label: 'Rôles', href: '/admin/roles' },
      { key: 'settings', icon: Settings, label: 'Paramètres', href: '/admin/settings' },
    ],
  },
];

/** Flat admin items (legacy mirror — kept for back-compat with callers expecting a list). */
export const adminSidebarItems: SidebarItemConfig[] = adminSidebarGroups.flatMap((g) => g.items);

// =============================================================================
// Teacher + Parent sidebars (still flat for now — Phase 4/5 portals refactor later)
// =============================================================================

// Teacher portal — refonte P3 a livré 4 pages fonctionnelles (classes /
// students / grades / assessments) + 5 stubs élégants (calendar, documents,
// messages, reports, settings) avec EmptyState explicite. Toutes navigables.
export const teacherSidebarItems: SidebarItemConfig[] = [
  { key: 'dashboard', icon: LayoutDashboard, label: 'Tableau de bord', href: '/teacher/dashboard' },
  { key: 'classes', icon: Users, label: 'Mes classes', href: '/teacher/classes' },
  { key: 'students', icon: User, label: 'Élèves', href: '/teacher/students' },
  { key: 'meeting-requests', icon: MessageSquarePlus, label: 'Demandes de RDV', href: '/teacher/meeting-requests' },
  { key: 'grades', icon: PenTool, label: 'Notes', href: '/teacher/grades' },
  { key: 'assessments', icon: ClipboardCheck, label: 'Évaluations', href: '/teacher/assessments' },
  { key: 'calendar', icon: Calendar, label: 'Emploi du temps', href: '/teacher/calendar' },
  { key: 'documents', icon: FolderOpen, label: 'Ressources', href: '/teacher/documents' },
  { key: 'messages', icon: MessageSquare, label: 'Messagerie', href: '/teacher/messages' },
  {
    key: 'conversations',
    icon: MessagesSquare,
    label: 'Conversations parents',
    href: '/teacher/conversations',
    // Distinct from the teacher→family Announcements surface (/teacher/messages):
    // the parent-initiated conversation inbox (E2-S3). Stay active on the thread
    // view subroutes.
    matches: /^\/teacher\/conversations(\/|$)/,
  },
  { key: 'reports', icon: BarChart3, label: 'Rapports', href: '/teacher/reports' },
  { key: 'notifications', icon: Bell, label: 'Notifications', href: '/teacher/notifications' },
  { key: 'settings', icon: Settings, label: 'Paramètres', href: '/teacher/settings' },
];

// Parent portal — refonte P4 a livré 6 pages fonctionnelles (children,
// subjects, upcoming, attendance, comments, recommendations) + 3 stubs
// (calendar, documents, communication) + settings (notifications +
// profil + famille + sécurité). Toutes navigables. Les sous-pages
// utilisent `<ChildSelector />` pour basculer entre les enfants rattachés.
export const parentSidebarItems: SidebarItemConfig[] = [
  { key: 'dashboard', icon: LayoutDashboard, label: 'Tableau de bord', href: '/parent/dashboard' },
  { key: 'children', icon: User, label: "Profil de l'élève", href: '/parent/children' },
  { key: 'grades', icon: PenTool, label: 'Notes et évaluations', href: '/parent/grades' },
  { key: 'subjects', icon: Compass, label: 'Suivi des matières', href: '/parent/subjects' },
  { key: 'upcoming', icon: CalendarClock, label: 'Évaluations à venir', href: '/parent/upcoming' },
  { key: 'attendance', icon: UserX, label: 'Absences et retards', href: '/parent/attendance' },
  { key: 'lessons', icon: BookOpen, label: 'Cahier de texte', href: '/parent/lessons' },
  { key: 'comments', icon: MessageCircle, label: 'Commentaires', href: '/parent/comments' },
  { key: 'recommendations', icon: Lightbulb, label: 'Recommandations', href: '/parent/recommendations' },
  { key: 'announcements', icon: Megaphone, label: 'Annonces', href: '/parent/announcements' },
  {
    key: 'messages',
    icon: MessageSquare,
    label: 'Messages',
    href: '/parent/messages',
    // Keep the item active on the thread view + compose subroutes (S2).
    matches: /^\/parent\/messages(\/|$)/,
  },
  { key: 'notifications', icon: Bell, label: 'Notifications', href: '/parent/notifications' },
  { key: 'calendar', icon: Calendar, label: 'Emploi du temps', href: '/parent/calendar' },
  { key: 'documents', icon: FolderOpen, label: 'Documents', href: '/parent/documents' },
  { key: 'communication', icon: Send, label: 'Communication', href: '/parent/communication' },
  { key: 'settings', icon: Settings, label: 'Paramètres', href: '/parent/settings' },
];

// =============================================================================
// Resolver entry points used by AppShellRoot
// =============================================================================

/** Returns admin grouped sidebar (with active states resolved). */
export function adminSidebar(pathname: string): SidebarGroup[] {
  return resolveGroupsActive(adminSidebarGroups, pathname);
}

/** Flat helper kept for teacher/parent which still use flat sidebars. */
export function sidebarItemsFor(
  portal: PortalKey,
): SidebarItemConfig[] {
  switch (portal) {
    case 'admin':
      return adminSidebarItems;
    case 'teacher':
      return teacherSidebarItems;
    case 'parent':
      return parentSidebarItems;
  }
}

// =============================================================================
// Re-export icons for per-page item overrides
// =============================================================================
export {
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  CalendarClock,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  Compass,
  FileSpreadsheet,
  FolderOpen,
  GraduationCap,
  Headphones,
  HeartHandshake,
  History,
  Languages,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessageSquarePlus,
  MessagesSquare,
  PenTool,
  School,
  Send,
  Settings,
  ShieldCheck,
  Trophy,
  Upload,
  User,
  UserCog,
  UserPlus,
  UserX,
  Users,
};
