import { Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Registre Prometheus du worker (S-E02-13 / PF-56).
 *
 * Le worker n'a pas de surface HTTP métier : il n'y a donc **pas** d'histogramme
 * de latence de requête ici, et prétendre le contraire serait le genre de
 * métrique décorative que ce slice existe pour éviter. Ce qu'on expose est ce
 * qu'on peut réellement mesurer aujourd'hui sans instrumenter BullMQ : la santé
 * du process qui draine les files — mémoire, GC, retard de boucle d'événements.
 *
 * Le retard de boucle d'événements est la métrique la plus utile des trois pour
 * un exécuteur de tâches : c'est le signal qui monte quand un job synchrone
 * bloque la boucle et fait silencieusement prendre du retard à toutes les files.
 *
 * **Non couvert, et dit franchement :** profondeur de file, taux d'échec et
 * DLQ ne sont pas exposés. Ils demandent d'instrumenter les processeurs
 * BullMQ un par un ; c'est un slice à part, pas un oubli.
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
