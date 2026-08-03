/**
 * Base ESLint **flat** config — TypeScript + Prettier.
 *
 * WHY FLAT AND NOT `.eslintrc`
 * ---------------------------
 * The repo depends on ESLint 9, which stopped reading `.eslintrc.*` by default.
 * Every package therefore exited 2 with "couldn't find an eslint.config file" —
 * the `lint` stage of `scripts/ci-gate.sh` had never once passed (PF-70), while
 * turbo replayed pre-bump cache entries as ✓. A gate that cannot run is worse
 * than no gate, because it gets reported as green.
 *
 * Consumed as an array so a package can spread it and append its own layers:
 *
 *   const base = require('@pilotage/eslint-config/base');
 *   module.exports = [...base, { rules: { 'no-console': 'off' } }];
 */
const js = require('@eslint/js');
const tseslint = require('@typescript-eslint/eslint-plugin');
const importPlugin = require('eslint-plugin-import');
const prettier = require('eslint-config-prettier');
const globals = require('globals');

/** Every TypeScript extension the workspace actually contains. */
const TS_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
const JS_FILES = ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];

/**
 * Paths no package should lint. Flat config has no `.eslintignore`, so this is
 * the only ignore mechanism — it must be complete or `eslint .` walks `dist/`.
 */
const ignores = [
  '**/dist/**',
  '**/.next/**',
  '**/build/**',
  '**/node_modules/**',
  '**/coverage/**',
  '**/.turbo/**',
  '**/generated/**',
  '**/*.d.ts',
];

module.exports = [
  { ignores },

  // ---- Plain JS (config files, scripts, tooling) -------------------------
  {
    files: JS_FILES,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules },
  },

  // ---- TypeScript --------------------------------------------------------
  // typescript-eslint ships its flat preset as a 3-element array (base,
  // eslint-recommended overrides, recommended rules). Scope each element to TS
  // files so the JS layer above keeps its own parser.
  ...tseslint.configs['flat/recommended'].map((layer) => ({ ...layer, files: TS_FILES })),

  {
    files: TS_FILES,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
        node: true,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs['flat/eslint-recommended'].rules,
      ...tseslint.configs['flat/recommended'][2].rules,
      ...importPlugin.flatConfigs.recommended.rules,
      ...importPlugin.flatConfigs.typescript.rules,

      // TypeScript already proves identifiers resolve; the flat `no-undef`
      // otherwise fires on every ambient type and DOM global.
      'no-undef': 'off',

      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      'import/order': ['warn', { 'newlines-between': 'always', alphabetize: { order: 'asc' } }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },

  // Prettier last — it only switches rules off, so nothing may override it.
  { rules: prettier.rules },
];
