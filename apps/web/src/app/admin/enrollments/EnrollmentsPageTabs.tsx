'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Tabs, TabsList, TabsTrigger, cn } from '@pilotage/ui';

export interface EnrollmentsPageTabsProps {
  activeTab: 'all' | 'pending' | 'to_verify' | 'approved' | 'rejected';
  counts: {
    all: number;
    pending: number;
    to_verify: number;
    approved: number;
    rejected: number;
  };
}

const TABS: Array<{ value: EnrollmentsPageTabsProps['activeTab']; label: string }> = [
  { value: 'all', label: 'Toutes' },
  { value: 'pending', label: 'En attente' },
  { value: 'to_verify', label: 'À vérifier' },
  { value: 'approved', label: 'Approuvées' },
  { value: 'rejected', label: 'Rejetées' },
];

export function EnrollmentsPageTabs({ activeTab, counts }: EnrollmentsPageTabsProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function pick(next: string) {
    const usp = new URLSearchParams(params.toString());
    usp.set('tab', next);
    usp.delete('page');
    startTransition(() => router.push(`/admin/enrollments?${usp.toString()}`));
  }

  return (
    <Tabs defaultValue={activeTab} value={activeTab} onValueChange={pick} variant="underline">
      <TabsList>
        {TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value}>
            <span>{t.label}</span>
            <span
              className={cn(
                'ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                t.value === activeTab ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600',
              )}
            >
              {counts[t.value]}
            </span>
          </TabsTrigger>
        ))}
        {isPending && (
          <span className="ml-3 text-[11px] text-slate-400" aria-live="polite">
            Mise à jour…
          </span>
        )}
      </TabsList>
    </Tabs>
  );
}
