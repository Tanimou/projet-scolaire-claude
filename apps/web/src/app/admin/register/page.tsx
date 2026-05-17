import { ArrowRight, Mail, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthSplitLayout } from '@/components/AuthSplitLayout';

export const metadata: Metadata = { title: 'Demande d\'invitation administrateur' };

export default function AdminRegisterPage() {
  return (
    <AuthSplitLayout
      portal="admin"
      title="Inscription administrateur"
      subtitle="L'accès administrateur est réservé sur invitation pour des raisons de sécurité."
      bottomLinks={[
        { label: 'Portail famille', href: '/parent/login' },
        { label: 'Portail professeur', href: '/teacher/login' },
      ]}
    >
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-900">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
          <div>
            <p className="font-semibold">Pourquoi l&apos;invitation est-elle obligatoire ?</p>
            <p className="mt-1.5 leading-relaxed">
              Les comptes administrateurs ont accès aux données scolaires de tous les élèves. Pour cette raison, ils
              ne peuvent être créés que par un administrateur existant, avec authentification à deux facteurs (TOTP)
              configurée à la première connexion.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-bold text-slate-900">Vous êtes le premier admin de votre établissement ?</h3>
        <p className="mt-1.5 text-sm text-slate-600">
          Contactez le support Pilotage scolaire à{' '}
          <a href="mailto:support@pilotage-scolaire.app" className="font-semibold text-blue-700 underline">
            support@pilotage-scolaire.app
          </a>{' '}
          pour qu&apos;un super-administrateur vous provisionne.
        </p>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-bold text-slate-900">Vous avez déjà reçu une invitation par email ?</h3>
        <p className="mt-1.5 text-sm text-slate-600">
          Le lien dans l&apos;email vous guidera pour définir votre mot de passe et activer votre compte. Vérifiez
          votre boîte (et le dossier spam).
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Mail className="h-3.5 w-3.5 text-slate-500" />
          Dev: les emails sont catchés par Maildev → <a href="http://localhost:1080" target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">localhost:1080</a>
        </div>
      </div>

      <Link
        href="/admin/login"
        className="mt-8 inline-flex items-center gap-1.5 text-sm font-bold text-blue-700 hover:underline"
      >
        Retour à la connexion
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </AuthSplitLayout>
  );
}
