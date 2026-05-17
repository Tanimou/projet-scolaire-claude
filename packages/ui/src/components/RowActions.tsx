import { Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';
import { IconButton, type IconButtonTone } from './IconButton';

export interface RowAction {
  id: string;
  icon: ReactNode;
  label: string; // for aria-label / tooltip
  tone?: IconButtonTone;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export interface RowActionsProps {
  /** Custom action list — overrides the default view/edit/delete preset */
  actions?: RowAction[];
  /** Convenience presets — if provided, used as default actions */
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  viewHref?: string;
  editHref?: string;
  className?: string;
}

/**
 * RowActions — pre-composed cluster of 1-3 IconButtons for table rows.
 * If `actions` is given, that list wins. Otherwise the preset slots
 * (`onView/onEdit/onDelete`) produce the common admin row pattern shown in the
 * image (view=blue eye, edit=cyan pencil, delete=rose trash).
 */
export function RowActions({
  actions,
  onView,
  onEdit,
  onDelete,
  viewHref,
  editHref,
  className,
}: RowActionsProps) {
  const built: RowAction[] = actions ?? [
    ...(onView || viewHref
      ? [
          {
            id: 'view',
            icon: <Eye className="h-4 w-4" />,
            label: 'Voir',
            tone: 'blue' as const,
            href: viewHref,
            onClick: onView,
          },
        ]
      : []),
    ...(onEdit || editHref
      ? [
          {
            id: 'edit',
            icon: <Pencil className="h-3.5 w-3.5" />,
            label: 'Modifier',
            tone: 'cyan' as const,
            href: editHref,
            onClick: onEdit,
          },
        ]
      : []),
    ...(onDelete
      ? [
          {
            id: 'delete',
            icon: <Trash2 className="h-3.5 w-3.5" />,
            label: 'Supprimer',
            tone: 'rose' as const,
            onClick: onDelete,
          },
        ]
      : []),
  ];

  if (built.length === 0) {
    return (
      <IconButton
        aria-label="Plus d'actions"
        icon={<MoreHorizontal className="h-4 w-4" />}
        tone="neutral"
        size="sm"
        className={className}
      />
    );
  }

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      {built.map((a) =>
        a.href ? (
          <a key={a.id} href={a.href} aria-label={a.label} title={a.label}>
            <IconButton
              icon={a.icon}
              tone={a.tone ?? 'neutral'}
              size="sm"
              aria-label={a.label}
              disabled={a.disabled}
              tabIndex={-1}
            />
          </a>
        ) : (
          <IconButton
            key={a.id}
            icon={a.icon}
            tone={a.tone ?? 'neutral'}
            size="sm"
            aria-label={a.label}
            title={a.label}
            disabled={a.disabled}
            onClick={a.onClick}
          />
        ),
      )}
    </div>
  );
}
