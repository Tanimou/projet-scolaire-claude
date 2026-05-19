/**
 * @pilotage/ui — Component library entry point.
 * Re-exports all components and helpers used by the web app.
 */

// Utilities
export { cn } from './lib/cn';
export {
  formatGrade,
  formatGradeOnTwenty,
  formatInt,
  formatPercent,
  formatDelta,
  deltaTone,
  formatDateShort,
  formatDateLong,
  formatDateCard,
  formatRelativeTime,
  formatInDays,
} from './lib/format';
export {
  gradeBucket,
  gradeVerdict,
  type GradeBucket,
  type GradeBucketInfo,
} from './lib/grade-bucket';
export { subjectColor, SUBJECT_CODES, type SubjectColor, type SubjectCode } from './lib/subject-color';
export {
  ACCENT_TOKEN_MAP,
  DISPLAY_PREFS_DEFAULTS,
  formatPreferredDate,
  formatPreferredGrade,
  type AccentTokens,
  type DisplayAccent,
  type DisplayDateFormat,
  type DisplayDensity,
  type DisplayGradeFormat,
  type DisplayPreferences,
  type FormatPreferredGradeOptions,
} from './lib/display-prefs';

// Primitives (kept)
export { Button, buttonVariants, type ButtonProps } from './components/Button';
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './components/Card';
export { Input, type InputProps } from './components/Input';
export { Label } from './components/Label';
export { Badge, badgeVariants, type BadgeProps } from './components/Badge';

// Layout
export { AppShell, type AppShellProps } from './components/AppShell';
export {
  Sidebar,
  SidebarItem,
  type SidebarProps,
  type SidebarItemDef,
  type SidebarItemProps,
  type SidebarGroup,
  type SidebarVariant,
  type PortalKey,
} from './components/Sidebar';
export { Topbar, type TopbarProps } from './components/Topbar';
export { Breadcrumb, type BreadcrumbProps, type BreadcrumbItem } from './components/Breadcrumb';
export { PageHeader, type PageHeaderProps } from './components/PageHeader';

// Atoms
export { Avatar, AvatarGroup, type AvatarProps, type AvatarGroupProps, type AvatarSize, type AvatarTone } from './components/Avatar';
export {
  StatusBadge,
  defaultLabelForStatus,
  defaultToneForStatus,
  type StatusBadgeProps,
  type StatusTone,
} from './components/StatusBadge';
export { DateCard, type DateCardProps, type DateCardTone } from './components/DateCard';
export { Tabs, TabsList, TabsTrigger, TabsContent, type TabsProps } from './components/Tabs';
export { SectionHeader, type SectionHeaderProps } from './components/SectionHeader';
export { AvatarNameCell, type AvatarNameCellProps } from './components/AvatarNameCell';
export { StarRating, type StarRatingProps } from './components/StarRating';
export { SubjectChip, type SubjectChipProps } from './components/SubjectChip';
export { CapacityBar, type CapacityBarProps } from './components/CapacityBar';
export { IconButton, type IconButtonProps, type IconButtonTone, type IconButtonSize } from './components/IconButton';
export { RowActions, type RowActionsProps, type RowAction } from './components/RowActions';

// Filter primitives
export { SearchInput, type SearchInputProps } from './components/SearchInput';
export { SelectFilter, type SelectFilterProps, type SelectOption } from './components/SelectFilter';
export { FilterBar, type FilterBarProps } from './components/FilterBar';

// Pagination (standalone) + table-embedded variant already in DataTable
export { Pagination, type PaginationProps } from './components/Pagination';

// Dialogs & drawers
export { ConfirmDialog, type ConfirmDialogProps } from './components/ConfirmDialog';
export { Drawer, type DrawerProps, type DrawerSize } from './components/Drawer';
export { FormDrawer, type FormDrawerProps } from './components/FormDrawer';
export { DetailDrawer, type DetailDrawerProps } from './components/DetailDrawer';

// Charts
export { Sparkline, type SparklineProps, type SparklinePoint } from './components/Sparkline';
export { ProgressBar, type ProgressBarProps, type ProgressTone } from './components/ProgressBar';
export { DonutChart, type DonutChartProps, type DonutSegment } from './components/DonutChart';
export { LineChart, type LineChartProps, type LineSeries } from './components/LineChart';
export { BarChart, type BarChartProps, type BarSeries } from './components/BarChart';
export { GroupedBarChart, type GroupedBarChartProps } from './components/GroupedBarChart';

// KPI / numeric
export { KpiCard, type KpiCardProps, type KpiTone } from './components/KpiCard';
export { SubjectKpiCard, type SubjectKpiCardProps } from './components/SubjectKpiCard';
export { Stats2x2Grid, type Stats2x2GridProps, type StatsCell, type StatsTone } from './components/Stats2x2Grid';

// Complex cards
export { AlertCard, type AlertCardProps, type AlertPolarity } from './components/AlertCard';
export { RecommendationCard, type RecommendationCardProps } from './components/RecommendationCard';
export { CommentsFeed, type CommentsFeedProps, type CommentItem } from './components/CommentsFeed';
export { SubjectPerfCard, trendOfDelta, type SubjectPerfCardProps, type SubjectMetric } from './components/SubjectPerfCard';
export { ChildProfileHero, type ChildProfileHeroProps, type HeroMeta } from './components/ChildProfileHero';

// Specialty
export { Timeline, type TimelineProps, type TimelineEntry } from './components/Timeline';
export { ActivityTimeline, type ActivityTimelineProps, type ActivityEntry } from './components/ActivityTimeline';
export { EmptyState, type EmptyStateProps } from './components/EmptyState';
export { Skeleton, LoadingCard, LoadingTable } from './components/LoadingState';
export { ErrorState, type ErrorStateProps } from './components/ErrorState';
export {
  MiniCalendar,
  type MiniCalendarProps,
  type CalendarEventDot,
  type LegendItem,
} from './components/MiniCalendar';
export { QuickActionsList, type QuickActionsListProps, type QuickAction } from './components/QuickActionsList';

// Gradebook + table
export { GradePill, type GradePillProps } from './components/GradePill';
export {
  EditableGradeTable,
  type EditableGradeTableProps,
  type AssessmentColumn,
  type StudentRow,
  type GradeCell,
  type GradeChange,
} from './components/EditableGradeTable';
export {
  DataTable,
  type DataTableProps,
  type ColumnDef,
} from './components/DataTable';

// Topbar widgets
export { YearSelector, type YearSelectorProps, type YearOption } from './components/YearSelector';
export {
  NotificationBell,
  type NotificationBellProps,
  type NotificationItem,
} from './components/NotificationBell';
export { UserMenu, type UserMenuProps, type UserMenuItem } from './components/UserMenu';

// Sidebar footer cards
export { TipOfTheDayCard, type TipOfTheDayCardProps } from './components/TipOfTheDayCard';
export { HelpSidebarCard, type HelpSidebarCardProps } from './components/HelpSidebarCard';

// Display preferences (densité · accent · format date/note)
export {
  DisplayPrefsProvider,
  useDisplayAccent,
  useDisplayDateFormat,
  useDisplayDensity,
  useDisplayGradeFormat,
  useDisplayPrefs,
  type DisplayPrefsProviderProps,
} from './components/DisplayPrefsProvider';
export { PreferredDate, type PreferredDateProps } from './components/PreferredDate';
export { PreferredGrade, type PreferredGradeProps } from './components/PreferredGrade';
export { TopbarTodayChip } from './components/TopbarTodayChip';
