import { pageEnvelope, unvalidatedItem } from '@pilotage/contracts';
import type { z } from 'zod';

export type ExportKind =
  | 'grades_xlsx'
  | 'attendance_xlsx'
  | 'enrollment_xlsx'
  | 'report_card_pdf'
  | 'audit_csv';

export type ExportStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type ExportPeriod = 'all' | '24h' | '7d' | '30d' | '90d';

export type ExportKindFilter = '' | ExportKind | 'xlsx' | 'pdf' | 'csv';

export type ExportStatusFilter = '' | ExportStatus | 'inflight' | 'completed';

export interface ExportRow {
  id: string;
  kind: ExportKind;
  status: ExportStatus;
  fileName: string;
  fileUrl: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  requesterId: string | null;
  requesterName: string | null;
  parameters: Record<string, unknown>;
  createdAt: string;
  finishedAt: string | null;
}

/**
 * L'enveloppe servie par `GET /api/v1/exports` — S-E03-11 / PF-427 / ADR-081.
 *
 * DÉRIVÉE du cadre canonique, plus transcrite à la main. Le cadre est vérifié
 * (`data` est un tableau, `total` un entier >= 0) ; les LIGNES ne le sont pas
 * (`unvalidatedItem<ExportRow>()`) : `ExportRow` est écrit à la main et n'a jamais
 * été confronté au serveur, donc en faire une assertion d'exécution
 * transformerait un défaut de type silencieux en page morte.
 *
 * `.passthrough()` est hérité de la fabrique : une clé que le serveur
 * ajouterait n'est jamais SUPPRIMÉE à l'exécution.
 */
export const exportsEnvelope = pageEnvelope(unvalidatedItem<ExportRow>());

export type ExportsListResp = z.infer<typeof exportsEnvelope>;

export interface RequesterOption {
  id: string;
  name: string;
}
