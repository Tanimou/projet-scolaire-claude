'use client';

import { AlertCircle, Lock, SlidersHorizontal } from 'lucide-react';
import { useId, useMemo, useState, useTransition } from 'react';

import { FormDrawer, Input, Label } from '@pilotage/ui';

import { updateRuleConfigAction } from './actions';
import {
  POSITIVE_RULE_CODES,
  RULE_PARAM_FIELDS,
  SEVERITY_LABEL,
  SEVERITY_OPTIONS,
  SEVERITY_TONE,
  type AlertRule,
  type AlertSeverity,
  type RuleParamField,
} from './types';

// Dot color per severity tone — paired with the text label so color is never
// the only signal (WCAG 1.4.1).
const TONE_DOT: Record<'sky' | 'warning' | 'danger', string> = {
  sky: 'bg-sky-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

/** Read a numeric param from the rule's current JSONB, falling back to the
 *  field's min so the editor always opens on a valid, in-range value. */
function initialValue(rule: AlertRule, field: RuleParamField): string {
  const raw = rule.parameters[field.key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return String(field.min);
}

/** Validate one field's raw string against its descriptor bounds (mirrors the
 *  server clamp). Returns an error message or null. UX guard only. */
function validateField(raw: string, field: RuleParamField): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return 'Valeur requise';
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return 'Nombre invalide';
  if (field.integer && !Number.isInteger(n)) return 'Nombre entier requis';
  if (n < field.min || n > field.max) return `Entre ${field.min} et ${field.max}`;
  return null;
}

export function RuleConfigEditor({ rule }: { rule: AlertRule }) {
  const fields = RULE_PARAM_FIELDS[rule.code] ?? [];
  const isPositive = POSITIVE_RULE_CODES.includes(rule.code);

  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(rule.enabled);
  const [severity, setSeverity] = useState<AlertSeverity>(
    isPositive ? 'low' : rule.severity,
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, initialValue(rule, f)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const errorId = useId();

  // Re-sync local state from props whenever the drawer (re)opens, so a revalidate
  // that refreshed `rule` is reflected and a cancelled edit doesn't persist.
  function openEditor() {
    setEnabled(rule.enabled);
    setSeverity(isPositive ? 'low' : rule.severity);
    setValues(Object.fromEntries(fields.map((f) => [f.key, initialValue(rule, f)])));
    setError(null);
    setOpen(true);
  }

  // The shared Drawer primitive owns focus management: it moves focus into the
  // panel on open, traps Tab within the dialog, and restores focus to this
  // trigger on close (WCAG 2.4.3 / 2.1.2). No extra handling needed here.
  function closeEditor() {
    setOpen(false);
  }

  const fieldErrors = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const f of fields) out[f.key] = validateField(values[f.key] ?? '', f);
    return out;
  }, [fields, values]);

  const hasInvalid = Object.values(fieldErrors).some((e) => e !== null);

  function setFieldValue(key: string, raw: string) {
    setValues((prev) => ({ ...prev, [key]: raw }));
  }

  function submit() {
    if (pending || hasInvalid) return;
    setError(null);
    // Build the COMPLETE parameter object — PATCH replaces the JSONB wholesale
    // (no server deep-merge), so every canonical key must be present or sibling
    // keys are silently dropped.
    const parameters: Record<string, number> = {};
    for (const f of fields) parameters[f.key] = Number(values[f.key]);

    startTransition(async () => {
      const res = await updateRuleConfigAction(rule.code, {
        enabled,
        severity: isPositive ? 'low' : severity,
        parameters,
      });
      if (res.ok) {
        closeEditor();
      } else {
        setError(res.error ?? 'La sauvegarde a échoué. Réessayez.');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openEditor}
        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        <SlidersHorizontal className="h-4 w-4" aria-hidden />
        Configurer
        <span className="sr-only"> — {rule.label}</span>
      </button>

      <FormDrawer
        open={open}
        onClose={closeEditor}
        title={`Configurer · ${rule.label}`}
        description={rule.description}
        submitLabel="Enregistrer"
        onSubmit={submit}
        busy={pending}
        disabledSubmit={hasInvalid}
        size="md"
      >
        <div className="space-y-5">
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          {/* ── Enabled ── */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span id={`${errorId}-enabled-label`} className="text-sm font-semibold text-slate-900">
                Règle active
              </span>
              <p className="text-xs text-slate-500">Évaluée à chaque passage du moteur.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-labelledby={`${errorId}-enabled-label`}
              onClick={() => setEnabled((v) => !v)}
              disabled={pending}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed ${
                enabled ? 'bg-blue-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* ── Severity ── */}
          <div>
            <span className="text-sm font-semibold text-slate-900">Sévérité</span>
            {isPositive ? (
              <div className="mt-2 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-200">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Sévérité verrouillée — c&apos;est un signal positif.</span>
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-label="Sévérité de la règle"
                className="mt-2 grid grid-cols-3 gap-2"
              >
                {SEVERITY_OPTIONS.map((sev) => {
                  const active = severity === sev;
                  return (
                    <button
                      key={sev}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      tabIndex={active ? 0 : -1}
                      disabled={pending}
                      onClick={() => setSeverity(sev)}
                      onKeyDown={(e) => {
                        const n = SEVERITY_OPTIONS.length;
                        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                          e.preventDefault();
                          const i = SEVERITY_OPTIONS.indexOf(sev);
                          // `sev` always comes from SEVERITY_OPTIONS, so the
                          // modulo index is in-bounds; guard for the compiler
                          // (noUncheckedIndexedAccess).
                          const next = SEVERITY_OPTIONS[(i + 1) % n];
                          if (next) setSeverity(next);
                        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          const i = SEVERITY_OPTIONS.indexOf(sev);
                          const prev = SEVERITY_OPTIONS[(i - 1 + n) % n];
                          if (prev) setSeverity(prev);
                        }
                      }}
                      className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                        active
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[SEVERITY_TONE[sev]]}`}
                        aria-hidden
                      />
                      {SEVERITY_LABEL[sev]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Parameters ── */}
          {fields.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500 ring-1 ring-slate-200">
              Aucun paramètre numérique — seules l&apos;activation et la sévérité sont réglables.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((field) => {
                const fieldId = `${errorId}-${field.key}`;
                const fieldError = fieldErrors[field.key];
                return (
                  <div key={field.key} className="space-y-1">
                    <Label htmlFor={fieldId}>{field.label}</Label>
                    <div className="relative">
                      <Input
                        id={fieldId}
                        type="number"
                        inputMode={field.integer ? 'numeric' : 'decimal'}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        value={values[field.key] ?? ''}
                        disabled={pending}
                        invalid={!!fieldError}
                        aria-describedby={fieldError ? `${fieldId}-err` : `${fieldId}-hint`}
                        onChange={(e) => setFieldValue(field.key, e.target.value)}
                        className="pr-14"
                      />
                      <span
                        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-400"
                        aria-hidden
                      >
                        {field.unit}
                      </span>
                    </div>
                    {/* Reserve a consistent line height to avoid layout shift. */}
                    <div className="min-h-[1rem]" aria-live="polite">
                      {fieldError ? (
                        <p id={`${fieldId}-err`} className="text-xs text-rose-600">
                          {fieldError}
                        </p>
                      ) : (
                        <p id={`${fieldId}-hint`} className="text-xs text-slate-500">
                          {field.hint}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </FormDrawer>
    </>
  );
}
