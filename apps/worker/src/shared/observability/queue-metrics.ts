import { Counter, Gauge, Histogram } from 'prom-client';

import { registry } from './metrics.registry';

/**
 * Instrumentation BullMQ du worker (S-E02-17 / PF-56, tiers « files »).
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE FICHIER PEUT IMPORTER — et pourquoi c'est une contrainte, pas un goût
 * ---------------------------------------------------------------------------
 * **`prom-client` et le registre du worker. Rien d'autre.** Ni `bullmq`, ni
 * `ioredis`, ni `@nestjs/*`, ni `@prisma/client`.
 *
 * `scripts/observability-check.js` **requiert ce module dans son propre
 * processus** puis rend le registre (`readInstrumentedQueues`, et le contrôle 6
 * qui lit les lignes `# TYPE`). Un client Redis transitif dans ce graphe
 * d'import, c'est une poignée ouverte qui empêche l'étape 9 de la gate de
 * sortir — pire qu'un rouge, parce que ça affiche `PASS` puis ça pend. Les
 * files BullMQ arrivent donc par un **setter appelé au boot Nest**
 * (`registerQueueDepthSources`), et non par un import. Non branché — l'état de
 * la gate, et de tous les tests unitaires — le collecteur est un no-op :
 * jamais une connexion, jamais un throw.
 *
 * ---------------------------------------------------------------------------
 * CARDINALITÉ ET VIE PRIVÉE — la même contrainte de conception que côté API
 * ---------------------------------------------------------------------------
 * L'exposition est **non authentifiée par construction** (Prometheus ne porte
 * pas de jeton ; son contrôle d'accès est le réseau docker). Donc :
 *
 *  1. Aucune étiquette ne porte d'identifiant. Les valeurs viennent d'un
 *     **ensemble fermé connu au build** : nom de file, nom de job, état, issue.
 *     Rien de `job.data`, rien de `job.id`, rien d'un message d'erreur — ni en
 *     valeur, ni en nom d'étiquette, ni dans un texte d'aide.
 *  2. `jobLabel` est une **liste blanche, pas un assainisseur**. Un cuid est
 *     alphanumérique minuscule : il survivrait à n'importe quel filtre de
 *     classe de caractères. Seule l'appartenance à un ensemble figé l'arrête.
 *  3. La profondeur est **par file, délibérément pas par tenant**. Une
 *     ventilation par tenant sur une surface non authentifiée serait la fuite.
 *
 * Budget de cardinalité, chiffré pour que la prochaine addition soit un choix
 * et non une surprise : profondeur 3 files × 8 états = **24** · échecs de
 * collecte 3 · compteur d'issues 19 couples (file, job) × 3 issues = **57** ·
 * histogramme 19 couples × 12 séries (10 seaux + `_sum` + `_count`) = **228**.
 * Total ≈ **312 séries**. C'est l'histogramme qui grandit : **chaque nouvelle
 * valeur de `NotificationKind` coûte ~12 séries**.
 *
 * ---------------------------------------------------------------------------
 * PAS DE DLQ — ce n'est pas un oubli (D2 / DNC-06)
 * ---------------------------------------------------------------------------
 * BullMQ n'a **pas** de dead-letter queue : un job qui épuise ses `attempts`
 * reste dans l'ensemble `failed`. Exposer `dlq_depth` décrirait un mécanisme
 * que ce système n'a pas. Ce qu'on expose est ce qui existe : la taille de
 * l'ensemble `failed`, et un compteur qui sépare un échec **réintentable**
 * d'un échec **terminal** — la question opérationnelle qu'un panneau « DLQ »
 * pose réellement.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI ICI ET PAS DANS L'API (D1 / DNC-01)
 * ---------------------------------------------------------------------------
 * Les deux processus tiennent une connexion BullMQ aux trois files : les deux
 * *pourraient* publier la profondeur. Deux sources de scrape pour un même
 * nombre, c'est DNC-01 à l'étage de l'observabilité — un graphe qui se
 * contredit apprend aux opérateurs à se méfier du graphe. La profondeur étant
 * une propriété de la **file** et non du **process**, elle est publiée par
 * exactement un process : le worker. L'API ne garde que ce qui la décrit
 * elle-même (sa surface HTTP). Voir `docs/adr/ADR-028-queue-metrics-single-collector.md`.
 */

