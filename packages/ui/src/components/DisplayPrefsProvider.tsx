'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';

import {
  ACCENT_TOKEN_MAP,
  DISPLAY_PREFS_DEFAULTS,
  type DisplayAccent,
  type DisplayDateFormat,
  type DisplayDensity,
  type DisplayGradeFormat,
  type DisplayPreferences,
} from '../lib/display-prefs';

interface DisplayPrefsContextValue extends DisplayPreferences {}

const DisplayPrefsContext = createContext<DisplayPrefsContextValue>(DISPLAY_PREFS_DEFAULTS);

export interface DisplayPrefsProviderProps {
  /** Initial preferences from the server — `<AppShellRoot>` resolves these from `/me`. */
  initial: DisplayPreferences;
  children: ReactNode;
}

/**
 * Threads display preferences across the whole app:
 *  - Sets `data-density` on `<html>` so utility selectors target it
 *    (e.g. `[data-density=compact] .density-pad { … }`).
 *  - Sets accent CSS variables on `<html>` (`--display-accent-soft`, `-text`, `-ring`, `-solid`)
 *    so any component can use them with `bg-[var(--display-accent-soft)]`.
 *  - Provides date/grade format to `<PreferredDate>` / `<PreferredGrade>` via context.
 */
export function DisplayPrefsProvider({ initial, children }: DisplayPrefsProviderProps) {
  const value = useMemo<DisplayPrefsContextValue>(
    () => ({
      density: initial.density ?? DISPLAY_PREFS_DEFAULTS.density,
      accent: initial.accent ?? DISPLAY_PREFS_DEFAULTS.accent,
      dateFormat: initial.dateFormat ?? DISPLAY_PREFS_DEFAULTS.dateFormat,
      gradeFormat: initial.gradeFormat ?? DISPLAY_PREFS_DEFAULTS.gradeFormat,
    }),
    [initial.density, initial.accent, initial.dateFormat, initial.gradeFormat],
  );

  // Apply density attribute + accent CSS vars on the root <html> element.
  // This means anything using `[data-density=…]` selectors (or
  // `var(--display-accent-…)`) reacts immediately, without prop-drilling.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-density', value.density);
    root.setAttribute('data-accent', value.accent);
    const tokens = ACCENT_TOKEN_MAP[value.accent];
    root.style.setProperty('--display-accent-solid', tokens.solid);
    root.style.setProperty('--display-accent-soft', tokens.soft);
    root.style.setProperty('--display-accent-text', tokens.text);
    root.style.setProperty('--display-accent-ring', tokens.ring);
  }, [value.density, value.accent]);

  return <DisplayPrefsContext.Provider value={value}>{children}</DisplayPrefsContext.Provider>;
}

export function useDisplayPrefs(): DisplayPreferences {
  return useContext(DisplayPrefsContext);
}

export function useDisplayDensity(): DisplayDensity {
  return useContext(DisplayPrefsContext).density;
}

export function useDisplayAccent(): DisplayAccent {
  return useContext(DisplayPrefsContext).accent;
}

export function useDisplayDateFormat(): DisplayDateFormat {
  return useContext(DisplayPrefsContext).dateFormat;
}

export function useDisplayGradeFormat(): DisplayGradeFormat {
  return useContext(DisplayPrefsContext).gradeFormat;
}
