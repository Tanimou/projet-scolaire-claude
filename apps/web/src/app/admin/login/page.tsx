import type { Metadata } from 'next';

import { PortalLoginForm } from '@/components/PortalLoginForm';

export const metadata: Metadata = {
  title: 'Connexion administrateur',
  description: 'Connectez-vous au portail administrateur Pilotage scolaire.',
};

export default function AdminLoginPage() {
  return (
    <PortalLoginForm
      accent="admin"
      title="Portail Administrateur"
      subtitle="Connectez-vous pour gérer l'établissement"
      registerHref="/admin/register"
      registerLabel="Vous avez reçu une invitation ?"
      otherPortals={[
        { label: 'Portail famille', href: '/parent/login' },
        { label: 'Portail professeur', href: '/teacher/login' },
      ]}
    />
  );
}
