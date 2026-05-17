import type { Metadata } from 'next';

import { AuthSplitLayout } from '@/components/AuthSplitLayout';

import { ParentRegisterForm } from './ParentRegisterForm';

export const metadata: Metadata = { title: 'Créer un compte famille' };

export default function ParentRegisterPage() {
  return (
    <AuthSplitLayout
      portal="parent"
      title="Créer votre compte famille"
      subtitle="Quelques infos pour commencer. Vous pourrez rattacher votre enfant juste après."
      bottomLinks={[
        { label: 'Portail professeur', href: '/teacher/login' },
        { label: 'Portail administrateur', href: '/admin/login' },
      ]}
    >
      <ParentRegisterForm />
    </AuthSplitLayout>
  );
}
