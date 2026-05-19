'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useTransition } from 'react';

import { Tabs } from '@pilotage/ui';

import type { AlertsTabKey } from './types';

export function AlertsTabsRouter({
  value,
  children,
}: {
  value: AlertsTabKey;
  children: ReactNode;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function onValueChange(next: string) {
    if (next === value) return;
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', next);
    startTransition(() => {
      router.push(`/admin/alerts?${sp.toString()}`);
    });
  }

  return (
    <Tabs value={value} onValueChange={onValueChange} defaultValue={value} variant="underline">
      {children}
    </Tabs>
  );
}
