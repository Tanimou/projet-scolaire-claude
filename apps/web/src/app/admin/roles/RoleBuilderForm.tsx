'use client';

import { Check, Loader2, Save, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { createRoleAction, updateRoleAction } from './actions';

interface PermCatalog {
  [resourceType: string]: { code: string; label: string; action: string }[];
}

const RESOURCE_LABEL: Record<string, string> = {
  school: 'Écoles',
  academic_year: 'Années scolaires',
  term: 'Périodes',
  cycle: 'Cycles',
  grade_level: 'Niveaux',
  class: 'Classes',
  subject: 'Matières',
  teacher: 'Professeurs',
  student: 'Élèves',
  parent: 'Parents',
  user: 'Utilisateurs',
  enrollment: 'Inscriptions',
  guardianship: 'Rattachements',
  teaching_assignment: 'Affectations enseignement',
  assessment: 'Évaluations',
  grade: 'Notes',
  attendance: 'Présences',
  lesson: 'Cahier de texte',
  discipline: 'Discipline',
  announcement: 'Annonces',
  branding: 'Branding',
  school_settings: 'Paramètres école',
  alert_rule: "Règles d'alerte",
  custom_field: 'Custom fields',
  custom_form: 'Custom forms',
  notification_template: 'Templates notifications',
  report_template: 'Templates rapports',
  role: 'Rôles',
  audit: 'Audit',
  import: 'Imports',
  export: 'Exports',
  integration: 'Intégrations',
  profile: 'Profil',
};

const PORTAL_OPTIONS: { value: 'admin' | 'teacher' | 'parent'; label: string; help: string }[] = [
  { value: 'admin', label: 'Admin', help: "Le rôle apparaît dans l'espace administrateur." },
  { value: 'teacher', label: 'Professeur', help: "Le rôle s'applique aux profs et apparaît côté enseignant." },
  { value: 'parent', label: 'Famille', help: 'Le rôle s’applique aux parents / tuteurs.' },
];

export interface RoleBuilderInitial {
  name: string;
  slug: string;
  description: string;
  portal: 'admin' | 'teacher' | 'parent';
  permissions: string[];
}

export function RoleBuilderForm({
  mode,
  roleId,
  initial,
  permissionGroups,
}: {
  mode: 'create' | 'edit';
  roleId?: string;
  initial?: RoleBuilderInitial;
  permissionGroups: PermCatalog;
}) {
  const router = useRouter();
  const [form, setForm] = useState<RoleBuilderInitial>(
    initial ?? { name: '', slug: '', description: '', portal: 'admin', permissions: [] },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const selected = useMemo(() => new Set(form.permissions), [form.permissions]);
  const toggle = (code: string) =>
    setForm((f) => ({
      ...f,
      permissions: selected.has(code) ? f.permissions.filter((c) => c !== code) : [...f.permissions, code],
    }));

  const toggleGroup = (codes: string[]) => {
    const allSelected = codes.every((c) => selected.has(c));
    setForm((f) => ({
      ...f,
      permissions: allSelected
        ? f.permissions.filter((c) => !codes.includes(c))
        : [...new Set([...f.permissions, ...codes])],
    }));
  };

  const onSlugChange = (raw: string) => {
    // Force slug to be a-z 0-9 _
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').slice(0, 40);
    setForm((f) => ({ ...f, slug: cleaned }));
  };

  const filteredGroups = Object.entries(permissionGroups).filter(([type, codes]) => {
    if (!filter) return true;
    const lower = filter.toLowerCase();
    return (
      type.includes(lower) ||
      RESOURCE_LABEL[type]?.toLowerCase().includes(lower) ||
      codes.some((c) => c.code.includes(lower) || c.label.toLowerCase().includes(lower))
    );
  });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (form.name.length < 2) return setError('Le nom doit faire au moins 2 caractères.');
    if (form.slug.length < 2) return setError('Le slug doit faire au moins 2 caractères.');
    if (form.permissions.length === 0) return setError('Sélectionnez au moins une permission.');

    setSaving(true);
    const res =
      mode === 'create'
        ? await createRoleAction({
            name: form.name,
            slug: form.slug,
            description: form.description || undefined,
            portal: form.portal,
            permissionCodes: form.permissions,
          })
        : await updateRoleAction(roleId!, {
            name: form.name,
            description: form.description,
            permissionCodes: form.permissions,
          });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push('/admin/roles');
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3">
      {/* LEFT — meta */}
      <div className="space-y-6 lg:col-span-1">
        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Identification</h3>
          <div className="mt-4 space-y-4">
            <Field
              label="Nom"
              id="name"
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="Comptable"
              required
            />
            <Field
              label="Slug technique"
              id="slug"
              value={form.slug}
              onChange={onSlugChange}
              placeholder="comptable"
              help="a-z, 0-9 et underscore. Utilisé dans les audits et URLs."
              required
              disabled={mode === 'edit'}
            />
            <div>
              <label htmlFor="description" className="text-sm font-semibold text-slate-900">
                Description
              </label>
              <textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                placeholder="À quoi sert ce rôle ?"
                suppressHydrationWarning
                className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              />
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Portail principal</h3>
          <div className="mt-4 space-y-2">
            {PORTAL_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                  form.portal === opt.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                } ${mode === 'edit' ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name="portal"
                  value={opt.value}
                  checked={form.portal === opt.value}
                  onChange={() => setForm((f) => ({ ...f, portal: opt.value }))}
                  disabled={mode === 'edit'}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-900">{opt.label}</div>
                  <div className="text-xs text-slate-500">{opt.help}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Récapitulatif</h3>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Permissions sélectionnées</span>
              <span className="font-mono font-bold text-slate-900">{form.permissions.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Catégories couvertes</span>
              <span className="font-mono font-bold text-slate-900">
                {new Set(form.permissions.map((p) => p.split('.')[0])).size}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-6 text-sm font-bold text-white shadow-lg shadow-blue-500/30 transition hover:shadow-xl disabled:opacity-70"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Enregistrement…' : mode === 'create' ? 'Créer le rôle' : 'Mettre à jour'}
          </button>
        </div>
      </div>

      {/* RIGHT — permissions matrix */}
      <div className="lg:col-span-2">
        <div className="rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Permissions</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Cochez les actions que ce rôle peut effectuer.
              </p>
            </div>
            <div className="relative">
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrer (ex. « notes »)"
                suppressHydrationWarning
                className="h-9 w-56 rounded-lg border border-slate-200 bg-white px-3 text-sm focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
              />
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {filteredGroups.map(([type, codes]) => {
              const allSelected = codes.every((c) => selected.has(c.code));
              const someSelected = codes.some((c) => selected.has(c.code));
              return (
                <fieldset
                  key={type}
                  className={`rounded-xl border p-4 ${
                    someSelected ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-white'
                  }`}
                >
                  <legend className="flex items-center gap-2 px-2">
                    <ShieldCheck
                      className={`h-4 w-4 ${someSelected ? 'text-blue-700' : 'text-slate-400'}`}
                    />
                    <span className="text-sm font-bold text-slate-900">
                      {RESOURCE_LABEL[type] ?? type}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleGroup(codes.map((c) => c.code))}
                      className="ml-2 text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:underline"
                    >
                      {allSelected ? 'Tout décocher' : 'Tout sélectionner'}
                    </button>
                  </legend>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {codes.map((c) => {
                      const checked = selected.has(c.code);
                      return (
                        <label
                          key={c.code}
                          className={`flex cursor-pointer items-start gap-2 rounded-lg p-2 text-sm transition ${
                            checked ? 'bg-blue-100 text-blue-900' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div
                            className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border-2 ${
                              checked ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'
                            }`}
                          >
                            {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                          </div>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(c.code)}
                            className="sr-only"
                            aria-label={c.label}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-xs leading-tight">{c.code}</div>
                            <div className="text-xs text-slate-500">{c.label}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
            {filteredGroups.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Aucune permission ne correspond à « {filter} ».
              </div>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  help,
  required,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  help?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-slate-900">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        suppressHydrationWarning
        className="mt-1.5 block h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
      />
      {help && <p className="mt-1.5 text-xs text-slate-500">{help}</p>}
    </div>
  );
}
