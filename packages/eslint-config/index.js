/**
 * Default entrypoint — the flat base config.
 *
 * The eslintrc-format export that used to live here was unreadable by ESLint 9
 * and is gone (PF-70). Pick the layer that matches the package:
 *   `@pilotage/eslint-config/base`   — TypeScript + Prettier, no environment
 *   `@pilotage/eslint-config/node`   — + Node globals, Jest spec relaxations
 *   `@pilotage/eslint-config/react`  — + browser globals, React + hooks rules
 */
module.exports = require('./base');
