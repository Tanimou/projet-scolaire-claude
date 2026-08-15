import type { Metadata } from 'next';

import { PortalLoginForm } from '@/components/PortalLoginForm';
import { resolvePortalClientId } from '@/lib/keycloak-clients';

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
      // Résolu côté serveur par l'accesseur unique (ADR-050) : le lien « mot de
      // passe oublié » vise donc toujours le même client OIDC que la connexion.
      resetClientId={resolvePortalClientId('parent', process.env)}
      otherPortals={[
        { label: 'Portail professeur', href: '/teacher/login' },
        { label: 'Portail administrateur', href: '/admin/login' },
      ]}
    />
  );
}
