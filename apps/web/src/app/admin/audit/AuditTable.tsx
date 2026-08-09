'use client';

import { StatusBadge, formatDateLong, formatRelativeTime } from '@pilotage/ui';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Database,
  Download,
  Eye,
  FilePlus2,
  FileText,
  GraduationCap,
  KeyRound,
  LifeBuoy,
  MessagesSquare,
  Pencil,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState, type ComponentType } from 'react';


import { AuditDetailDrawer, type AuditEntry } from './AuditDetailDrawer';
import { AuditProvenance } from './AuditProvenance';
import { VocabularyMarker } from './VocabularyMarker';
import {
  auditActionCountedBy,
  auditActionTone,
  classifyAuditAction,
  classifyAuditResourceType,
  describeNonCanonicalFields,
  humanizePortal,
  type AuditActionCountedBy,
} from './audit-labels';

interface AuditTableProps {
  rows: AuditEntry[];
}

const PORTAL_TONE: Record<string, string> = {
  admin: 'bg-violet-50 text-violet-700 ring-violet-200',
  teacher: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  parent: 'bg-amber-50 text-amber-700 ring-amber-200',
  // Le quatrième portail (G-PORTAL). Sans cette entrée, une ligne `student`
  // tombait sur le repli gris pendant que les trois autres avaient une couleur :
  // un rendu de seconde classe, silencieux. `sky` sur `sky-700` = 5.56:1 (AA ✓)
  // et se distingue du violet, de l'émeraude, de l'ambre et de l'ardoise.
  student: 'bg-sky-50 text-sky-700 ring-sky-200',
};

/**
 * Ce que la teinte d'une ligne annonce, en toutes lettres.
 *
 * La couleur seule ne peut pas porter cette information (SC 1.4.1) : la phrase
 * est écrite en `sr-only` à côté de la puce, et la même formulation sert de
 * légende sous le tableau. Elle est **dérivée** de `auditActionCountedBy`, donc
 * elle ne peut pas contredire le prédicat qui alimente la carte.
 */
const COUNTED_BY_SENTENCE: Record<Exclude<AuditActionCountedBy, null>, string> = {
  criticalChanges: 'Comptée par Modifications critiques',
  sensitiveExports: 'Comptée par Exports sensibles',
};

/**
 * Icône d'une action — **indexée sur les préfixes de codes déclarés**, plus des
 * replis par type de ressource (PF-134).
 *
 * L'ancienne version faisait `action.toLowerCase().includes('update')` sur la
 * valeur brute : `coefficient.upsert` ne contient pas `update`, `grade.unflag`
 * non plus, et `a.includes('login')` était mort depuis que la mesure a montré
 * qu'aucun site d'écriture n'émet d'action de connexion. Une sous-chaîne n'est
 * pas un vocabulaire.
 *
 * Une icône reste une **aide**, jamais une affirmation comptable — c'est la
 * teinte, elle, qui doit correspondre exactement à ce qu'une carte compte, et
 * elle vient de `@pilotage/contracts`. L'ordre des préfixes est porteur : le
 * plus spécifique d'abord.
 */
// `Map` et non `Record` : la clé est une valeur venue de la base. Un
// `Record[action]` sur `'constructor'` renverrait une fonction du prototype,
// qui rendrait en tant que composant. Une `Map` n'a pas ce chemin.
const ACTION_ICON_EXACT = new Map<string, ComponentType<{ className?: string }>>([
  // Les cinq alias hérités gelés : des libellés français dans une colonne
  // structurelle. Correspondance exacte, jamais par sous-chaîne.
  ['Création', FilePlus2],
  ['Mise à jour', Pencil],
  ['Validation', ShieldCheck],
  ['Suppression', Trash2],
  ['Export', Download],
  ['assessment.publish', ShieldCheck],
  ['user.invite', UserPlus],
]);

const ACTION_ICON_PREFIXES: Array<[string, ComponentType<{ className?: string }>]> = [
  ['academic_year.', KeyRound],
  ['alert.', Bell],
  ['analytics.', Database],
  ['calendar.', CalendarDays],
  ['coefficient.', SlidersHorizontal],
  ['conversation.', MessagesSquare],
  ['export.', Download],
  ['grade.', GraduationCap],
  ['guardianship.', UserPlus],
  ['import.', Upload],
  ['integration.', Database],
  ['meeting_request.', CalendarDays],
  ['remediation.', LifeBuoy],
  ['role.', Shield],
  ['student.', Users],
];

const RESOURCE_ICON = new Map<string, ComponentType<{ className?: string }>>([
  ['academic_year', KeyRound],
  ['assessment', GraduationCap],
  ['export_job', Download],
  ['grade', GraduationCap],
  ['import_batch', Database],
  ['import_row', Database],
  ['role', Shield],
  ['user_profile', Users],
]);

function pickActionIcon(
  action: string,
  resourceType: string,
): ComponentType<{ className?: string }> {
  const exact = ACTION_ICON_EXACT.get(action);
  if (exact) return exact;
  for (const [prefix, Icon] of ACTION_ICON_PREFIXES) {
    if (action.startsWith(prefix)) return Icon;
  }
  return RESOURCE_ICON.get(resourceType) ?? FileText;
}

