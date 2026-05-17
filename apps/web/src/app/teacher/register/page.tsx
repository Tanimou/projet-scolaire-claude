import { ArrowRight, Mail, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { AuthSplitLayout } from '@/components/AuthSplitLayout';

export const metadata: Metadata = { title: 'Demande d\'invitation professeur' };

export default function TeacherRegisterPage() {
  return (
    <AuthSplitLayout
      portal="teacher"
      title="Inscription professeur"
      subtitle="L'accès professeur se fait sur invitation de l'administration de votre établissement."
      bottomLinks={[
        { label: 'Portail famille', href: '/parent/login' },
        { label: 'Portail administrateur', href: '/admin/login' },
      ]}
    >
      <div className="rounded-2xl border border-teal-100 bg-teal-50 p-5 text-sm text-teal-900">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
          <div>
            <p className="font-semibold">Comment obtenir mon accès ?</p>
            <p className="mt-1.5 leading-relaxed">
              Contactez l&apos;administration de votre établissement pour qu&apos;ils vous invitent depuis leur
              portail. Vous recevrez un email avec un lien sécurisé pour définir votre mot de passe et configurer
              l&apos;authentification à deux facteurs.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h3 className="text-sm font-bold text-slate-900">J&apos;ai déjà reçu mon invitation</h3>
        <p className="mt-1.5 text-sm text-slate-600">
          Cliquez sur le lien dans l&apos;email pour activer votre compte. Une fois actif, connectez-vous via la page
          de connexion professeur.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Mail className="h-3.5 w-3.5 text-slate-500" />
          Dev: les emails arrivent dans Maildev → <a href="http://localhost:1080" target="_blank" rel="noreferrer" className="font-semibold text-teal-700 hover:underline">localhost:1080</a>
        </div>
      </div>

      <Link
        href="/teacher/login"
        className="mt-8 inline-flex items-center gap-1.5 text-sm font-bold text-teal-700 hover:underline"
      >
        Retour à la connexion
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </AuthSplitLayout>
  );
}
