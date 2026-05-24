'use client';

import { createContext, useContext, useId, useState, type ReactNode } from 'react';

import { cn } from '../lib/cn';

type TabsCtx = {
  value: string;
  setValue: (next: string) => void;
  idBase: string;
  variant: 'underline' | 'pill' | 'segment';
};

const Ctx = createContext<TabsCtx | null>(null);

function useTabs(): TabsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('Tabs.* must be used inside a <Tabs> root');
  return v;
}

export interface TabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (next: string) => void;
  variant?: 'underline' | 'pill' | 'segment';
  children: ReactNode;
  className?: string;
}

export function Tabs({
  defaultValue,
  value: controlled,
  onValueChange,
  variant = 'underline',
  children,
  className,
}: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const value = controlled ?? internal;
  const setValue = (next: string) => {
    if (controlled === undefined) setInternal(next);
    onValueChange?.(next);
  };
  const idBase = useId();
  return (
    <Ctx.Provider value={{ value, setValue, idBase, variant }}>
      <div className={cn('w-full', className)}>{children}</div>
    </Ctx.Provider>
  );
}

export interface TabsListProps {
  children: ReactNode;
  className?: string;
}

export function TabsList({ children, className }: TabsListProps) {
  const { variant } = useTabs();
  return (
    <div
      role="tablist"
      className={cn(
        'flex items-center gap-1',
        variant === 'underline' && 'border-b border-slate-200',
        variant === 'pill' && 'rounded-full bg-slate-100 p-1',
        variant === 'segment' && 'rounded-lg bg-slate-100 p-1',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  value: string;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function TabsTrigger({ value: trigger, children, disabled, className }: TabsTriggerProps) {
  const { value, setValue, idBase, variant } = useTabs();
  const active = value === trigger;
  return (
    <button
      type="button"
      role="tab"
      id={`${idBase}-trigger-${trigger}`}
      aria-selected={active}
      aria-controls={`${idBase}-panel-${trigger}`}
      tabIndex={active ? 0 : -1}
      disabled={disabled}
      onClick={() => setValue(trigger)}
      className={cn(
        'inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'underline' &&
          (active
            ? 'border-b-2 border-[color:var(--accent-500)] px-4 py-2.5 text-slate-900'
            : 'border-b-2 border-transparent px-4 py-2.5 text-slate-500 hover:text-slate-900'),
        variant === 'pill' &&
          (active
            ? 'rounded-full bg-white px-4 py-1.5 text-slate-900 shadow-sm'
            : 'rounded-full px-4 py-1.5 text-slate-600 hover:text-slate-900'),
        variant === 'segment' &&
          (active
            ? 'rounded-md bg-white px-3 py-1.5 text-slate-900 shadow-sm'
            : 'rounded-md px-3 py-1.5 text-slate-600 hover:text-slate-900'),
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabsContent({ value: target, children, className }: TabsContentProps) {
  const { value, idBase } = useTabs();
  if (value !== target) return null;
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel-${target}`}
      aria-labelledby={`${idBase}-trigger-${target}`}
      className={cn('animate-fade-in mt-4', className)}
    >
      {children}
    </div>
  );
}
