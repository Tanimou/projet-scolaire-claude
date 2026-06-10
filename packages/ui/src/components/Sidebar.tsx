import type { ComponentType, ReactNode } from 'react';

import { cn } from '../lib/cn';

export type SidebarVariant = 'rich' | 'compact';
export type PortalKey = 'admin' | 'teacher' | 'parent' | 'student' | 'super-admin';

export interface SidebarItemDef {
  key: string;
  label: string;
  /** Lucide icon component (server-safe) */
  icon: ComponentType<{ className?: string }>;
  href: string;
  /** Optional unread/notification badge */
  badge?: number;
  /** Mark active state externally (we render the attribute) */
  active?: boolean;
  /** Disabled item (shown but not interactive) */
  disabled?: boolean;
}

export interface SidebarGroup {
  /** Optional section label rendered uppercase above the items */
  label?: string;
  items: SidebarItemDef[];
}

export interface SidebarProps {
  portal: PortalKey;
  variant?: SidebarVariant;
  brand?: ReactNode;
  /** Either flat `items` (legacy) or grouped `groups` (new). `groups` wins if both supplied. */
  items?: SidebarItemDef[];
  groups?: SidebarGroup[];
  /** Sticky footer (e.g. TipOfTheDayCard or HelpSidebarCard) */
  footer?: ReactNode;
  className?: string;
}

/**
 * Sidebar — dark navy persistent sidebar with optional grouped sections.
 * Background colors use inline CSS-variable references so the dark-navy paint
 * never depends on Tailwind scan scope.
 */
export function Sidebar({
  portal,
  variant = 'rich',
  brand,
  items,
  groups,
  footer,
  className,
}: SidebarProps) {
  const isCompact = variant === 'compact';
  // Normalize: if `groups` not provided, wrap `items` in a single unlabeled group
  const effectiveGroups: SidebarGroup[] =
    groups && groups.length > 0 ? groups : [{ items: items ?? [] }];

  return (
    <aside
      data-portal={portal}
      data-variant={variant}
      style={{
        background: 'var(--surface-sidebar, oklch(0.17 0.05 260))',
        color: 'var(--ink-on-sidebar, oklch(0.96 0.01 250))',
      }}
      className={cn(
        'flex h-screen shrink-0 flex-col',
        isCompact ? 'w-[72px]' : 'w-[240px]',
        className,
      )}
    >
      {/* Brand zone — subtle accent tint at the top of the rail */}
      <div
        style={{
          background:
            'linear-gradient(to bottom, color-mix(in oklch, var(--accent-500) 16%, var(--surface-sidebar)), var(--surface-sidebar))',
        }}
        className={cn(
          'flex shrink-0 items-center gap-2 border-b border-white/5 px-5 py-5',
          isCompact && 'justify-center px-0',
        )}
      >
        {brand}
      </div>

      {/* Grouped items list */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {effectiveGroups.map((g, gi) => (
          <div key={gi} className={cn(gi > 0 && 'mt-5')}>
            {!isCompact && g.label && (
              <div
                style={{ color: 'var(--ink-on-sidebar-faint, oklch(0.55 0.03 250))' }}
                className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.12em]"
              >
                {g.label}
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((item) => (
                <li key={item.key}>
                  <SidebarItem item={item} compact={isCompact} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer slot (Tip/Help) */}
      {footer && (
        <div className={cn('shrink-0 border-t border-white/5 p-3', isCompact && 'p-2')}>
          {footer}
        </div>
      )}
    </aside>
  );
}

export interface SidebarItemProps {
  item: SidebarItemDef;
  compact?: boolean;
}

export function SidebarItem({ item, compact }: SidebarItemProps) {
  const { icon: Icon, href, label, active, disabled, badge } = item;
  const Tag: 'a' | 'span' = disabled ? 'span' : 'a';
  // Tooltip: prioritize "Bientôt" hint for disabled, fall back to label in compact mode
  const titleAttr = disabled
    ? `${label} — Bientôt disponible`
    : compact
      ? label
      : undefined;
  return (
    <Tag
      {...(disabled ? {} : { href })}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      data-active={active ? 'true' : 'false'}
      style={
        active
          ? {
              background: 'var(--accent-500, oklch(0.40 0.16 260))',
              color: 'white',
              boxShadow: '0 6px 16px -6px color-mix(in oklch, var(--accent-500) 55%, transparent)',
            }
          : disabled
            ? { color: 'var(--ink-on-sidebar-faint, oklch(0.55 0.03 250))' }
            : { color: 'var(--ink-on-sidebar-muted, oklch(0.70 0.02 250))' }
      }
      className={cn(
        'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
        compact && 'justify-center px-0',
        disabled && 'cursor-not-allowed opacity-60',
        !active && !disabled && 'hover:translate-x-0.5 hover:bg-white/10 hover:text-white',
      )}
      title={titleAttr}
    >
      {active && !compact && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-white/90"
        />
      )}
      <Icon
        className={cn(
          'h-5 w-5 shrink-0 transition-transform',
          active && 'text-white',
          !active && !disabled && 'group-hover:scale-110',
        )}
        aria-hidden="true"
      />
      {!compact && <span className="flex-1 truncate">{label}</span>}
      {!compact && disabled && (
        <span
          aria-hidden="true"
          className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/60"
        >
          Bientôt
        </span>
      )}
      {!compact && !disabled && typeof badge === 'number' && badge > 0 && (
        <span
          aria-label={`${badge} notification${badge > 1 ? 's' : ''}`}
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold tabular-nums text-white"
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      {compact && !disabled && typeof badge === 'number' && badge > 0 && (
        <span
          aria-label={`${badge} notification${badge > 1 ? 's' : ''}`}
          className="absolute right-2 top-2 inline-flex h-2 w-2 rounded-full bg-rose-500"
        />
      )}
      {compact && disabled && (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 inline-flex h-1.5 w-1.5 rounded-full bg-white/30"
        />
      )}
    </Tag>
  );
}
