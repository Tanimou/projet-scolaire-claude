/**
 * Squelette de chargement de `/admin/enrollments`.
 *
 * La page est `force-dynamic` et enchaîne une lecture serveur : sans ce
 * fichier, l'admin regardait un **écran blanc** pendant toute la latence API,
 * sans aucun `aria-busy` — donc sans rien à annoncer pour une technologie
 * d'assistance non plus. Next.js monte ce composant automatiquement dès que la
 * navigation démarre.
 *
 * Il n'imite PAS les nombres : les emplacements de KPI restent des blocs
 * neutres. Un squelette qui afficherait `0` en attendant serait la même
 * invention que le `0` sur lecture échouée que cette tranche retire — un chiffre
 * qui n'a été lu nulle part.
 */
export default function EnrollmentsLoading() {
  return (
    <div className="animate-pulse p-6" aria-busy="true" aria-label="Chargement des demandes">
      <div className="h-4 w-64 rounded bg-slate-100" />
      <div className="mt-4 h-8 w-56 rounded bg-slate-200" />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[148px] rounded-2xl bg-slate-100 ring-1 ring-slate-200/60" />
        ))}
      </div>

      <div className="mt-6 flex gap-6 border-b border-slate-200 pb-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-5 w-24 rounded bg-slate-100" />
        ))}
      </div>

      <div className="mt-6 space-y-px overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/60">
        <div className="h-11 bg-slate-100" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-14 border-t border-slate-100 bg-white" />
        ))}
      </div>
    </div>
  );
}
