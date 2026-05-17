import type { Metadata } from 'next';

import { PortalLoginForm } from '@/components/PortalLoginForm';

export const metadata: Metadata = {
  title: 'Connexion professeur',
  description: 'Connectez-vous au portail professeur Pilotage scolaire.',
};

export default function TeacherLoginPage() {
  return (
    <PortalLoginForm
      accent="teacher"
      title="Portail Professeur"
      subtitle="Connectez-vous pour piloter vos classes"
      registerHref="/teacher/register"
      registerLabel="Vous avez reçu une invitation ?"
      otherPortals={[
        { label: 'Portail famille', href: '/parent/login' },
        { label: 'Portail administrateur', href: '/admin/login' },
      ]}
    />
  );
}
