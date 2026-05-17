import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface ColumnDef<T> {
  /** Stable key for the column */
  key: string;
  /** Column header label */
  header: ReactNode;
  /** Render the cell content for a given row */
  cell: (row: T) => ReactNode;
  /** Cell alignment */
  align?: 'left' | 'right' | 'center';
  /** Optional fixed width (e.g. 100 or '12rem') */
  width?: number | string;
  /** Hide on mobile (≤sm) */
  hideOnMobile?: boolean;
  /** Sticky left (useful for first column) */
  sticky?: boolean;
}

export interface DataTableProps<T extends { id: string }> {
  columns: ColumnDef<T>[];
  rows: T[];
  /** Empty state element (when rows is empty) */
  emptyState?: ReactNode;
  /** Optional pagination footer */
  pagination?: {
    page: number;
    total: number;
    pageSize: number;
    onPageChange: (page: number) => void;
  };
  /** Optional row click handler (or use cell renderer to add links) */
  onRowClick?: (row: T) => void;
  /** Optional summary footer row (rendered last) */
  footer?: ReactNode;
  className?: string;
}

const ALIGN: Record<NonNullable<ColumnDef<unknown>['align']>, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

/**
 * DataTable — minimal generic table wrapper.
 * For more advanced needs (server-sort, infinite, etc.), wrap this in a smarter manager.
 */
export function DataTable<T extends { id: string }>({
  columns,
  rows,
  emptyState,
  pagination,
  onRowClick,
  footer,
  className,
}: DataTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <div className={className}>{emptyState}</div>;
  }
  return (
    <div className={cn('overflow-hidden rounded-xl border border-slate-100', className)}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: c.width }}
                  className={cn(
                    'px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-500',
                    ALIGN[c.align ?? 'left'],
                    c.hideOnMobile && 'hidden sm:table-cell',
                    c.sticky && 'sticky left-0 bg-slate-50',
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'hover:bg-slate-50/60',
                  onRowClick && 'cursor-pointer',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-4 py-3 text-sm text-slate-700',
                      ALIGN[c.align ?? 'left'],
                      c.hideOnMobile && 'hidden sm:table-cell',
                      c.sticky && 'sticky left-0 bg-inherit',
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {pagination && pagination.total > pagination.pageSize && (
        <DataTablePagination {...pagination} />
      )}
    </div>
  );
}

function DataTablePagination({
  page,
  total,
  pageSize,
  onPageChange,
}: NonNullable<DataTableProps<{ id: string }>['pagination']>) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-2.5 text-xs text-slate-600"
    >
      <span>
        Affichage de <strong className="font-semibold">{start}</strong> à{' '}
        <strong className="font-semibold">{end}</strong> sur{' '}
        <strong className="font-semibold">{total}</strong>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Page précédente"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-2 font-mono tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          aria-label="Page suivante"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
