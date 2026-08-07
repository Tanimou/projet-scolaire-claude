import { isIP } from 'node:net';

import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { buildFrenchHolidayPlan, type PlannedHoliday } from './french-holidays';

/** Longueur maximale stockée dans `AuditLog.userAgent` (colonne `String?`). */
export const MAX_USER_AGENT_LENGTH = 512;

/**
 * Normalise une adresse IP avant qu'elle n'entre dans la transaction.
 *
 * `AuditLog.ipAddress` est une colonne `@db.Inet` : PostgreSQL **rejette** une
 * valeur non-inet (un `X-Forwarded-For` en « a, b, c », par exemple). Comme la
 * ligne d'audit est écrite DANS la même transaction que l'import (gate
 * G-AUDIT), un cast raté ferait rouler en arrière un import parfaitement
 * valide : l'hygiène deviendrait un mode de panne pour l'écriture qu'elle est
 * censée tracer. On assainit donc **avant** d'ouvrir la transaction, et une
 * valeur non-inet devient `null` (une provenance absente, jamais une provenance
 * fausse).
 */
export function sanitiseInetOrNull(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim();
  if (candidate.length === 0) return null;
  return isIP(candidate) === 0 ? null : candidate;
}

/** Tronque le user-agent ; `null` si absent ou vide. */
export function truncateUserAgent(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim();
  if (candidate.length === 0) return null;
  return candidate.slice(0, MAX_USER_AGENT_LENGTH);
}

/** Une année scolaire déclarée, réduite à ce dont la résolution a besoin. */
export interface AcademicYearWindow {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
}

export interface SeedFrenchHolidaysArgs {
  tenantId: string;
  schoolId: string;
  actorId: string;
  /** Dérivé du JWT (`deriveAlertActorProvenance`) — jamais un littéral. */
  actorRole: string | null;
  portal: string | null;
  /** Année civile CHOISIE par l'opérateur. Requise : il n'y a plus de repli. */
  year: number;
  confirm: boolean;
  dryRun: boolean;
  /** Déjà assaini (`sanitiseInetOrNull`) — ne peut plus faire échouer le cast inet. */
  ipAddress: string | null;
  /** Déjà tronqué (`truncateUserAgent`). */
  userAgent: string | null;
}

/** Combien d'événements se rattachent à quelle année scolaire (`null` inclus). */
export interface AcademicYearAttachment {
  academicYearId: string | null;
  name: string | null;
  count: number;
}

export interface SeedFrenchHolidaysResult {
  ok: true;
  dryRun: boolean;
  /** Les DEUX années civiles réellement couvertes. */
  years: [number, number];
  planned: number;
  alreadyPresent: number;
  toCreate: number;
  created: number;
  academicYearAttachment: AcademicYearAttachment[];
}

/**
 * Clé d'identité exacte d'un férié : (intitulé, instant de début).
 *
 * Le séparateur est `|` — l'idiome de composition de clé du reste de `apps/api`
 * (`alerts/rules/*`, `notifications/*`). Il ne peut pas collisionner ici : les
 * intitulés générés viennent de la table figée de `FRENCH_PUBLIC_HOLIDAYS` et
 * aucun ne contient `|`, donc une clé issue d'une entrée générée porte
 * exactement UN `|` ; une ligne en base dont le titre contient `|` en porte au
 * moins deux et ne peut donc jamais matcher.
 *
 * Ne PAS écrire ce séparateur comme un octet de contrôle brut (`U+0000`) : git
 * classerait alors le fichier en binaire, et le diff, `git diff --check` et
 * grep/ripgrep cesseraient tous de le voir.
 */
function pairKey(title: string, startsAt: Date): string {
  return `${title}|${startsAt.getTime()}`;
}

/**
 * Résout l'année scolaire qui **contient** la date, par containment inclusif.
 *
 * `academicYear.startDate` / `endDate` sont des colonnes `@db.Date` (minuit UTC)
 * et les fériés sont ancrés à minuit UTC : la comparaison de timestamps est donc
 * exacte aux bornes. En cas de chevauchement de deux années déclarées (rien en
 * base ne l'interdit), la liste est triée par `startDate` **asc** et la première
 * correspondance gagne — déterministe, jamais une exception.
 *
 * `null` est un résultat NORMAL, pas un cas limite : le 14 juillet et le
 * 15 août tombent dans le creux d'été entre deux années scolaires françaises.
 * `academicYearId` est `String?` avec `onDelete: SetNull`, donc `null` est déjà
 * une valeur légitime en base. Rattacher ces lignes à l'année active — ce que
 * faisait le code d'origine — est un mensonge, pas une donnée manquante.
 */
