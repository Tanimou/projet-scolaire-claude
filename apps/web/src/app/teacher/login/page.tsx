import type { Metadata } from 'next';

import { PortalLoginForm } from '@/components/PortalLoginForm';
import { resolvePortalClientId } from '@/lib/keycloak-clients';

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
      // Résolu côté serveur par l'accesseur unique (ADR-050) : le lien « mot de
      // passe oublié » vise donc toujours le même client OIDC que la connexion.
      resetClientId={resolvePortalClientId('teacher', process.env)}
      otherPortals={[
        { label: 'Portail famille', href: '/parent/login' },
        { label: 'Portail administrateur', href: '/admin/login' },
      ]}
    />
  );
}
