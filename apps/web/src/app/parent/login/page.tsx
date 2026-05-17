import type { Metadata } from 'next';

import { PortalLoginForm } from '@/components/PortalLoginForm';

export const metadata: Metadata = {
  title: 'Connexion famille',
  description: 'Connectez-vous au portail famille Pilotage scolaire.',
};

export default function ParentLoginPage() {
  return (
    <PortalLoginForm
      accent="parent"
      title="Portail Famille"
      subtitle="Connectez-vous pour suivre votre enfant"
      registerHref="/parent/register"
      registerLabel="Pas encore de compte ?"
      otherPortals={[
        { label: 'Portail professeur', href: '/teacher/login' },
        { label: 'Portail administrateur', href: '/admin/login' },
      ]}
    />
  );
}
