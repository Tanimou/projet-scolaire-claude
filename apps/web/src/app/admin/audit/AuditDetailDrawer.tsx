'use client';

import { DetailDrawer, StatusBadge, formatDateLong } from '@pilotage/ui';
import { CircleDashed, Fingerprint, Globe2, ShieldCheck, User2 } from 'lucide-react';
import { useState } from 'react';


import { AuditProvenance } from './AuditProvenance';
import { VocabularyMarker } from './VocabularyMarker';
import {
  auditActionTone,
  auditVocabularyExplanation,
  classifyAuditAction,
  classifyAuditResourceType,
  humanizePortal,
  humanizeUserAgent,
} from './audit-labels';

export interface AuditEntry {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  portal: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  before: unknown;
  after: unknown;
}

interface AuditDetailDrawerProps {
  entry: AuditEntry | null;
  onClose: () => void;
}

/*
 * `pickActionTone` vivait aussi **ici** — une cinquième table de vocabulaire,
 * identique à celle de `AuditTable.tsx` et affectée du même défaut : elle
 * peignait `coefficient.upsert` et `grade.unflag` en `neutral` alors que la
 * carte « Modifications critiques » les compte. Elle est supprimée au profit de
 * `auditActionTone()` de `@pilotage/contracts` (PF-134).
 *
 * Le tiroir devait de toute façon suivre : deux teintes différentes pour la
 * même ligne selon qu'on la lit dans le tableau ou dans son détail aurait été
 * une incohérence **créée** par la correction.
 */

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AuditDetailDrawer({ entry, onClose }: AuditDetailDrawerProps) {
  const [copied, setCopied] = useState<'before' | 'after' | null>(null);

  async function copy(value: unknown, key: 'before' | 'after') {
    try {
      await navigator.clipboard.writeText(formatJson(value));
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      // clipboard unavailable; silently no-op
    }
  }

  if (!entry) return null;

  // Le tiroir est l'endroit de la précision : marqueur **par champ**, pas une
  // seule puce de ligne comme dans la table.
  const action = classifyAuditAction(entry.action);
  const resourceType = classifyAuditResourceType(entry.resourceType);
  const resourceExplanation =
    auditVocabularyExplanation(action.vocabulary) ??
    auditVocabularyExplanation(resourceType.vocabulary);

  return (
    <DetailDrawer
      open={!!entry}
      onClose={onClose}
      size="xl"
      title={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge
            label={action.label}
            tone={auditActionTone(entry.action)}
            size="sm"
            withDot
          />
          <VocabularyMarker vocabulary={action.vocabulary} />
          <span className="text-base font-semibold text-slate-900">{resourceType.label}</span>
        </div>
      }
      description={
        <span className="text-xs text-slate-500">
          {/* Le libellé court est une aide à la lecture posée **au-dessus** de
              la valeur réelle — il ne la remplace jamais. Le code machine reste
              donc lisible ici, sous le titre. */}
          <code className="font-mono text-[11px] text-slate-600">{entry.action}</code>
          {' · '}
          {formatDateLong(entry.createdAt)} · ID&nbsp;<code className="font-mono">{entry.id}</code>
        </span>
      }
    >
      <div className="space-y-5">
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoCard
            icon={User2}
            tone="blue"
            label="Utilisateur"
            value={entry.actorName ?? '—'}
            hint={entry.actorRole ?? undefined}
          />
          {/* L'adresse IP ne revient PAS ici en sous-libellé du portail : la
              rendre ainsi affirme « cet administrateur a agi depuis cet
              endroit », et elle disparaissait purement et simplement quand elle
              était nulle. Elle a désormais sa propre section, toujours rendue. */}
          <InfoCard
            icon={Globe2}
            tone="violet"
            label="Portail"
            value={humanizePortal(entry.portal)}
          />
        </section>

        <section className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/60">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" />
            Ressource
          </div>
          <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Type</div>
              <div className="flex flex-wrap items-center gap-1.5 font-medium text-slate-800">
                {resourceType.label}
                <VocabularyMarker vocabulary={resourceType.vocabulary} />
              </div>
              {/* Pas de second rendu du code brut ici : hors canonique,
                  `label === code` (verbatim) — la valeur réelle est déjà celle
                  qu'on lit. Le code de l'**action**, lui, est distinct de son
                  libellé : il est rendu sous le titre. */}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400">ID</div>
              <div className="break-all font-mono text-xs text-slate-700">
                {entry.resourceId ?? '—'}
              </div>
            </div>
          </div>
          {/* La phrase d'explication est écrite **une fois**, au bas de la
              section — pas répétée à côté de chaque puce. */}
          {resourceExplanation && (
            <p className="mt-3 text-[11px] leading-snug text-slate-600">{resourceExplanation}</p>
          )}
        </section>

        {entry.detail && (
          <section>
            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Détail
            </h4>
            <p className="rounded-xl bg-white p-3 text-sm text-slate-700 ring-1 ring-slate-200">
              {entry.detail}
            </p>
          </section>
        )}

        {/* Provenance — une seule section, **toujours** présente. L'ancien bloc
            « User Agent » disparaissait quand la valeur était nulle : c'était la
            case vide du tableau déplacée dans le tiroir. */}
        <section className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/60">
          <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <Fingerprint className="h-3.5 w-3.5" aria-hidden />
            Provenance
          </h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Adresse IP</div>
              {entry.ipAddress ? (
                <div className="break-all font-mono text-sm text-slate-700">{entry.ipAddress}</div>
              ) : (
                <AuditProvenance ip={null} ua={null} variant="block" />
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500">Navigateur</div>
              {entry.userAgent ? (
                <>
                  {humanizeUserAgent(entry.userAgent) && (
                    <div className="text-sm text-slate-700">
                      {humanizeUserAgent(entry.userAgent)}
                    </div>
                  )}
                  {/* Le libellé court est une aide à la lecture posée au-dessus
                      de la valeur réelle — il ne la remplace jamais. */}
                  <div className="break-all font-mono text-[11px] leading-snug text-slate-600">
                    {entry.userAgent}
                  </div>
                </>
              ) : (
                <AuditProvenance ip={null} ua={null} variant="block" />
              )}
            </div>
          </div>
          {!entry.ipAddress && !entry.userAgent && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-slate-500">
              <CircleDashed className="mt-px h-3 w-3 shrink-0" aria-hidden />
              <span>
                Cette entrée ne porte pas de provenance client. Une provenance absente est
                enregistrée telle quelle — jamais remplacée par l&apos;adresse d&apos;un relais.
              </span>
            </p>
          )}
        </section>

        <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <DiffPanel
            label="Avant"
            tone="rose"
            value={entry.before}
            copied={copied === 'before'}
            onCopy={() => copy(entry.before, 'before')}
          />
          <DiffPanel
            label="Après"
            tone="emerald"
            value={entry.after}
            copied={copied === 'after'}
            onCopy={() => copy(entry.after, 'after')}
          />
        </section>
      </div>
    </DetailDrawer>
  );
}

function InfoCard({
  icon: Icon,
  tone,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: 'blue' | 'violet';
  label: string;
  value: string;
  hint?: string;
}) {
  const toneClass =
    tone === 'blue'
      ? 'bg-blue-50 text-blue-700 ring-blue-200'
      : 'bg-violet-50 text-violet-700 ring-violet-200';
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ring-1 ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
        <div className="truncate text-sm font-semibold text-slate-800">{value}</div>
        {hint && <div className="truncate text-[11px] text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

function DiffPanel({
  label,
  tone,
  value,
  copied,
  onCopy,
}: {
  label: string;
  tone: 'rose' | 'emerald';
  value: unknown;
  copied: boolean;
  onCopy: () => void;
}) {
  const empty = value === null || value === undefined;
  const toneRing =
    tone === 'rose' ? 'ring-rose-200/70 bg-rose-50/30' : 'ring-emerald-200/70 bg-emerald-50/30';
  const toneTag =
    tone === 'rose' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700';
  return (
    <div className={`overflow-hidden rounded-xl ring-1 ${toneRing}`}>
      <div className="flex items-center justify-between bg-white/60 px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${toneTag}`}>
          {label}
        </span>
        {!empty && (
          <button
            type="button"
            onClick={onCopy}
            className="text-[11px] font-medium text-slate-500 transition hover:text-blue-700"
          >
            {copied ? 'Copié ✓' : 'Copier JSON'}
          </button>
        )}
      </div>
      <pre className="max-h-72 overflow-auto p-3 font-mono text-[11px] leading-snug text-slate-700">
        {empty ? <span className="text-slate-400">—</span> : formatJson(value)}
      </pre>
    </div>
  );
}
