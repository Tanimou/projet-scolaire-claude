'use client';

import { Check, ChevronDown, Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';

// Import depuis le module **feuille**, jamais depuis `@/lib/api-client` : ce
// dernier importe `next/headers` et `@/auth`, et une valeur importée d'ici le
// tirerait dans le graphe navigateur — `next build` casse alors avec « You're
// importing a component that needs "next/headers" » (PF-133). Une ré-exportation
// depuis `api-client` ne corrigerait rien : c'est le spécificateur d'import qui
// décide du graphe. Ni `tsc` ni `eslint` ne voient cette arête ; seul le build.
import { isStatusOnlyMessage } from '@/lib/api-error-message';

import { assignRoleAction } from './actions';

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

/** Le refus en cours d'affichage. Un seul emplacement : une seule action peut être en vol. */
interface RoleError {
  userId: string;
  roleName: string;
  message: string;
}

/**
 * Tableau des utilisateurs de `/admin/users`, avec l'assignation de rôle.
 *
 * **PF-174 — ce composant rend désormais le refus qu'il avalait.** L'assignation
 * était un `try/finally` sans `catch` : sur un 403 le spinner s'arrêtait, le menu
 * se fermait, et rien n'indiquait pourquoi. `assignRoleAction` renvoie maintenant
 * un `ApiResult` et le refus s'affiche dans une bande `role="alert"` insérée sous
 * la ligne concernée, avec le message de l'API restitué tel quel.
 *
 * **Le message serveur n'est pas garanti français** — `users.service.ts` jette
 * encore `User not found`, `Cross-tenant assignment refused`, `Role not found` et
 * un `ForbiddenException()` nu (→ `Forbidden`) ; seul le refus du ceiling de
 * privilèges est en français. La bande porte donc **sa propre** phrase-cadre
 * française, vraie sur tous les chemins, et le détail serveur en ligne
 * secondaire : l'encart reste français même quand le détail ne l'est pas. Ce
 * composant ne re-formule jamais un code de statut en copie inventée.
 * (Franciser ces littéraux côté API est un suivi, hors de ce run.)
 *
 * **Ce que ce slice ne couvre pas** : `api()` n'a ni timeout ni `AbortController`.
 * Le silence corrigé ici est celui d'un *rejet*, pas celui d'une *absence de
 * réponse* — si l'API ne répond jamais, le spinner tourne indéfiniment et aucune
 * bande n'apparaît.
 */
export function UsersTable({ users, roles }: { users: UserItem[]; roles: RoleItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [error, setError] = useState<RoleError | null>(null);
  const [statusText, setStatusText] = useState('');

  const triggerRefs = useRef(new Map<string, HTMLButtonElement | null>());
  // Ligne dont le déclencheur doit reprendre le focus au retour de l'action.
  const lastActedRef = useRef<string | null>(null);
  // Jeton de requête : une réponse tardive ne doit jamais écraser une plus récente.
  const requestRef = useRef(0);

  // Cliquer un item du menu démonte l'élément focalisé (`setOpenMenu(null)`), donc
  // le focus retombait sur `<body>` — sur succès comme sur échec. On le rend au
  // déclencheur de la ligne dans un effet, une fois la bande d'alerte commitée,
  // pour que l'`aria-describedby` pointe sur un nœud qui existe déjà.
  useEffect(() => {
    if (busy !== null) return;
    const userId = lastActedRef.current;
    if (userId === null) return;
    lastActedRef.current = null;
    triggerRefs.current.get(userId)?.focus();
  }, [busy]);

  const fullName = (u: UserItem) => `${u.firstName} ${u.lastName}`.trim() || u.email;

  const assignRole = async (user: UserItem, role: RoleItem) => {
    const token = ++requestRef.current;
    lastActedRef.current = user.id;
    setOpenMenu(null);
    setBusy(user.id);
    setStatusText('Attribution du rôle en cours…');
    // On efface le refus de CETTE ligne avant la nouvelle tentative — pas celui
    // d'une autre ligne, qui n'a pas encore été lu. Cet effacement rend aussi le
    // second refus identique annonçable : la bande est démontée puis remontée,
    // donc `role="alert"` s'annonce à nouveau au lieu de rester silencieux sur un
    // texte inchangé.
    setError((prev) => (prev?.userId === user.id ? null : prev));
    try {
      const res = await assignRoleAction(user.id, role.id);
      // Une réponse dépassée par une action plus récente est jetée : afficher un
      // refus sur la mauvaise ligne serait pire que ne rien afficher.
      if (requestRef.current !== token) return;
      if (res.ok) {
        setStatusText(`Rôle « ${role.name} » assigné à ${fullName(user)}.`);
        // Le rafraîchissement n'a lieu QUE sur succès ; le badge ShieldCheck qui
        // réapparaît est la confirmation visible (pas de toast).
        router.refresh();
      } else {
        setStatusText('');
        setError({ userId: user.id, roleName: role.name, message: res.error });
      }
    } finally {
      // Conservé : le spinner doit s'éteindre sur tous les chemins, y compris un
      // jet qu'aucun extracteur ne verra.
      if (requestRef.current === token) setBusy(null);
    }
  };

  const dismissError = (userId: string) => {
    setError(null);
    triggerRefs.current.get(userId)?.focus();
  };

  const initials = (u: UserItem) =>
    `${u.firstName.charAt(0) ?? ''}${u.lastName.charAt(0) ?? ''}`.toUpperCase() || u.email.charAt(0).toUpperCase();

  return (
    // `page.tsx` enveloppe ce tableau dans un `overflow-hidden` : sans ce
    // conteneur défilable, la colonne Action — donc toute l'affordance que ce
    // slice rend lisible — est rognée et inatteignable en dessous de ~640 px.
    <div className="overflow-x-auto">
      <p role="status" aria-live="polite" className="sr-only">
        {statusText}
      </p>
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
          {users.map((u) => {
            const rowError = error?.userId === u.id ? error : null;
            const errorId = `users-role-error-${u.id}`;
            return (
              <Fragment key={u.id}>
                <tr className="hover:bg-slate-50">
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
                            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                            {r.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {u.authLinked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                        Authentifié
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        <X className="h-3 w-3" aria-hidden="true" />
                        Jamais connecté
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="relative inline-block">
                      <button
                        type="button"
                        ref={(node) => {
                          triggerRefs.current.set(u.id, node);
                        }}
                        onClick={() => setOpenMenu((m) => (m === u.id ? null : u.id))}
                        disabled={busy === u.id}
                        aria-busy={busy === u.id}
                        aria-expanded={openMenu === u.id}
                        aria-describedby={rowError ? errorId : undefined}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 disabled:opacity-60"
                      >
                        {busy === u.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        ) : (
                          'Assigner un rôle'
                        )}
                        <ChevronDown className="h-3 w-3" aria-hidden="true" />
                      </button>
                      {openMenu === u.id && (
                        <>
                          <div className="fixed inset-0 z-10" aria-hidden onClick={() => setOpenMenu(null)} />
                          <div className="absolute right-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                            {/*
                             * PF-174 / AC-4 — cette liste n'est délibérément PAS pré-filtrée.
                             * Tous les rôles sont proposés ; l'API est la seule autorité sur ce
                             * qui peut être accordé, et son refus est rendu tel quel sous la
                             * ligne. Quels rôles un `school_admin` peut accorder est la décision
                             * OUVERTE D-12 / PF-178 : filtrer ici encoderait une réponse qu'aucun
                             * humain n'a prise, dans du JSX où aucune ADR ne peut la relire.
                             * Ne pas « corriger » cela en masquant des options.
                             */}
                            {roles.map((r) => {
                              const already = u.roles.some((ur) => ur.slug === r.slug);
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  disabled={already}
                                  onClick={() => assignRole(u, r)}
                                  className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                                >
                                  <span>{r.name}</span>
                                  {already && (
                                    <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={3} aria-hidden="true" />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {rowError && (
                  <tr>
                    <td colSpan={4} className="px-6 pb-4 pt-0">
                      <div
                        id={errorId}
                        role="alert"
                        className="animate-slide-down sticky left-0 flex max-w-[calc(100vw-3rem)] items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:max-w-none"
                      >
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">Le rôle n’a pas pu être assigné.</p>
                          <p className="mt-0.5 text-xs text-red-800">
                            {fullName(u)} — rôle « {rowError.roleName} »
                          </p>
                          {/*
                           * Message serveur restitué tel quel — aucune reformulation cliente.
                           * Seule exception : le repli `HTTP <status>` d'`apiErrorMessage`, qui
                           * n'est pas une phrase ; on le préfixe alors d'un constat vrai
                           * exactement quand ce repli s'est déclenché.
                           */}
                          {isStatusOnlyMessage(rowError.message) ? (
                            <p className="mt-1 break-words">
                              Le serveur a refusé l’opération sans message détaillé.{' '}
                              <span className="font-mono text-[11px] text-red-700">{rowError.message}</span>
                            </p>
                          ) : (
                            <p className="mt-1 break-words">{rowError.message}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => dismissError(u.id)}
                          aria-label="Masquer ce message d’erreur"
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-red-700 transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 focus-visible:ring-offset-2"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {users.length === 0 && (
            <tr>
              <td colSpan={4} className="px-6 py-8 text-center text-sm text-slate-500">
                Aucun utilisateur — invitez ou laissez les acteurs se connecter pour les voir apparaître ici.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
