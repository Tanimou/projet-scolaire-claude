import { EmptyState, SectionHeader, StatusBadge, defaultLabelForStatus } from '@pilotage/ui';
import { GraduationCap, School } from 'lucide-react';

/**
 * Une ligne de l'historique, telle que `GET /students/:id` (`B4`) la renvoie —
 * **complète et non filtrée** (`AC-2`).
 */
export interface EnrollmentHistoryRow {
  id: string;
  status: string;
  academicYearId: string;
  classSection: {
    id: string;
    name: string;
    gradeLevel?: { name?: string; cycle?: { name: string; color: string | null } | null } | null;
  };
  academicYear: { id: string; name: string };
}

/**
 * « Parcours scolaire » — l'historique complet des inscriptions de l'enfant.
 *
 * **Pourquoi cette section existe maintenant.** `GET /students/:id` renvoyait
 * déjà l'historique **non filtré**, et la page de détail s'en servait pour deux
 * choses à la fois : afficher le parcours *et* répondre à « est-il inscrit ? »
 * via `?? enrollments[0]`. S-E03-3 retire la seconde fonction (le verdict vient
 * désormais du champ canonique `enrollmentActivity`) — mais retirer la
 * dérivation sans rendre le parcours ferait **disparaître** l'information : un
 * parent lirait « Hors année en cours » sans jamais voir pourquoi.
 *
 * Cette section est donc la **contrepartie** du badge : elle est visible sans
 * interaction, un scroll plus bas, et transforme un état en explication. C'est
 * ce que demande `ADR-041 §D3` — un chiffre qui change doit rester *lisible*,
 * jamais alarmant.
 *
 * **Elle ne décide rien.** Elle rend les lignes **dans l'ordre où le serveur
 * les a renvoyées** (l'ordre total d'`ADR-072` : `enrolledAt desc`, départagé
 * sur `id`), sans `find` de statut, sans `[0]`. La ligne canonique est
 * simplement **reconnue** à la clé que la projection publie. Chaque ligne porte
 * **son propre** statut via `defaultLabelForStatus`, jamais une cinquième table
 * de traduction française écrite à la main (`DNC-10`).
 *
 * `defaultToneForStatus` n'est PAS utilisé : il mappe `graduated → success`, et
 * un diplôme en vert à côté d'un badge « Hors année en cours » recréerait la
 * contradiction que la tranche supprime. Seule la ligne canonique est verte.
 */
export interface SchoolPathSectionProps {
  rows: EnrollmentHistoryRow[];
  childFirstName: string;
  /** Clé de la ligne retenue par le serveur, ou `null` s'il n'en a retenu aucune. */
  canonicalKey: { academicYearId: string | null; classSectionName: string | null } | null;
}

export function SchoolPathSection({
  rows,
  childFirstName,
  canonicalKey,
}: SchoolPathSectionProps) {
  return (
    <section id="parcours" className="mt-6 scroll-mt-24">
      <SectionHeader
        title="Parcours scolaire"
        subtitle={`Toutes les inscriptions de ${childFirstName}, de la plus récente à la plus ancienne`}
        compact
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={School}
          title="Aucun dossier de scolarité"
          description={`Aucune inscription n'est enregistrée pour ${childFirstName}. Le secrétariat de l'établissement peut créer le dossier.`}
          tone="slate"
          className="mt-3"
        />
      ) : (
        <ol className="mt-3 space-y-2">
          {rows.map((row) => {
            const isCanonical =
              canonicalKey != null &&
              canonicalKey.academicYearId === row.academicYearId &&
              canonicalKey.classSectionName === row.classSection.name;
            const cycleColor = row.classSection.gradeLevel?.cycle?.color ?? '#94A3B8';
            return (
              <li
                key={row.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ${
                  isCanonical ? 'ring-emerald-200' : 'ring-slate-200/60'
                }`}
              >
                <span
                  aria-hidden
                  className="h-8 w-1 shrink-0 rounded-full"
                  style={{ background: cycleColor }}
                />
                <span className="min-w-[7rem] text-sm font-bold text-slate-900">
                  {row.academicYear.name}
                </span>
                <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-xs text-slate-600">
                  <GraduationCap className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">
                    {[
                      row.classSection.gradeLevel?.cycle?.name,
                      row.classSection.gradeLevel?.name,
                      row.classSection.name,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <StatusBadge
                  label={defaultLabelForStatus(row.status)}
                  tone={isCanonical ? 'success' : 'neutral'}
                  size="sm"
                  withDot
                />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