/* ------------------------------------------------------------------ *
 * Ensembles fermés, figés au build
 * ------------------------------------------------------------------ */

/**
 * Les files instrumentées. **C'est l'entrée du contrôle 9 de
 * `scripts/observability-check.js`** : il compare cet ensemble à celui des
 * files réellement *enregistrées* (lu des deux modules `queue.module` bâtis,
 * via les jetons `BullQueue_*` que produit `BullModule.registerQueue`) et
 * échoue dans les **deux** sens.
 *
 * Ces trois littéraux sont volontairement redéclarés ici plutôt qu'importés de
 * `../queue/queue.module` : cet import tirerait `@nestjs/bullmq` dans le graphe
 * que la gate charge (voir l'en-tête). Le prix de cette redéclaration est
 * exactement ce que le contrôle 9 paie — et c'est aussi ce qui, pour la
 * première fois, fait comparer les deux blocs de constantes que personne ne
 * comparait (R-26).
 */
export const INSTRUMENTED_QUEUES = ['exports', 'notifications-email', 'imports'] as const;

export type InstrumentedQueue = (typeof INSTRUMENTED_QUEUES)[number];

/**
 * Les états BullMQ dont on publie la profondeur.
 *
 * **Huit, pas six** — et c'est une correction mesurée, pas une extension de
 * périmètre. `bullmq@5.76.8` `QueueGetters.sanitizeJobTypes` (classes/queue-getters.js:46-65)
 * renvoie, sans argument, `active, completed, delayed, failed, paused,
 * prioritized, waiting, waiting-children`. Les six états « classiques » sont
 * un modèle mental BullMQ v4 : un job ajouté avec `priority` atterrit dans
 * `prioritized` et **jamais** dans `waiting`, un enfant de flow attend dans
 * `waiting-children`. Un jauge à six états afficherait donc `0` sur une file
 * réellement engorgée — un graphe qui ment est pire que pas de graphe, et
 * annoncer « chaque état BullMQ » en en couvrant six sur huit serait DNC-06.
 *
 * Aucun site d'enqueue n'utilise `priority` ni `parent` **aujourd'hui** ; c'est
 * précisément le genre d'invariant supposé (R-26) qu'on refuse de faire porter
 * à une métrique. On publie les huit : les deux séries supplémentaires valent
 * zéro tant que personne ne s'en sert, et elles ne mentent pas le jour où
 * quelqu'un s'en sert.
 *
 * Note : `getJobCounts('waiting')` ajoute silencieusement `'paused'`
 * (queue-getters.js:49-51). Comme les huit sont demandés explicitement, cette
 * addition est un doublon dédupliqué et non une surprise.
 */
export const JOB_STATES = [
  'active',
  'completed',
  'delayed',
  'failed',
  'paused',
  'prioritized',
  'waiting',
  'waiting-children',
] as const;

/**
 * Le nom d'état, en **union de littéraux** et non en `string`.
 *
 * C'est ce qui fait tenir « huit états, pas six » au compilateur plutôt qu'à la
 * relecture : `QueueDepthSource.getJobCounts` prend ce type, et le seul site
 * qui branche une vraie file (`queue-depth.collector.ts`) le passe au
 * `getJobCounts(...types: JobType[])` de BullMQ. Un état mal orthographié —
 * `'prioritzed'` — devient donc une **erreur de compilation** là-bas, au lieu
 * d'être accepté en silence puis rendu `0` sur une file engorgée : exactement
 * le défaut que ce slice a mesuré et refuse de réintroduire par sa propre
 * couture. `bullmq` n'est pas importé ici (règle d'import de l'en-tête) — c'est
 * le collecteur qui porte la confrontation des deux vocabulaires.
 */
export type JobStateName = (typeof JOB_STATES)[number];

/** Les trois issues d'un job. D2 : `failed_terminal` est la réponse au « DLQ ». */
export const JOB_OUTCOMES = ['completed', 'failed_retryable', 'failed_terminal'] as const;

export type JobOutcome = (typeof JOB_OUTCOMES)[number];

