/**
 * Shared types for the Cycles & Levels management UI.
 * Used by both the legacy `/admin/cycles` (redirect) and the new `/admin/levels`
 * page that hosts the actual interactive manager.
 */

export interface CycleItem {
  id: string;
  code: string;
  name: string;
  orderIndex: number;
  color: string | null;
  icon: string | null;
  gradeLevels: GradeLevelItem[];
  _count: { gradeLevels: number };
}

export interface GradeLevelItem {
  id: string;
  code: string;
  name: string;
  orderIndex: number;
  cycleId: string;
}
