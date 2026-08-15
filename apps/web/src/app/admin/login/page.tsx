import type { Metadata } from 'next';

import { PortalLoginForm } from '@/components/PortalLoginForm';
import { resolvePortalClientId } from '@/lib/keycloak-clients';

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
      // Résolu côté serveur par l'accesseur unique (ADR-050) : le lien « mot de
      // passe oublié » vise donc toujours le même client OIDC que la connexion.
      resetClientId={resolvePortalClientId('admin', process.env)}
      otherPortals={[
        { label: 'Portail famille', href: '/parent/login' },
        { label: 'Portail professeur', href: '/teacher/login' },
      ]}
    />
  );
}
