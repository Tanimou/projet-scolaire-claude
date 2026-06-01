'use client';

import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  Edit2,
  GraduationCap,
  HeartHandshake,
  IdCard,
  Loader2,
  LogOut,
  Plus,
  Save,
  ShieldCheck,
  Star,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { Avatar, PreferredDate, formatPreferredDate, useDisplayDateFormat } from '@pilotage/ui';
import { useState } from 'react';

import {
  attachGuardian,
  endEnrollment,
  enrollStudent,
  revokeGuardianship,
  transferEnrollment,
  updateStudent,
} from '../actions';

import { StudentAcademicTab, type StudentAcademicSnapshot } from './StudentAcademicTab';
import type { SimpleClass, SimpleGuardian, StudentDetail } from './page';

type Tab = 'identity' | 'enrollments' | 'guardians' | 'academic';

const RELATIONSHIP_LABEL: Record<string, string> = {
  mother: 'Mère',
  father: 'Père',
  legal_guardian: 'Tuteur légal',
  grandparent: 'Grand-parent',
  sibling: 'Frère/Sœur',
  other: 'Autre',
};

export function StudentDetailTabs({
  student,
  classes,
  guardians,
  academic,
}: {
  student: StudentDetail;
  classes: SimpleClass[];
  guardians: SimpleGuardian[];
  academic: StudentAcademicSnapshot | null;
}) {
  const [tab, setTab] = useState<Tab>('identity');

  const academicCount =
    academic && academic.subjectPerf.length > 0 ? academic.subjectPerf.length : undefined;

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200">
        <TabButton active={tab === 'identity'} onClick={() => setTab('identity')} icon={<IdCard className="h-4 w-4" />}>
          Identité
        </TabButton>
        <TabButton
          active={tab === 'academic'}
          onClick={() => setTab('academic')}
          icon={<GraduationCap className="h-4 w-4" />}
          count={academicCount}
        >
          Académique
        </TabButton>
        <TabButton
          active={tab === 'enrollments'}
          onClick={() => setTab('enrollments')}
          icon={<BookOpen className="h-4 w-4" />}
          count={student.enrollments.length}
        >
          Inscriptions
        </TabButton>
        <TabButton
          active={tab === 'guardians'}
          onClick={() => setTab('guardians')}
          icon={<HeartHandshake className="h-4 w-4" />}
          count={student.guardianships.filter((g) => g.status === 'active').length}
        >
          Parents
        </TabButton>
      </div>

      <div className="mt-6">
        {tab === 'identity' && <IdentityTab student={student} />}
        {tab === 'academic' && (
          <StudentAcademicTab academic={academic} firstName={student.firstName} />
        )}
        {tab === 'enrollments' && <EnrollmentsTab student={student} classes={classes} />}
        {tab === 'guardians' && <GuardiansTab student={student} guardians={guardians} />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-bold transition ${
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
      }`}
    >
      {icon}
      {children}
      {count !== undefined && (
        <span
          className={`rounded-full px-1.5 text-[10px] tabular-nums font-bold ${
            active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** Extrait la rue d'une adresse structurée pour l'affichage condensé. */
function formatAddress(address: Record<string, unknown> | null): string {
  if (!address) return '—';
  const parts: string[] = [];
  if (typeof address.street === 'string' && address.street) parts.push(address.street);
  if (typeof address.city === 'string' && address.city) {
    const zipCity = [address.postalCode, address.city].filter(Boolean).join(' ');
    parts.push(zipCity);
  }
  if (typeof address.country === 'string' && address.country) parts.push(address.country);
  return parts.length > 0 ? parts.join(', ') : '—';
}

function IdentityTab({ student }: { student: StudentDetail }) {
  const dateFmt = useDisplayDateFormat();
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(student.firstName);
  const [lastName, setLastName] = useState(student.lastName);
  const [birthDate, setBirthDate] = useState(student.birthDate?.slice(0, 10) ?? '');
  const [email, setEmail] = useState(student.email ?? '');
  const [phone, setPhone] = useState(student.phone ?? '');
  const [externalRef, setExternalRef] = useState(student.externalRef ?? '');
  const [gender, setGender] = useState(student.gender ?? '');
  const [nationality, setNationality] = useState(student.nationality ?? '');
  const [photoUrl, setPhotoUrl] = useState(student.photoUrl ?? '');
  // Adresse structurée : rue, ville, code postal, pays
  const [addrStreet, setAddrStreet] = useState(
    typeof student.address?.street === 'string' ? student.address.street : '',
  );
  const [addrCity, setAddrCity] = useState(
    typeof student.address?.city === 'string' ? student.address.city : '',
  );
  const [addrPostalCode, setAddrPostalCode] = useState(
    typeof student.address?.postalCode === 'string' ? student.address.postalCode : '',
  );
  const [addrCountry, setAddrCountry] = useState(
    typeof student.address?.country === 'string' ? student.address.country : '',
  );
  const [medicalNotes, setMedicalNotes] = useState(student.medicalNotes ?? '');
  const [notes, setNotes] = useState(student.notes ?? '');
  const [status, setStatus] = useState(student.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildAddress = (): Record<string, string> | null => {
    const addr: Record<string, string> = {};
    if (addrStreet.trim()) addr.street = addrStreet.trim();
    if (addrCity.trim()) addr.city = addrCity.trim();
    if (addrPostalCode.trim()) addr.postalCode = addrPostalCode.trim();
    if (addrCountry.trim()) addr.country = addrCountry.trim();
    return Object.keys(addr).length > 0 ? addr : null;
  };

  const onSave = async () => {
    setBusy(true);
    setError(null);
    const res = await updateStudent(student.id, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      birthDate: birthDate || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      externalRef: externalRef.trim() || null,
      gender: gender || null,
      nationality: nationality || null,
      photoUrl: photoUrl.trim() || null,
      address: buildAddress(),
      medicalNotes: medicalNotes.trim() || null,
      notes: notes.trim() || null,
      status,
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else setEditing(false);
  };

  if (!editing) {
    return (
      <section className="rounded-2xl bg-white ring-1 ring-slate-200 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Informations personnelles</h3>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            <Edit2 className="h-3.5 w-3.5" /> Modifier
          </button>
        </div>

        {/* Photo de profil + identité */}
        <div className="mt-4 flex items-start gap-4">
          <Avatar
            src={student.photoUrl}
            firstName={student.firstName}
            lastName={student.lastName}
            size="lg"
            className="shrink-0 rounded-xl"
          />
          <dl className="flex-1 grid gap-4 sm:grid-cols-2">
            <Row label="Prénom" value={student.firstName} />
            <Row label="Nom" value={student.lastName} />
            <Row
              label="Date de naissance"
              value={student.birthDate ? formatPreferredDate(student.birthDate, dateFmt) : '—'}
            />
            <Row label="Sexe" value={student.gender ?? '—'} />
            <Row label="Matricule" value={student.externalRef ?? '—'} mono />
            <Row label="Nationalité" value={student.nationality ?? '—'} mono />
            <Row label="Email" value={student.email ?? '—'} />
            <Row label="Téléphone" value={student.phone ?? '—'} />
            <Row label="Statut" value={student.status} />
            <Row label="Adresse" value={formatAddress(student.address)} />
          </dl>
        </div>

        {(student.medicalNotes || student.notes) && (
          <div className="mt-6 space-y-3">
            {student.medicalNotes && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-rose-700">
                  <AlertTriangle className="h-3.5 w-3.5" /> Notes médicales
                </div>
                <p className="mt-1 text-sm text-rose-900 whitespace-pre-line">{student.medicalNotes}</p>
              </div>
            )}
            {student.notes && (
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes</div>
                <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{student.notes}</p>
              </div>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white ring-1 ring-slate-200 p-6 space-y-4">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>}

      {/* Prévisualisation de la photo en mode édition */}
      <div className="flex items-center gap-4">
        <Avatar
          src={photoUrl || null}
          firstName={firstName}
          lastName={lastName}
          size="lg"
          className="shrink-0 rounded-xl"
        />
        <Field label="URL de la photo de profil">
          <input
            type="url"
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="https://example.com/photo.jpg"
            className={inputCls}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Prénom">
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Nom">
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Date de naissance">
          <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Sexe">
          <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputCls}>
            <option value="">—</option>
            <option value="F">Féminin</option>
            <option value="M">Masculin</option>
            <option value="X">Autre</option>
          </select>
        </Field>
        <Field label="Matricule">
          <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} className={`${inputCls} font-mono`} />
        </Field>
        <Field label="Nationalité (ISO 2)">
          <input
            value={nationality}
            maxLength={2}
            onChange={(e) => setNationality(e.target.value.toUpperCase())}
            className={`${inputCls} font-mono`}
          />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Téléphone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Statut">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputCls}>
            <option value="active">Actif</option>
            <option value="transferred">Transféré</option>
            <option value="graduated">Diplômé</option>
            <option value="withdrawn">Retiré</option>
          </select>
        </Field>
      </div>

      {/* Adresse structurée */}
      <div>
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-600">Adresse</div>
        <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-slate-200 p-4">
          <Field label="Rue">
            <input
              value={addrStreet}
              onChange={(e) => setAddrStreet(e.target.value)}
              placeholder="12 rue de la Paix"
              className={inputCls}
            />
          </Field>
          <Field label="Ville">
            <input
              value={addrCity}
              onChange={(e) => setAddrCity(e.target.value)}
              placeholder="Paris"
              className={inputCls}
            />
          </Field>
          <Field label="Code postal">
            <input
              value={addrPostalCode}
              onChange={(e) => setAddrPostalCode(e.target.value)}
              placeholder="75001"
              className={`${inputCls} font-mono`}
            />
          </Field>
          <Field label="Pays">
            <input
              value={addrCountry}
              onChange={(e) => setAddrCountry(e.target.value)}
              placeholder="France"
              className={inputCls}
            />
          </Field>
        </div>
      </div>

      <Field label="Notes médicales (allergies, infos importantes)">
        <textarea
          value={medicalNotes}
          onChange={(e) => setMedicalNotes(e.target.value)}
          rows={3}
          className={inputCls}
        />
      </Field>
      <Field label="Notes générales">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} />
      </Field>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-blue-500/30 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Enregistrer
        </button>
      </div>
    </section>
  );
}

function EnrollmentsTab({
  student,
  classes,
}: {
  student: StudentDetail;
  classes: SimpleClass[];
}) {
  const [adding, setAdding] = useState(false);
  const [classSectionId, setClassSectionId] = useState('');
  const [transferring, setTransferring] = useState<string | null>(null);
  const [transferTo, setTransferTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeEnrollment = student.enrollments.find((e) => e.status === 'active');
  const activeYearClasses = classes.filter((c) => c.academicYear.status === 'active' && c.status === 'active');
  const availableClasses = activeEnrollment
    ? activeYearClasses.filter((c) => c.id !== activeEnrollment.classSection.id)
    : activeYearClasses;

  const onEnroll = async () => {
    if (!classSectionId) return;
    setBusy(true);
    setError(null);
    const res = await enrollStudent(student.id, classSectionId);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setAdding(false);
      setClassSectionId('');
    }
  };

  const onTransfer = async (enrollmentId: string) => {
    if (!transferTo) return;
    setBusy(true);
    setError(null);
    const res = await transferEnrollment(student.id, enrollmentId, transferTo, 'Transfert administratif');
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setTransferring(null);
      setTransferTo('');
    }
  };

  const onEnd = async (enrollmentId: string, status: 'dropped' | 'graduated' | 'transferred_out') => {
    const reason = prompt('Motif (optionnel) :');
    setBusy(true);
    setError(null);
    const res = await endEnrollment(student.id, enrollmentId, status, reason ?? undefined);
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  return (
    <section className="space-y-4">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>}

      {!activeEnrollment && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-amber-900">Aucune inscription active</div>
            <p className="mt-0.5 text-xs text-amber-800">
              Inscrivez cet élève dans une classe pour l&apos;année active.
            </p>
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white hover:bg-amber-700"
            >
              <Plus className="h-3.5 w-3.5" /> Inscrire
            </button>
          )}
        </div>
      )}

      {adding && (
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 flex flex-wrap items-center gap-3">
          <select
            value={classSectionId}
            onChange={(e) => setClassSectionId(e.target.value)}
            className="flex-1 min-w-[200px] rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">— Choisir une classe —</option>
            {availableClasses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.gradeLevel.name} ({c.academicYear.name})
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !classSectionId}
            onClick={onEnroll}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-3 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Inscrire
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setClassSectionId('');
            }}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Annuler
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-white ring-1 ring-slate-200 overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
            Historique ({student.enrollments.length})
          </h3>
          {activeEnrollment && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 text-xs font-bold accent-text hover:underline"
            >
              <Plus className="h-3 w-3" /> Ajouter une inscription
            </button>
          )}
        </div>
        {student.enrollments.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-500">Aucune inscription pour le moment.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {student.enrollments.map((e) => (
              <li key={e.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                <span
                  className={`grid h-10 w-10 place-items-center rounded-xl text-sm font-bold ${
                    e.status === 'active'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {e.classSection.gradeLevel.code}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900">
                    {e.classSection.name} <span className="font-medium text-slate-500">· {e.classSection.gradeLevel.name}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {e.academicYear.name} · Inscrit le{' '}
                    <PreferredDate value={e.enrolledAt} />
                    {e.endedAt && (
                      <>
                        {' '}
                        → Terminé le <PreferredDate value={e.endedAt} />
                        {e.endReason && <span className="italic"> ({e.endReason})</span>}
                      </>
                    )}
                  </div>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    e.status === 'active'
                      ? 'bg-emerald-100 text-emerald-700'
                      : e.status === 'transferred_out' || e.status === 'transferred_in'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {e.status.replace(/_/g, ' ')}
                </span>
                {e.status === 'active' && (
                  <div className="flex gap-1">
                    <button
                      onClick={() => setTransferring(e.id)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-amber-700 hover:bg-amber-50"
                    >
                      <ArrowRight className="h-3 w-3" /> Transférer
                    </button>
                    <button
                      onClick={() => onEnd(e.id, 'dropped')}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
                    >
                      <LogOut className="h-3 w-3" /> Mettre fin
                    </button>
                  </div>
                )}
                {transferring === e.id && (
                  <div className="w-full mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 p-3">
                    <select
                      value={transferTo}
                      onChange={(ev) => setTransferTo(ev.target.value)}
                      className="flex-1 min-w-[200px] rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">— Classe cible (même année) —</option>
                      {classes
                        .filter(
                          (c) =>
                            c.academicYearId === e.academicYear.id &&
                            c.id !== e.classSection.id &&
                            c.status === 'active',
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {c.gradeLevel.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || !transferTo}
                      onClick={() => onTransfer(e.id)}
                      className="inline-flex items-center gap-1 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Confirmer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTransferring(null);
                        setTransferTo('');
                      }}
                      className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function GuardiansTab({
  student,
  guardians,
}: {
  student: StudentDetail;
  guardians: SimpleGuardian[];
}) {
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [existingId, setExistingId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [profession, setProfession] = useState('');
  const [relationship, setRelationship] = useState('mother');
  const [isPrimary, setIsPrimary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeLinks = student.guardianships.filter((g) => g.status === 'active');

  const onAttach = async () => {
    setBusy(true);
    setError(null);
    const payload = mode === 'existing' ? { guardianId: existingId } : { firstName, lastName, email, phone, profession };
    const res = await attachGuardian(student.id, payload, relationship, isPrimary);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else {
      setAdding(false);
      setExistingId('');
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setProfession('');
      setRelationship('mother');
      setIsPrimary(false);
    }
  };

  const onRevoke = async (id: string) => {
    if (!confirm('Révoquer ce rattachement ? Le parent perd l\'accès à cet élève.')) return;
    setBusy(true);
    const res = await revokeGuardianship(student.id, id);
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  return (
    <section className="space-y-4">
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
          Parents & responsables actifs ({activeLinks.length})
        </h3>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-blue-500/30"
          >
            <UserPlus className="h-3.5 w-3.5" /> Rattacher un parent
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-5 space-y-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-bold ${
                mode === 'existing' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-700'
              }`}
            >
              Parent existant
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`flex-1 rounded-xl border-2 px-3 py-2 text-sm font-bold ${
                mode === 'new' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-700'
              }`}
            >
              Nouveau parent
            </button>
          </div>

          {mode === 'existing' ? (
            <Field label="Parent">
              <select value={existingId} onChange={(e) => setExistingId(e.target.value)} className={inputCls}>
                <option value="">— Choisir un parent —</option>
                {guardians.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.lastName.toUpperCase()} {g.firstName}
                    {g.email ? ` · ${g.email}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Prénom *">
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Nom *">
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Email">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Téléphone">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Profession">
                <input value={profession} onChange={(e) => setProfession(e.target.value)} className={inputCls} />
              </Field>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Lien de parenté">
              <select value={relationship} onChange={(e) => setRelationship(e.target.value)} className={inputCls}>
                {Object.entries(RELATIONSHIP_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <label className="inline-flex items-center gap-2 mt-7">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                className="h-4 w-4 rounded"
              />
              <span className="text-sm text-slate-700">Contact principal</span>
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Annuler
            </button>
            <button
              type="button"
              disabled={
                busy ||
                (mode === 'existing' && !existingId) ||
                (mode === 'new' && (!firstName.trim() || !lastName.trim()))
              }
              onClick={onAttach}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-4 py-2 text-sm font-bold text-white shadow disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Rattacher
            </button>
          </div>
        </div>
      )}

      {activeLinks.length === 0 ? (
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 px-6 py-10 text-center text-sm text-slate-500">
          Aucun parent rattaché. Cliquez sur « Rattacher un parent » pour en ajouter un.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {activeLinks.map((g) => (
            <li
              key={g.id}
              className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 flex items-start gap-3"
            >
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-pink-100 to-rose-100 text-base font-bold text-rose-700">
                {(g.guardian.firstName[0] ?? '?').toUpperCase()}
                {(g.guardian.lastName[0] ?? '').toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-slate-900 truncate">
                    {g.guardian.lastName.toUpperCase()} {g.guardian.firstName}
                  </span>
                  {g.isPrimaryContact && (
                    <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 font-bold text-rose-700">
                    {RELATIONSHIP_LABEL[g.relationship] ?? g.relationship}
                  </span>
                  {g.guardian.email && <span className="truncate">{g.guardian.email}</span>}
                  {g.guardian.phone && <span>{g.guardian.phone}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
                  {g.canPickup && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">
                      <ShieldCheck className="h-3 w-3" /> Récupération autorisée
                    </span>
                  )}
                  {g.hasLegalCustody && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 font-bold text-blue-700">
                      Autorité parentale
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRevoke(g.id)}
                className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Révoquer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase font-bold tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-0.5 text-sm text-slate-900 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm';
