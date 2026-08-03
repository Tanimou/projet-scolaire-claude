const decoratorMetadata = require('@pilotage/eslint-config/decorator-metadata');
const node = require('@pilotage/eslint-config/node');

module.exports = [
  ...node,

  // `apps/worker` extends `@pilotage/tsconfig/node.json`, the only shared
  // tsconfig that sets `emitDecoratorMetadata`. Autofixing type imports here
  // erases the `design:paramtypes` that Nest resolves constructor dependencies
  // from, and neither typecheck nor build notices. See the layer's header.
  ...decoratorMetadata,
];
