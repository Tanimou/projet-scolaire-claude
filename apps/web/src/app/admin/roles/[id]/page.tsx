import { redirect } from 'next/navigation';

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/roles/${id}/edit`);
}
