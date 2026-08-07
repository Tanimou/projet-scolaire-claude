import { Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Registre Prometheus du worker (S-E02-13 / PF-56).
 *
 * Le worker n'a pas de surface HTTP métier : il n'y a donc **pas** d'histogramme
 * de latence de requête ici, et prétendre le contraire serait le genre de
 * métrique décorative que ce slice existe pour éviter. Ce fichier expose la
 * santé du process qui draine les files — mémoire, GC, retard de boucle
 * d'événements.
 *
 * Le retard de boucle d'événements est la métrique la plus utile des trois pour
 * un exécuteur de tâches : c'est le signal qui monte quand un job synchrone
 * bloque la boucle et fait silencieusement prendre du retard à toutes les files.
 *
 * ---------------------------------------------------------------------------
 * CE QUI EST DÉSORMAIS COUVERT (S-E02-17) — ce paragraphe disait le contraire
 * ---------------------------------------------------------------------------
 * Jusqu'à `S-E02-17`, ces lignes annonçaient que « profondeur de file, taux
 * d'échec et DLQ ne sont pas exposés ». Les deux premiers le sont maintenant,
 * par `./queue-metrics.ts`, qui s'enregistre sur **ce** registre (et hérite
 * donc de son étiquette `app="worker"`) :
 *
 *  - `pilotage_queue_depth{queue,state}` — profondeur des huit états BullMQ,
 *    lue à l'instant du scrape ;
 *  - `pilotage_queue_jobs_total{queue,job,outcome}` — issue des jobs, avec
 *    l'échec **réintentable** distingué de l'échec **terminal** ;
 *  - `pilotage_queue_job_duration_seconds{queue,job}` — durée de traitement ;
 *  - `pilotage_queue_depth_collection_failures_total{queue}` — les collectes
 *    de profondeur qui ont échoué, pour qu'une panne Redis ne se rende pas
 *    comme un système en bonne santé.
 *
 * **Il n'y a pas de série « DLQ », et ce n'est pas un manque** : BullMQ n'a pas
 * de dead-letter queue, un job qui épuise ses `attempts` reste dans l'ensemble
 * `failed`. Nommer une métrique d'après un mécanisme que ce système n'a pas
 * serait DNC-06. La question qu'un panneau « DLQ » pose vraiment est
 * `outcome="failed_terminal"`.
 *
 * **La profondeur est collectée ici et pas dans l'API** (D1 / DNC-01) : les
 * deux process tiennent une connexion aux trois files, mais la profondeur est
 * une propriété de la file, pas du process. Deux sources de scrape pour un même
 * nombre produisent un graphe qui se contredit. Voir
 * `docs/adr/ADR-028-queue-metrics-single-collector.md`.
 *
 * **Toujours non couvert, et dit franchement :** aucune règle d'alerte, aucun
 * seuil de SLO. Ce que « trop profond » ou « trop lent » veut dire est une
 * décision produit, pas un build ; `PF-56` reste ouvert pour elle.
 */
export const registry = new Registry();

registry.setDefaultLabels({ app: 'worker' });

collectDefaultMetrics({ register: registry });

/**
 * Même littéral que côté API, pour la même raison, et verrouillé par le même
 * genre de test : ce que prom-client produit et ce qu'on annonce doivent rester
 * la même chose.
 */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
