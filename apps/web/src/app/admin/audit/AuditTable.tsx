'use client';

import {
  ChevronRight,
  CircleSlash,
  Database,
  Download,
  Eye,
  FilePlus2,
  FileText,
  GraduationCap,
  KeyRound,
  LogIn,
  Pencil,
  Shield,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState, type ComponentType } from 'react';

import { StatusBadge, formatDateLong, formatRelativeTime } from '@pilotage/ui';

import { AuditDetailDrawer, type AuditEntry } from './AuditDetailDrawer';
import { humanizePortal, humanizeResourceType } from './AuditPageFilters';

interface AuditTableProps {
  rows: AuditEntry[];
}

const PORTAL_TONE: Record<string, string> = {
  admin: 'bg-violet-50 text-violet-700 ring-violet-200',
  teacher: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  parent: 'bg-amber-50 text-amber-700 ring-amber-200',
};

function pickActionTone(action: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  const a = action.toLowerCase();
  if (a.includes('création') || a.includes('publish') || a.includes('approve') || a.includes('create'))
    return 'success';
  if (a.includes('suppression') || a.includes('delete') || a.includes('reject')) return 'danger';
  if (a.includes('révision') || a.includes('update') || a.includes('mise à jour')) return 'warning';
  if (a.includes('export')) return 'info';
  return 'neutral';
}

function pickActionIcon(action: string, resourceType: string): ComponentType<{ className?: string }> {
  const a = action.toLowerCase();
  if (a.includes('login')) return LogIn;
  if (a.includes('export')) return Download;
  if (a.includes('import')) return Upload;
  if (a.includes('publish')) return ShieldCheck;
  if (a.includes('delete') || a.includes('suppression')) return Trash2;
  if (a.includes('create') || a.includes('création')) {
    if (resourceType === 'user_profile') return UserPlus;
    return FilePlus2;
  }
  if (a.includes('update') || a.includes('mise à jour') || a.includes('révision')) return Pencil;
  if (a.includes('reject')) return CircleSlash;
  if (resourceType === 'role') return Shield;
  if (resourceType === 'user_profile') return Users;
  if (resourceType === 'assessment' || resourceType === 'grade') return GraduationCap;
  if (resourceType === 'import_batch') return Database;
  if (resourceType.includes('academic_year')) return KeyRound;
  return FileText;
}

export function AuditTable({ rows }: AuditTableProps) {
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th className="px-4 py-3">Date & heure</th>
              <th className="px-4 py-3">Utilisateur</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Ressource</th>
              <th className="px-4 py-3">Détails</th>
              <th className="px-4 py-3">Portail · IP</th>
              <th className="w-10 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((a) => {
              const Icon = pickActionIcon(a.action, a.resourceType);
              const portalCls = a.portal ? PORTAL_TONE[a.portal] ?? 'bg-slate-100 text-slate-600 ring-slate-200' : '';
              return (
                <tr
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className="cursor-pointer transition hover:bg-blue-50/30"
                >
                  <td className="px-4 py-3 align-top text-xs">
                    <div className="font-medium text-slate-700">{formatDateLong(a.createdAt)}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {formatRelativeTime(a.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-sm">
                    <div className="font-bold text-slate-900">
                      {a.actorName ?? a.actorRole ?? '—'}
                    </div>
                    {a.actorRole && a.actorName && (
                      <div className="mt-0.5 text-[11px] text-slate-500">{a.actorRole}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <StatusBadge
                        label={a.action}
                        tone={pickActionTone(a.action)}
                        size="sm"
                        withDot
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 align-top text-sm text-slate-700">
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {humanizeResourceType(a.resourceType)}
                    </span>
                    {a.resourceId && (
                      <div className="mt-1 truncate font-mono text-[10px] text-slate-400" title={a.resourceId}>
                        {a.resourceId.slice(0, 8)}…
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-xs text-slate-500">
                    <div className="line-clamp-2 max-w-sm">{a.detail ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 align-top text-xs">
                    {a.portal && (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${portalCls}`}
                      >
                        {humanizePortal(a.portal)}
                      </span>
                    )}
                    {a.ipAddress && (
                      <div className="mt-1 font-mono text-[11px] text-slate-400">{a.ipAddress}</div>
                    )}
                    {!a.portal && !a.ipAddress && <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition group-hover:bg-blue-100 group-hover:text-blue-600">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AuditDetailDrawer entry={selected} onClose={() => setSelected(null)} />
      {selected && (
        <div className="sr-only" aria-live="polite">
          Détail de l&apos;entrée d&apos;audit ouvert
        </div>
      )}
      <ViewerHint />
    </>
  );
}

function ViewerHint() {
  return (
    <p className="border-t border-slate-100 bg-slate-50/40 px-4 py-2 text-[11px] text-slate-500">
      <span className="inline-flex items-center gap-1">
        <Eye className="h-3 w-3" />
        Cliquez sur une ligne pour voir le détail complet (avant / après, IP, user agent).
      </span>
    </p>
  );
}