/**
 * Étiquette de repli pour un nom de job hors liste blanche.
 *
 * Miroir de `UNMATCHED_ROUTE = '<unmatched>'` dans
 * `apps/api/src/modules/metrics/metrics.registry.ts` — même rôle, même forme,
 * délibérément pas un troisième style. Un nom non listé est une **perte de
 * détail**, jamais une fuite : c'est cette asymétrie qui rend une liste blanche
 * imparfaitement synchronisée survivable, alors qu'une liste blanche absente
 * ne l'est pas.
 */
export const OTHER_JOB = '<other>';

/**
 * Les noms de jobs réellement produits, par file.
 *
 * **Dites franchement lesquels sont comparés et lesquels sont tenus à la main**
 * (R-26 : un quatrième bloc littéral que rien ne compare serait ce slice en
 * train d'écrire sa propre trouvaille) :
 *
 *  - `exports` — **comparé, pas copié.** `queue-metrics.spec.ts` (T5) assère
 *    l'égalité avec `Object.keys(GENERATORS)` de
 *    `../../modules/exports/exports.processor.ts`. Ajouter un générateur sans
 *    l'instrumenter fait rougir ce test.
 *  - `notifications-email` — **comparé, pas copié.** Le même spec assère
 *    l'égalité avec `Object.values(NotificationKind)` de `@prisma/client`. La
 *    liste est redéclarée *ici* (et non importée) pour tenir la règle d'import
 *    de l'en-tête ; c'est le test qui porte la comparaison, pas l'import.
 *  - `imports` — **tenu à la main**, et voici la conséquence : les producteurs
 *    vivent dans `apps/api/src/modules/imports/imports.service.ts:258` et `:317`
 *    (`queue.add('apply', …)` / `queue.add('rollback', …)`) et le worker ne peut
 *    pas importer `apps/api`. Un troisième nom de job ajouté là-bas serait
 *    compté sous `<other>` — détail perdu, rien de fuité.
 */
export const JOB_NAMES_BY_QUEUE: Readonly<Record<InstrumentedQueue, readonly string[]>> = {
  // Les cinq clés de GENERATORS (exports.processor.ts) — comparé par T5.
  exports: [
    'grades_xlsx',
    'attendance_xlsx',
    'enrollment_xlsx',
    'report_card_pdf',
    'audit_csv',
  ],
  // Les valeurs de NotificationKind (@prisma/client) — comparé par T5.
  'notifications-email': [
    'announcement',
    'alert',
    'grade_published',
    'enrollment_status',
    'lesson_published',
    'system',
    'weekly_digest',
    'message',
    'remediation',
  ],
  // Tenu à la main — apps/api/src/modules/imports/imports.service.ts:258,317.
  imports: ['apply', 'rollback'],
};

/** Index de recherche, construit une fois : la liste blanche est chaude à chaque job. */
const JOB_NAME_SETS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(JOB_NAMES_BY_QUEUE).map(([queue, names]) => [queue, new Set(names)]),
);

/**
 * Étiquette `job` d'un job — **le contrôle de sécurité** (D3, G-TENANT).
 *
 * Liste blanche stricte : le nom n'est renvoyé que s'il appartient à
 * l'ensemble déclaré au build pour cette file. Tout le reste — un cuid, une
 * chaîne vide, 300 caractères, un fragment `label="` injecté — devient
 * `<other>`. Une file inconnue n'a pas de liste blanche, donc tout y devient
 * `<other>` : c'est le défaut sûr, pas un cas oublié.
 */
export function jobLabel(queue: string, name: unknown): string {
  if (typeof name !== 'string' || name.length === 0) return OTHER_JOB;
  const allowed = JOB_NAME_SETS.get(queue);
  if (!allowed) return OTHER_JOB;
  return allowed.has(name) ? name : OTHER_JOB;
}

/** Étiquette `queue` — même règle, un seul seau pour tout ce qui n'est pas instrumenté. */
function queueLabel(queue: unknown): string {
  if (typeof queue !== 'string') return OTHER_JOB;
  return (INSTRUMENTED_QUEUES as readonly string[]).includes(queue) ? queue : OTHER_JOB;
}

/* ------------------------------------------------------------------ *
 * Les métriques — déclarées à la portée du module (F-13 / PF-56)
 *
 * Construire ces objets dans le constructeur d'un provider Nest ferait lever
 * prom-client (« a metric with the name … has already been registered ») dès
 * qu'un spec compile deux fois le module de test du worker — et
 * `imports.processor.spec.ts` / `notifications-email.processor.spec.ts`
 * existent déjà. Portée module = une seule construction, quel que soit le
 * nombre de bootstraps.
 * ------------------------------------------------------------------ */

