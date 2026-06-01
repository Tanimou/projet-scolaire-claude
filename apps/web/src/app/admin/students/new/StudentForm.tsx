'use client';

import { Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Avatar } from '@pilotage/ui';

import { createStudent } from '../actions';

export function StudentForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [externalRef, setExternalRef] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [gender, setGender] = useState('');
  const [nationality, setNationality] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  // Adresse structurée
  const [addrStreet, setAddrStreet] = useState('');
  const [addrCity, setAddrCity] = useState('');
  const [addrPostalCode, setAddrPostalCode] = useState('');
  const [addrCountry, setAddrCountry] = useState('');
  const [medicalNotes, setMedicalNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildAddress = (): Record<string, string> | undefined => {
    const addr: Record<string, string> = {};
    if (addrStreet.trim()) addr.street = addrStreet.trim();
    if (addrCity.trim()) addr.city = addrCity.trim();
    if (addrPostalCode.trim()) addr.postalCode = addrPostalCode.trim();
    if (addrCountry.trim()) addr.country = addrCountry.trim();
    return Object.keys(addr).length > 0 ? addr : undefined;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createStudent({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      birthDate: birthDate || undefined,
      externalRef: externalRef.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      gender: gender || undefined,
      nationality: nationality.toUpperCase() || undefined,
      photoUrl: photoUrl.trim() || undefined,
      address: buildAddress(),
      medicalNotes: medicalNotes.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.push(`/admin/students/${res.data.id}`);
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-900">{error}</div>
      )}

      <section className="rounded-2xl bg-white ring-1 ring-slate-200 p-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Identité</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Prénom *">
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Nom *">
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Date de naissance">
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Sexe">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">— Non précisé —</option>
              <option value="F">Féminin</option>
              <option value="M">Masculin</option>
              <option value="X">Autre</option>
            </select>
          </Field>
          <Field label="Matricule (référence interne)">
            <input
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              placeholder="Ex: EL-2025-001"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
            />
          </Field>
          <Field label="Nationalité (ISO 2 lettres)">
            <input
              value={nationality}
              onChange={(e) => setNationality(e.target.value.toUpperCase().slice(0, 2))}
              maxLength={2}
              placeholder="FR"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
            />
          </Field>
        </div>

        {/* Photo de profil avec prévisualisation live */}
        <div className="mt-4 flex items-center gap-4">
          <Avatar
            src={photoUrl || null}
            firstName={firstName}
            lastName={lastName}
            size="lg"
            className="shrink-0 rounded-xl"
          />
          <div className="flex-1">
            <Field label="URL de la photo de profil">
              <input
                type="url"
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                placeholder="https://example.com/photo.jpg"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white ring-1 ring-slate-200 p-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Contact & Adresse</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="prenom.nom@example.com"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Téléphone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="06 12 34 56 78"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
        </div>

        {/* Adresse structurée */}
        <div className="mt-4 rounded-xl border border-slate-200 p-4">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Adresse</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rue">
              <input
                value={addrStreet}
                onChange={(e) => setAddrStreet(e.target.value)}
                placeholder="12 rue de la Paix"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Ville">
              <input
                value={addrCity}
                onChange={(e) => setAddrCity(e.target.value)}
                placeholder="Paris"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Code postal">
              <input
                value={addrPostalCode}
                onChange={(e) => setAddrPostalCode(e.target.value)}
                placeholder="75001"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono"
              />
            </Field>
            <Field label="Pays">
              <input
                value={addrCountry}
                onChange={(e) => setAddrCountry(e.target.value)}
                placeholder="France"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white ring-1 ring-slate-200 p-5">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Notes</h3>
        <div className="mt-4 grid gap-4">
          <Field label="Allergies / notes médicales (visibles par admin & infirmier)">
            <textarea
              value={medicalNotes}
              onChange={(e) => setMedicalNotes(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Notes générales">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          </Field>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={busy || !firstName.trim() || !lastName.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-blue-700 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/30 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Enregistrer
        </button>
      </div>
    </form>
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
