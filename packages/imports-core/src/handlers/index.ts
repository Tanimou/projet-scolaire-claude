import { ImportType } from '@prisma/client';

import { classesHandler } from './classes.handler';
import { enrollmentsHandler } from './enrollments.handler';
import { guardiansHandler } from './guardians.handler';
import { studentsHandler } from './students.handler';
import { subjectsHandler } from './subjects.handler';

import { type ImportHandler } from '../handler.types';

/**
 * Add a new entity type to bulk imports by exporting a new handler here.
 * The pipeline, UI wizard and templates automatically pick it up.
 */
const handlers: Partial<Record<ImportType, ImportHandler>> = {
  students: studentsHandler,
  classes: classesHandler,
  subjects: subjectsHandler,
  parents: guardiansHandler,
  enrollments: enrollmentsHandler,
};

export function getHandler(type: ImportType): ImportHandler | null {
  return handlers[type] ?? null;
}

export function listHandlers(): ImportHandler[] {
  return Object.values(handlers).filter((h): h is ImportHandler => !!h);
}

// Named handler re-exports — so callers/tests can target a specific handler
// (e.g. the E11-S4 students conflict-resolution path) without going through the
// `getHandler` registry.
export {
  classesHandler,
  enrollmentsHandler,
  guardiansHandler,
  studentsHandler,
  subjectsHandler,
};