/**
 * Profondeur de file par état.
 *
 * **Pas** `pilotage_queue_jobs` : ce nom se lirait comme la base non suffixée
 * de `pilotage_queue_jobs_total`, et l'outillage Prometheus traite ce couple
 * comme une seule métrique.
 *
 * L'étiquette `app="worker"` est héritée du registre — ne pas la redéclarer.
 */
export const queueDepth = new Gauge({
  name: 'pilotage_queue_depth',
  help: 'Profondeur des files BullMQ par état, mesurée à l’instant du scrape',
  labelNames: ['queue', 'state'] as const,
  registers: [registry],
  async collect() {
    // Ce callback tourne à chaque `registry.metrics()`. Il ne doit JAMAIS
    // rejeter : `version-server.ts` transforme un rejet du registre en 500, et
    // `scripts/observability-check.js` en « the check itself could not run ».
    await collectQueueDepth();
  },
});

/**
 * Échecs de collecte de profondeur, par file.
 *
 * Pourquoi ce compteur existe : le collecteur **avale ses erreurs** (D4), et un
 * collecteur qui avale ses erreurs en silence rendrait une panne Redis comme un
 * système en bonne santé — DNC-06 par omission. La dégradation doit être
 * *observable* sans être *bloquante* : la mesure se dégrade, la gate, elle,
 * reste en échec dur (DNC-08).
 *
 * Il est **initialisé à zéro** pour chaque file instrumentée, donc il est
 * présent et honnête sans aucun Redis — ce qui donne aussi au contrôle 9 une
 * famille portant l'étiquette `queue` à confronter à `INSTRUMENTED_QUEUES`
 * (une constante exportée que rien n'exécute reproduirait exactement le défaut
 * que ce contrôle existe pour fermer).
 */
export const queueDepthCollectionFailures = new Counter({
  name: 'pilotage_queue_depth_collection_failures_total',
  help: 'Collectes de profondeur de file ayant échoué ou dépassé leur délai',
  labelNames: ['queue'] as const,
  registers: [registry],
  async collect() {
    // Le MÊME `collect` que la jauge, et c'est mesuré, pas décoratif :
    // `Registry.metrics()` (prom-client 15.1.3, lib/registry.js:83-99) mappe
    // les métriques en **parallèle** et chacune fige ses valeurs juste après
    // SON propre `collect()`. Un compteur incrémenté depuis le `collect()`
    // d'une AUTRE métrique arriverait donc au scrape suivant — une panne Redis
    // rendue avec un scrape de retard, c'est-à-dire la panne rendue à côté du
    // moment où elle s'est produite. `collectQueueDepth` est dédupliqué par
    // scrape : les deux appels attendent la même collecte, une seule a lieu.
    await collectQueueDepth();
  },
});

export const queueJobsTotal = new Counter({
  name: 'pilotage_queue_jobs_total',
  help: 'Jobs BullMQ terminés, par file, type de travail et issue',
  labelNames: ['queue', 'job', 'outcome'] as const,
  registers: [registry],
});

/**
 * Durée de traitement d'un job, en secondes (convention Prometheus).
 *
 * Seaux volontairement plus larges que ceux de l'API : un `report_card_pdf`
 * n'est pas une requête, et le plafond à 10 s de l'API mettrait tout export
 * réel dans `+Inf`.
 */