export function resolveAcademicYearId(
  date: Date,
  academicYears: AcademicYearWindow[],
): string | null {
  const t = date.getTime();
  const match = academicYears.find(
    (ay) => ay.startDate.getTime() <= t && t <= ay.endDate.getTime(),
  );
  return match?.id ?? null;
}

/**
 * Import des jours fériés français — la moitié serveur de S-E06-6 (PF-29).
 *
 * Sorti du contrôleur parce qu'il porte une transaction, une résolution de
 * données et une ligne d'audit (précédent : `snapshot-ops.service.ts`,
 * `AdminRemediationService`). Le contrôleur ne fait plus que résoudre le
 * contexte et déléguer.
 */
@Injectable()
export class CalendarSeedService {
  constructor(private readonly prisma: PrismaService) {}

  async seedFrenchHolidays(args: SeedFrenchHolidaysArgs): Promise<SeedFrenchHolidaysResult> {
    const plan = buildFrenchHolidayPlan(args.year);

    // FR1 — refus AVANT toute lecture et toute écriture : ni événement, ni
    // ligne d'audit. Le message est construit depuis le plan qui servira à
    // écrire, donc il ne peut pas annoncer un périmètre plus étroit que le
    // runtime. Vérifié côté serveur, donc un appel `curl` y est soumis aussi —
    // une boîte de dialogue navigateur ne garantit rien.
    if (!args.dryRun && args.confirm !== true) {
      throw new BadRequestException(
        `Confirmation requise : cet import écrit ${plan.planned} événements couvrant les années civiles ` +
          `${plan.years[0]} et ${plan.years[1]}. Renvoyez la requête avec « confirm: true » ` +
          `(ou « dryRun: true » pour obtenir le détail sans rien écrire).`,
      );
    }

    // Une seule lecture des années scolaires (jamais 22), tenant-keyée
    // (ADR-002). Triée `startDate` asc : c'est l'ordre que
    // `resolveAcademicYearId` suppose pour départager un chevauchement.
    const academicYears = await this.prisma.academicYear.findMany({
      where: { tenantId: args.tenantId, schoolId: args.schoolId },
      select: { id: true, name: true, startDate: true, endDate: true },
      orderBy: { startDate: 'asc' },
    });

    // FR5 — le rattachement est résolu LIGNE PAR LIGNE contre la date de
    // l'événement. `activeAcademicYearId` n'intervient plus du tout ici.
    const entries = plan.entries.map((entry) => ({
      ...entry,
      academicYearId: resolveAcademicYearId(entry.startsAt, academicYears),
    }));

    const attachment = this.buildAttachment(entries, academicYears);
    const unattachedCount = entries.filter((e) => e.academicYearId === null).length;
    const academicYearIds = [
      ...new Set(entries.map((e) => e.academicYearId).filter((id): id is string => id !== null)),
    ];

    if (args.dryRun) {
      // FR3 — une simulation est une LECTURE : même requête d'existence, même
      // forme de réponse, zéro écriture (ni événement, ni audit).
      const missing = await this.resolveMissing(this.prisma, args, entries);
      return {
        ok: true,
        dryRun: true,
        years: plan.years,
        planned: plan.planned,
        alreadyPresent: plan.planned - missing.length,
        toCreate: missing.length,
        created: 0,
        academicYearAttachment: attachment,
      };
    }

    // FR7 — tout l'import dans UNE transaction : la lecture d'existence, un
    // `createMany` unique et la ligne d'audit. Un échec en cours de route ne
    // laisse rien derrière. Pas d'`isolationLevel: 'Serializable'` (zéro
    // occurrence dans apps/api — ce serait un idiome neuf qui exigerait une
    // politique de retry inexistante) : la course « double-clic concurrent »
    // est donc NARROWED, pas éliminée, et c'est écrit dans le ledger.
    return this.prisma.$transaction(async (tx) => {
      const missing = await this.resolveMissing(tx, args, entries);

      if (missing.length > 0) {
        await tx.calendarEvent.createMany({
          data: missing.map((entry) => ({
            tenantId: args.tenantId,
            schoolId: args.schoolId,
            academicYearId: entry.academicYearId,
            type: 'public_holiday' as const,
            scope: 'school_wide' as const,
            visibility: 'all' as const,
            title: entry.title,
            startsAt: entry.startsAt,
            endsAt: entry.endsAt,
            allDay: true,
            color: 'oklch(0.68 0.18 25)',
            icon: 'Flag',
            createdBy: args.actorId,
          })),
        });
      }

      const alreadyPresent = plan.planned - missing.length;
      const summary =
        `Import des jours fériés français ${plan.years[0]} et ${plan.years[1]} : ` +
        `${missing.length} créé(s), ${alreadyPresent} déjà présent(s) sur ${plan.planned} prévus` +
        (unattachedCount > 0 ? `, dont ${unattachedCount} sans année scolaire de rattachement` : '') +
        '.';

      // FR8 — EXACTEMENT une ligne d'audit par application, écrite avec le
      // client de transaction. `resourceId` reste `null` : la colonne est un
      // uuid unique et l'action touche jusqu'à 22 lignes — les identifiants
      // d'années et les compteurs vivent donc dans `after`. `after.summary` est
      // requis parce que `/admin/audit` dérive sa colonne « détail » de
      // `after.detail ?? after.summary` (analytics.service.ts) : sans lui, la
      // ligne s'afficherait vide. Écrite même quand 0 ligne est créée.
      await tx.auditLog.create({
        data: {
          tenantId: args.tenantId,
          actorId: args.actorId,
          actorRole: args.actorRole,
          portal: args.portal,
          action: 'calendar.seed_french_holidays',
          resourceType: 'calendar_event',
          resourceId: null,
          ipAddress: args.ipAddress,
          userAgent: args.userAgent,
          after: {
            summary,
            requestedYear: plan.requestedYear,
            years: plan.years,
            planned: plan.planned,
            created: missing.length,
            alreadyPresent,
            // Les années scolaires que le PLAN rattache (pas seulement les
            // lignes créées) : le périmètre que l'opérateur a confirmé reste
            // lisible même sur une relance à 0 création.
            academicYearIds,
            unattachedCount,
          },
        },
      });

      return {
        ok: true as const,
        dryRun: false,
        years: plan.years,
        planned: plan.planned,
        alreadyPresent,
        toCreate: missing.length,
        created: missing.length,
        academicYearAttachment: attachment,
      };
    });
  }

