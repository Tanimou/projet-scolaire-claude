import type { Metadata } from 'next';

import { PortalLoginForm } from '@/components/PortalLoginForm';
import { resolvePortalClientId } from '@/lib/keycloak-clients';

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
      // Résolu côté serveur par l'accesseur unique (ADR-050) : le lien « mot de
      // passe oublié » vise donc toujours le même client OIDC que la connexion.
      resetClientId={resolvePortalClientId('student', process.env)}
      otherPortals={[
        { label: 'Portail famille', href: '/parent/login' },
        { label: 'Portail professeur', href: '/teacher/login' },
      ]}
    />
  );
}