export const queueJobDuration = new Histogram({
  name: 'pilotage_queue_job_duration_seconds',
  help: 'Durée de traitement des jobs BullMQ, par file et type de travail',
  labelNames: ['queue', 'job'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

// Zéro honnête, dès l'import : voir le commentaire de la métrique ci-dessus.
for (const queue of INSTRUMENTED_QUEUES) queueDepthCollectionFailures.inc({ queue }, 0);

/* ------------------------------------------------------------------ *
 * Issue et durée d'un job
 * ------------------------------------------------------------------ */

/**
 * Forme minimale d'un job BullMQ dont dépend l'instrumentation.
 *
 * Déclarée ici plutôt qu'importée de `bullmq` pour deux raisons : la règle
 * d'import de l'en-tête, et la leçon de `RouteLabelSource` côté API — une
 * évaluation qu'on ne peut pas piloter avec des objets synthétiques ne peut
 * démontrer que « ce dépôt va bien aujourd'hui ».
 *
 * **`discarded` n'y figure délibérément pas.** `Job.discarded` est déclaré
 * `protected` (bullmq@5.76.8 `classes/job.d.ts:136`), et TypeScript refuse
 * d'assigner une instance de classe portant un membre `protected` à un type
 * structurel qui l'exige `public` — un vrai `Job` ne serait donc plus assignable
 * à cette interface, ce qui rendrait les trois processeurs rouges. La propriété
 * est **lue quand même**, défensivement, dans `classifyFailure` : elle existe
 * bien sur l'instance à l'exécution, `protected` n'est une contrainte que pour
 * le système de types. La sémantique de la frontière réintentable / terminal
 * est inchangée.
 */
export interface JobOutcomeSource {
  readonly name?: unknown;
  readonly attemptsMade?: unknown;
  readonly processedOn?: unknown;
  readonly finishedOn?: unknown;
  readonly opts?: { readonly attempts?: unknown } | undefined;
}

/**
 * Le cœur arithmétique de la frontière réintentable / terminal (D2).
 *
 * `attemptsMade` est lu **au moment de l'événement `failed`**, donc après
 * l'incrément que `Job.moveToFailed` fait en fin de méthode
 * (bullmq classes/job.js:548) — l'événement est émis juste après
 * (classes/worker.js:659). BullMQ décide de réessayer avec
 * `attemptsMade_avant + 1 < opts.attempts`, ce qui est exactement
 * `attemptsMade_observé < opts.attempts`.
 *
 * `attempts` absent → `?? 1` → terminal. Ce n'est pas arbitraire : le défaut
 * réel de BullMQ est `attempts: 0` (classes/job.js:84-86), donc un job sans
 * `attempts` n'est **jamais** réessayé. Annoncer « réintentable » pour un job
 * qui ne sera jamais réessayé serait la métrique qui décrit un mécanisme
 * absent — dans le fichier écrit pour éviter ça.
 */
export function isTerminalFailure(attemptsMade: unknown, attempts: unknown): boolean {
  // `attemptsMade` illisible → terminal. Le défaut sûr est celui qui ne promet
  // pas un réessai qu'on ne peut pas justifier : annoncer « réintentable » sur
  // une donnée manquante, c'est un opérateur qui attend un réessai qui
  // n'arrivera peut-être jamais.
  if (typeof attemptsMade !== 'number' || !Number.isFinite(attemptsMade)) return true;
  const max = typeof attempts === 'number' && Number.isFinite(attempts) ? attempts : 1;
  return attemptsMade >= max;
}

/**
 * La classification complète, **miroir du prédicat de BullMQ**
 * (`Job.shouldRetryJob`, classes/job.js:483-486) et non d'une paraphrase.
 *
 * Trois divergences que l'arithmétique seule raterait, chacune produisant un
 * faux « réintentable » — c'est-à-dire un opérateur qui attend un réessai qui
 * n'arrivera pas :
 *  - `job.discard()` → terminal alors qu'il reste des tentatives ;
 *  - `UnrecoverableError` levée par un processeur → terminal dès la 1re sur 3 ;
 *  - `attempts` absent → jamais réessayé (voir `isTerminalFailure`).
 */
export function classifyFailure(job: JobOutcomeSource, error?: unknown): JobOutcome {
  // Lecture défensive : `discarded` est `protected` côté types (voir
  // `JobOutcomeSource`), présent côté instance. C'est bien `job.discard()` qui
  // est observé ici, pas une paraphrase de celui-ci.
  if ((job as { discarded?: unknown }).discarded === true) return 'failed_terminal';
  if (isUnrecoverable(error)) return 'failed_terminal';
  return isTerminalFailure(job.attemptsMade, job.opts?.attempts)
    ? 'failed_terminal'
    : 'failed_retryable';
}

function isUnrecoverable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { name?: unknown }).name === 'UnrecoverableError';
}

/**
 * Durée observée d'un job, en secondes, ou `null`.
 *
 * `processedOn` et `finishedOn` sont **optionnels** dans les types BullMQ. Une
 * borne manquante veut dire « pas d'observation », jamais `0` : un seau à zéro
 * seconde est un mensonge qui déplace le p95.
 */
function durationSeconds(job: JobOutcomeSource): number | null {
  const started = job.processedOn;
  const finished = job.finishedOn;
  if (typeof started !== 'number' || typeof finished !== 'number') return null;
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return null;
  const seconds = (finished - started) / 1000;
  return seconds >= 0 ? seconds : null;
}

/**
 * Enregistre l'issue d'un job — **le seul endroit** où le compteur et
 * l'histogramme sont écrits.
 *
 * Les trois processeurs n'ont chacun qu'un appel d'une ligne vers ici : une
 * seule implémentation du nombre, trois sites d'appel (la préoccupation
 * « un nombre, trois implémentations » de DNC-01 au niveau du code).
 *
 * Total par construction : un throw dans un écouteur d'événement BullMQ est un
 * rejet non capturé dans le process du worker — l'instrumentation deviendrait
 * une cause de panne, exactement ce que l'en-tête de `version-server.ts`
 * interdit en français dans le fichier voisin.
 */
export function observeJobOutcome(
  queue: string,
  job: JobOutcomeSource | undefined,
  outcome: JobOutcome,
): void {
  try {
    const labels = {
      queue: queueLabel(queue),
      job: jobLabel(queue, job?.name),
    };
    queueJobsTotal.inc({ ...labels, outcome }, 1);

    const seconds = job ? durationSeconds(job) : null;
    if (seconds !== null) queueJobDuration.observe(labels, seconds);
  } catch {
    // Une panne d'instrumentation ne doit jamais dégrader le service.
  }
}

/** Raccourci d'appel pour `@OnWorkerEvent('completed')`. */
export function observeJobCompleted(queue: string, job: JobOutcomeSource | undefined): void {
  observeJobOutcome(queue, job, 'completed');
}

/**
 * Raccourci d'appel pour `@OnWorkerEvent('failed')`.
 *
 * `job` peut être `undefined` : `worker.js:659` émet `('failed', job, err)` et
 * il existe des chemins où le job n'a pas pu être chargé. Un handler qui ferait
 * `job.name` tuerait le process.
 */
export function observeJobFailed(
  queue: string,
  job: JobOutcomeSource | undefined,
  error?: unknown,
): void {
  const outcome = job ? safeClassify(job, error) : 'failed_terminal';
  observeJobOutcome(queue, job, outcome);
}

function safeClassify(job: JobOutcomeSource, error: unknown): JobOutcome {
  try {
    return classifyFailure(job, error);
  } catch {
    return 'failed_terminal';
  }
}

/* ------------------------------------------------------------------ *
 * Le collecteur de profondeur (D4)
 * ------------------------------------------------------------------ */

/**
 * Source structurelle de profondeur — **pas** le `Queue` de bullmq.
 *
 * C'est la même raison d'être que `RouteLabelSource` côté API : les tests
 * pilotent le collecteur avec des objets simples, y compris un objet dont la
 * promesse ne se résout jamais.
 */
export interface QueueDepthSource {
  readonly queue: string;
  getJobCounts(...states: JobStateName[]): Promise<Record<string, number>>;
}

/**
 * Délai maximum d'une collecte, par file.
 *
 * Confortablement sous le `scrape_timeout` de Prometheus. Mesuré sur
 * `prom-client@15.1.3` : un `collect()` dont la promesse ne se résout jamais
 * fait **pendre** `registry.metrics()` indéfiniment — donc un scrape qui ne
 * répond pas, et une étape 9 de la gate qui ne sort pas. Le vrai mode de panne
 * de Redis n'est pas le rejet, c'est l'attente : `ioredis` met par défaut
 * `enableOfflineQueue: true` avec un `retryStrategy` qui monte jusqu'à 20 s,
 * donc `getJobCounts()` contre un Redis mort ne rejette pas vite — il attend.
 */
export const DEPTH_COLLECT_TIMEOUT_MS = 2_000;

let depthSources: readonly QueueDepthSource[] = [];

/**
 * Branche les files sur le collecteur. **Remplace**, n'empile jamais : appelée
 * deux fois (deux bootstraps dans une même suite de tests), elle est
 * idempotente.
 */
export function registerQueueDepthSources(sources: readonly QueueDepthSource[]): void {
  depthSources = sources.filter(
    (source): source is QueueDepthSource =>
      !!source && typeof source.queue === 'string' && typeof source.getJobCounts === 'function',
  );
}

/** Nombre de sources branchées — lu par les tests, pas par la production. */
export function queueDepthSourceCount(): number {
  return depthSources.length;
}

type Settled =
  | { readonly ok: true; readonly counts: Record<string, number> }
  | { readonly ok: false; readonly reason: 'error' | 'timeout' };

/**
 * Course entre la lecture et une échéance, qui **ne peut ni rejeter ni fuir**.
 *
 *  - le rejet éventuel de `pending` est capturé **avant** la course, donc un
 *    rejet tardif (après que l'échéance a gagné) ne remonte jamais en
 *    `unhandledRejection` ;
 *  - le timer est `unref()` — sinon le worker ne s'arrête plus sur SIGTERM et
 *    jest signale une poignée ouverte ;
 *  - le timer est **effacé sur le chemin gagnant**, sinon c'est une poignée par
 *    scrape.
 */
function raceWithDeadline(
  pending: Promise<Record<string, number>>,
  timeoutMs: number,
): Promise<Settled> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settled: Promise<Settled> = pending.then(
    (counts) => ({ ok: true, counts }) as Settled,
    () => ({ ok: false, reason: 'error' }) as Settled,
  );

  const deadline: Promise<Settled> = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: 'timeout' }), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  });

  return Promise.race([settled, deadline]).then((result) => {
    if (timer !== undefined) clearTimeout(timer);
    return result;
  });
}