  /**
   * Lecture d'existence ensembliste : UNE requête pour les 22 candidats.
   *
   * `tenantId` est présent (correctif de la famille PF-11 : la requête
   * d'origine ne filtrait que sur `schoolId`). Les filtres `title IN (...)` et
   * `startsAt IN (...)` ne sont qu'un **préfiltre de réduction** — leur
   * combinaison est un produit cartésien, donc la décision est prise par un Set
   * de paires exactes `(title, startsAt)`.
   *
   * La clé ne porte volontairement AUCUN filtre `type` : c'est la sémantique de
   * suppression d'aujourd'hui (un événement créé à la main le même jour avec le
   * même intitulé bloque toujours le doublon), et la changer serait un
   * changement de comportement hors périmètre.
   */
  private async resolveMissing(
    client: Pick<Prisma.TransactionClient, 'calendarEvent'>,
    args: Pick<SeedFrenchHolidaysArgs, 'tenantId' | 'schoolId'>,
    entries: Array<PlannedHoliday & { academicYearId: string | null }>,
  ): Promise<Array<PlannedHoliday & { academicYearId: string | null }>> {
    const existing = await client.calendarEvent.findMany({
      where: {
        tenantId: args.tenantId,
        schoolId: args.schoolId,
        title: { in: [...new Set(entries.map((e) => e.title))] },
        startsAt: { in: entries.map((e) => e.startsAt) },
      },
      select: { title: true, startsAt: true },
    });
    const present = new Set(existing.map((e) => pairKey(e.title, e.startsAt)));
    return entries.filter((entry) => !present.has(pairKey(entry.title, entry.startsAt)));
  }

  /**
   * Regroupe les 22 entrées par année scolaire de rattachement, années
   * déclarées d'abord (ordre `startDate` asc, celui de la requête), puis le
   * seau `null` en dernier. C'est ce que la confirmation affiche : combien
   * d'événements iront sur quelle année, et combien sur aucune.
   */
  private buildAttachment(
    entries: Array<{ academicYearId: string | null }>,
    academicYears: AcademicYearWindow[],
  ): AcademicYearAttachment[] {
    const counts = new Map<string | null, number>();
    for (const entry of entries) {
      counts.set(entry.academicYearId, (counts.get(entry.academicYearId) ?? 0) + 1);
    }

    const rows: AcademicYearAttachment[] = [];
    for (const ay of academicYears) {
      const count = counts.get(ay.id);
      if (count) rows.push({ academicYearId: ay.id, name: ay.name, count });
    }
    const unattached = counts.get(null);
    if (unattached) rows.push({ academicYearId: null, name: null, count: unattached });
    return rows;
  }
}
