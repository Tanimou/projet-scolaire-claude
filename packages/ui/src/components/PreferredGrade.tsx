'use client';

import { useDisplayGradeFormat } from './DisplayPrefsProvider';
import {
  formatPreferredGrade,
  type DisplayGradeFormat,
  type FormatPreferredGradeOptions,
} from '../lib/display-prefs';

export interface PreferredGradeProps extends FormatPreferredGradeOptions {
  value: number | null | undefined;
  /** Override the format from context (rarely needed). */
  formatOverride?: DisplayGradeFormat;
  className?: string;
}

/**
 * Renders a grade using the current user's preferred grade format
 * (twenty / percent / letter). Consumes `DisplayPrefsProvider`.
 */
export function PreferredGrade({
  value,
  formatOverride,
  className,
  ...opts
}: PreferredGradeProps) {
  const format = useDisplayGradeFormat();
  return (
    <span className={className}>
      {formatPreferredGrade(value, formatOverride ?? format, opts)}
    </span>
  );
}