async function collectOne(source: QueueDepthSource): Promise<void> {
  const queue = queueLabel(source.queue);
  let result: Settled;
  try {
    // `Promise.resolve().then(...)` : un `getJobCounts` qui lève de façon
    // SYNCHRONE ne doit pas court-circuiter la garde ci-dessous.
    result = await raceWithDeadline(
      Promise.resolve().then(() => source.getJobCounts(...JOB_STATES)),
      DEPTH_COLLECT_TIMEOUT_MS,
    );
  } catch {
    queueDepthCollectionFailures.inc({ queue }, 1);
    return;
  }

  if (!result.ok) {
    // Dégradation vers des échantillons PÉRIMÉS, jamais vers zéro : pas de
    // `reset()`. Un opérateur qui lit « 0 en attente » pendant une panne Redis
    // est plus mal informé qu'un opérateur qui lit un nombre périmé, parce que
    // zéro est une valeur sur laquelle il agira. La panne, elle, est visible
    // sur le compteur ci-dessous.
    queueDepthCollectionFailures.inc({ queue }, 1);
    return;
  }

  const counts = result.counts;
  if (!counts || typeof counts !== 'object') {
    queueDepthCollectionFailures.inc({ queue }, 1);
    return;
  }

  for (const state of JOB_STATES) {
    const value = (counts as Record<string, unknown>)[state];
    // Un état absent laisse l'échantillon précédent en place — même règle que
    // ci-dessus : on n'écrit pas un zéro qu'on ne connaît pas.
    if (typeof value === 'number' && Number.isFinite(value)) {
      queueDepth.set({ queue, state }, value);
    }
  }
}

let inFlight: Promise<void> | null = null;

/**
 * La collecte, appelée par le `collect()` des DEUX métriques concernées, et
 * **dédupliquée par scrape** : le second appelant attend la même collecte, il
 * n'en déclenche pas une seconde. C'est ce qui fait que la profondeur et le
 * compteur d'échecs décrivent le même instant.
 *
 * Sans source branchée — l'état de `scripts/observability-check.js` et de tous
 * les tests qui ne branchent rien — c'est un no-op qui se résout immédiatement.
 *
 * Ne rejette jamais.
 */
export function collectQueueDepth(): Promise<void> {
  if (inFlight) return inFlight;

  const sources = depthSources;
  if (sources.length === 0) return Promise.resolve();

  const done = (): void => {
    inFlight = null;
  };
  // Ceinture ET bretelles : `collectOne` est déjà total, mais un rejet qui
  // remonterait jusqu'ici ferait rejeter `registry.metrics()`, donc un 500 sur
  // l'exposition et un « the check itself could not run » sur la gate.
  const run = Promise.all(sources.map((source) => collectOne(source))).then(done, done);
  inFlight = run;
  return run;
}
