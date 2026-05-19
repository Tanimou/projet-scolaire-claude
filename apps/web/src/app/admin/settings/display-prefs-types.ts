/**
 * Backwards-compat re-export — the shared types now live in `@pilotage/ui`
 * so the provider, helpers and `<PreferredDate>` / `<PreferredGrade>` components
 * all consume the same definitions. Existing callers keep importing from this
 * module to avoid a churn diff across the settings flow.
 */
export {
  DISPLAY_PREFS_DEFAULTS,
  type DisplayAccent,
  type DisplayDateFormat,
  type DisplayDensity,
  type DisplayGradeFormat,
  type DisplayPreferences,
} from '@pilotage/ui';

import type { DisplayPreferences } from '@pilotage/ui';

export type UpdateDisplayPreferencesPatch = Partial<DisplayPreferences>;
