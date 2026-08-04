import { sanitizeSpanAttributes, sanitizeSpanName, type SpanAttributes } from './tracing-policy';

/**
 * Enveloppe d'exportateur qui applique la politique de caviardage juste avant
 * que les spans quittent le process (S-E02-14 / PF-78, preuve G-TENANT).
 *
 * ---------------------------------------------------------------------------
 * POURQUOI À L'EXPORT, ET PAS AILLEURS
 * ---------------------------------------------------------------------------
 * Trois emplacements étaient possibles, et deux sont des pièges :
 *
 *  • **Configurer chaque instrumentation** pour qu'elle n'écrive pas l'URL
 *    résolue. C'est le plus précis et le moins fiable : chaque instrumentation
 *    a ses propres options, une montée de version peut ajouter un attribut, et
 *    l'oubli est silencieux. C'est la forme « on a pensé à tous les cas ».
 *  • **Un `SpanProcessor.onEnd`** : les attributs d'un `ReadableSpan` y sont en
 *    lecture seule, donc il faudrait de toute façon reconstruire le span.
 *  • **L'export** — le dernier point par lequel *tout* passe, quelle que soit
 *    l'instrumentation qui a produit le span. Une instrumentation ajoutée
 *    demain traverse ce code sans que personne y pense.
 *
 * Le choix suit la même logique que `metrics.registry.ts` : la surface est non
 * authentifiée (Jaeger ne demande pas de jeton, son contrôle d'accès *est* le
 * réseau docker), donc la charge utile doit être sûre par construction et pas
 * par vigilance.
 *
 * Les types sont **structurels** : ce fichier n'importe rien d'OpenTelemetry,
 * pour que `@pilotage/contracts` — que `apps/web` importe aussi — ne traîne pas
 * le SDK dans son bundle. Le prix est une poignée d'interfaces minimales ; le
 * gain est que l'API et le worker partagent une seule copie de la règle.
 */

/** Forme minimale d'un span exportable dont dépend le caviardage. */
export interface RedactableSpan {
  readonly name: string;
  readonly attributes: SpanAttributes;
}

/** Forme minimale d'un résultat d'export OpenTelemetry. */
export interface ExportResultLike {
  code: number;
  error?: Error;
}

/** Forme minimale d'un `SpanExporter` OpenTelemetry. */
export interface SpanExporterLike<S extends RedactableSpan = RedactableSpan> {
  export(spans: S[], resultCallback: (result: ExportResultLike) => void): void;
  shutdown(): Promise<void>;
  forceFlush?(): Promise<void>;
}

/**
 * Produit une copie caviardée d'un span.
 *
 * `Object.create(span)` plutôt qu'un littéral : un `ReadableSpan` porte des
 * méthodes (`spanContext()`, `ended`, `duration`…) que le SDK et l'exportateur
 * OTLP lisent tous les deux. Les recopier à la main serait une liste à tenir à
 * jour, et un champ oublié se traduirait par une trace incomplète plutôt que
 * par une erreur. Ici le span d'origine reste le prototype, et seules `name` et
 * `attributes` sont masquées.
 */
export function redactSpan<S extends RedactableSpan>(span: S): S {
  const redacted = Object.create(span) as S;

  Object.defineProperty(redacted, 'name', {
    value: sanitizeSpanName(span.name),
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(redacted, 'attributes', {
    value: sanitizeSpanAttributes(span.attributes),
    enumerable: true,
    configurable: true,
  });

  return redacted;
}

/**
 * Décore un exportateur de spans avec le caviardage.
 *
 * Ne modifie jamais les spans d'origine : le SDK les conserve et les relit
 * (retries, `forceFlush`), et muter un objet qu'un autre composant possède est
 * le genre de couplage qui produit des bugs qu'aucun test unitaire ne voit.
 */
export function withRedaction<S extends RedactableSpan>(
  delegate: SpanExporterLike<S>,
): SpanExporterLike<S> {
  return {
    export(spans, resultCallback) {
      delegate.export(spans.map(redactSpan), resultCallback);
    },
    shutdown() {
      return delegate.shutdown();
    },
    forceFlush() {
      return delegate.forceFlush?.() ?? Promise.resolve();
    },
  };
}
