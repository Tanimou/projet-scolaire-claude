'use client';

import { Check, ChevronDown, Loader2, ShieldCheck, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { assignRoleAction, revokeRoleAction } from './actions';

interface UserItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  authLinked: boolean;
  roles: { slug: string; name: string }[];
}

interface RoleItem {
  id: string;
  slug: string;
  name: string;
}

export function UsersTable({ users, roles }: { users: UserItem[]; roles: RoleItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const assignRole = async (userId: string, roleId: string) => {
    setBusy(userId);
    setOpenMenu(null);
    try {
      await assignRoleAction(userId, roleId);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const initials = (u: UserItem) =>
    `${u.firstName.charAt(0) ?? ''}${u.lastName.charAt(0) ?? ''}`.toUpperCase() || u.email.charAt(0).toUpperCase();

  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
        <tr>
          <th className="px-6 py-3 text-left font-semibold">Utilisateur</th>
          <th className="px-6 py-3 text-left font-semibold">Rôles assignés</th>
          <th className="px-6 py-3 text-left font-semibold">Statut</th>
          <th className="px-6 py-3 text-right font-semibold">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {users.map((u) => (
          <tr key={u.id} className="hover:bg-slate-50">
            <td className="px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-blue-600 text-xs font-bold text-white">
                  {initials(u)}
                </span>
                <div>
                  <div className="font-semibold text-slate-900">
                    {u.firstName} {u.lastName || <span className="text-slate-400">—</span>}
                  </div>
                  <div className="text-xs text-slate-500">{u.email}</div>
                </div>
              </div>
            </td>
            <td className="px-6 py-4">
              {u.roles.length === 0 ? (
                <span className="text-xs text-slate-400">Aucun rôle personnalisé</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {u.roles.map((r) => (
                    <span
                      key={r.slug}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700"
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {r.name}
                    </span>
                  ))}
                </div>
              )}
            </td>
            <td className="px-6 py-4">
              {u.authLinked ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  <Check className="h-3 w-3" strokeWidth={3} />
                  Authentifié
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  <X className="h-3 w-3" />
                  Jamais connecté
                </span>
              )}
            </td>
            <td className="px-6 py-4 text-right">
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setOpenMenu((m) => (m === u.id ? null : u.id))}
                  disabled={busy === u.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {busy === u.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Assigner un rôle'}
                  <ChevronDown className="h-3 w-3" />
                </button>
                {openMenu === u.id && (
                  <>
                    <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpenMenu(null)} />
                    <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                      {roles.map((r) => {
                        const already = u.roles.some((ur) => ur.slug === r.slug);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            disabled={already}
                            onClick={() => assignRole(u.id, r.id)}
                            className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                          >
                            <span>{r.name}</span>
                            {already && <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={3} />}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </td>
          </tr>
        ))}
        {users.length === 0 && (
          <tr>
            <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-500">
              Aucun utilisateur — invitez ou laissez les acteurs se connecter pour les voir apparaître ici.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
