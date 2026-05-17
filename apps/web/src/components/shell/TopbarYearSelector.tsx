'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { YearSelector, type YearOption } from '@pilotage/ui';

export interface TopbarYearSelectorProps {
  options: YearOption[];
  /** Currently selected year id (e.g. the active academic year) */
  defaultValue: string;
}

/**
 * TopbarYearSelector — wires `<YearSelector>` to a soft refresh of the page so
 * server components re-fetch with the new year context. The selected year is
 * stored client-side only for MVP; persistence can be wired to user prefs later.
 */
export function TopbarYearSelector({ options, defaultValue }: TopbarYearSelectorProps) {
  const [value, setValue] = useState(defaultValue);
  const router = useRouter();
  return (
    <YearSelector
      options={options}
      value={value}
      onChange={(id) => {
        setValue(id);
        router.refresh();
      }}
    />
  );
}
