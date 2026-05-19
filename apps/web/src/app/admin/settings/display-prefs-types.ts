export type DisplayDensity = 'compact' | 'cozy' | 'spacious';
export type DisplayAccent = 'default' | 'blue' | 'violet' | 'emerald' | 'rose' | 'amber';
export type DisplayDateFormat = 'short' | 'long' | 'relative';
export type DisplayGradeFormat = 'twenty' | 'percent' | 'letter';

export interface DisplayPreferences {
  density: DisplayDensity;
  accent: DisplayAccent;
  dateFormat: DisplayDateFormat;
  gradeFormat: DisplayGradeFormat;
}

export interface UpdateDisplayPreferencesPatch {
  density?: DisplayDensity;
  accent?: DisplayAccent;
  dateFormat?: DisplayDateFormat;
  gradeFormat?: DisplayGradeFormat;
}

export const DISPLAY_PREFS_DEFAULTS: DisplayPreferences = {
  density: 'cozy',
  accent: 'default',
  dateFormat: 'short',
  gradeFormat: 'twenty',
};