export function AuditTable({ rows }: AuditTableProps) {
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <th scope="col" className="px-4 py-3">Date &amp; heure</th>
              <th scope="col" className="px-4 py-3">Utilisateur</th>
              <th scope="col" className="px-4 py-3">Action</th>
              <th scope="col" className="px-4 py-3">Ressource</th>
              <th scope="col" className="px-4 py-3">Détails</th>
              {/* « Portail · IP » promettait une valeur nulle sur 54 lignes sur
                  54 : c'est l'en-tête, pas la cellule, qui ment en premier. */}
              <th scope="col" className="px-4 py-3">Portail · provenance</th>
              <th scope="col" className="w-10 px-4 py-3">
                <span className="sr-only">Détail</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((a) => {
              const Icon = pickActionIcon(a.action, a.resourceType);
              const action = classifyAuditAction(a.action);
              const resourceType = classifyAuditResourceType(a.resourceType);
              const nonCanonical = describeNonCanonicalFields(a);
              const countedBy = auditActionCountedBy(a.action);
              // Repli ardoise conservé pour tout portail non reconnu (DNC-08).
              const portalCls = a.portal ? PORTAL_TONE[a.portal] ?? 'bg-slate-100 text-slate-600 ring-slate-200' : '';
              return (
                <tr
                  key={a.id}
                  onClick={() => setSelected(a)}
                  className="group cursor-pointer transition hover:bg-blue-50/30"
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
                      {/* La teinte vient de la **déclaration** partagée, pas
                          d'une correspondance de sous-chaîne : une puce rose est
                          exactement une ligne que « Modifications critiques »
                          compte, une puce bleue exactement une ligne que
                          « Exports sensibles » compte. Le tableau devient la
                          légende des cartes (PF-134). */}
                      <StatusBadge
                        label={action.label}
                        tone={auditActionTone(a.action)}
                        size="sm"
                        withDot
                      />
                      {countedBy && (
                        <span className="sr-only">{`, ${COUNTED_BY_SENTENCE[countedBy]}`}</span>
                      )}
                    </div>
                    {/* Le marqueur est posé **en bloc**, sous la puce d'action :
                        la table défile horizontalement, une puce en ligne
                        élargirait la rangée à 320 px sans rien apporter.
                        La phrase `sr-only` est écrite **une seule fois** par
                        ligne, ici, et nomme les champs concernés — calculée,
                        pour qu'elle ne puisse pas mentir sur une ligne mixte
                        (le marqueur du type de ressource, lui, reste muet pour
                        les lecteurs d'écran afin de ne pas annoncer deux fois
                        la même chose). */}
                    {action.vocabulary !== 'canonical' && (
                      <span className="mt-1 block">
                        <VocabularyMarker vocabulary={action.vocabulary} />
                      </span>
                    )}
                    {nonCanonical && (
                      <span className="sr-only">
                        {` Pour cette entrée, ${nonCanonical.fields} ${
                          nonCanonical.fieldCount > 1 ? 'sortent' : 'sort'
                        } du vocabulaire d’audit déclaré. ${nonCanonical.explanation}`}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-sm text-slate-700">
                    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {resourceType.label}
                    </span>
                    {resourceType.vocabulary !== 'canonical' && (
                      <span className="mt-1 block" aria-hidden>
                        <VocabularyMarker vocabulary={resourceType.vocabulary} />
                      </span>
                    )}
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
                    {/* Jamais de tiret cadratin ici : l'absence de provenance
                        est une propriété de la trace, elle s'énonce. */}
                    <AuditProvenance ip={a.ipAddress} ua={a.userAgent} variant="cell" />
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    {/* Le clic sur la ligne était **le seul** chemin vers le
                        tiroir : au clavier, le détail était inatteignable. Le
                        chemin clavier est un vrai `<button>` plutôt qu'un
                        `role="button"` posé sur le `<tr>` — ce dernier retire la
                        sémantique de rangée à un lecteur d'écran, et une table
                        d'audit se lit en rangées. Le clic sur la ligne reste un
                        raccourci à la souris. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(a);
                      }}
                      aria-label={`Voir le détail : ${action.label}, ${formatDateLong(a.createdAt)}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 transition group-hover:bg-blue-100 group-hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/40"
                    >
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    </button>
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

/**
 * La légende. Elle vit dans la bande déjà présente sous le tableau — pas de
 * nouveau chrome — et énonce la correspondance exacte entre une teinte et la
 * carte qui la compte, de sorte qu'un auditeur puisse vérifier un chiffre à
 * l'œil et pas seulement par un test.
 */
function ViewerHint() {
  return (
    <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-2 text-[11px] text-slate-600">
      <p className="inline-flex items-center gap-1">
        <Eye className="h-3 w-3" aria-hidden />
        Cliquez sur une ligne (ou activez la flèche au clavier) pour voir le détail complet
        (avant / après, provenance, user agent).
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-hidden />
          {COUNTED_BY_SENTENCE.criticalChanges}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-hidden />
          {COUNTED_BY_SENTENCE.sensitiveExports}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" aria-hidden />
          Journalisée, non comptée
        </span>
      </p>
    </div>
  );
}
