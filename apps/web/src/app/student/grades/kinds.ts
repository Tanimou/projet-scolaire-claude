/**
 * Human labels for assessment kinds on the student "Mes notes" surface. Mirrors
 * the parent grade page's labels so the wording stays consistent across portals.
 */
const KIND_LABEL: Record<string, string> = {
  written_test: 'Contrôle écrit',
  oral_test: 'Oral',
  homework: 'Devoir maison',
  project: 'Projet',
  practical: 'Travaux pratiques',
  participation: 'Participation',
};

/** Resolve an assessment kind to its French label, falling back to the raw code. */
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}
