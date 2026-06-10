import type { Metadata } from 'next';

import { PortalLoginForm } from '@/components/PortalLoginForm';

export const metadata: Metadata = {
  title: 'Connexion élève',
  description: 'Connecte-toi à ton espace élève Pilotage scolaire.',
};

export default function StudentLoginPage() {
  return (
    <PortalLoginForm
      accent="student"
      title="Espace Élève"
      subtitle="Connecte-toi pour retrouver tes notes"
      otherPortals={[
        { label: 'Portail famille', href: '/parent/login' },
        { label: 'Portail professeur', href: '/teacher/login' },
      ]}
    />
  );
}
