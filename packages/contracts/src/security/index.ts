export * from './branding-css';
export * from './csp';
export * from './csv-injection';
// S-E05-8 / ADR-082 — la taxonomie d'échec du grant direct (§D1) et la règle
// d'enrôlement MFA (§D2). La chaîne d'export est complète par ces deux lignes :
// `src/index.ts:10` fait déjà `export * from './security'`, et
// `tsconfig.build.json` inclut `src/**/*`, donc les deux modules émettent vers
// `dist/security/`. Le cliquet asserte CETTE chaîne, et vérifie la SURFACE
// D'EXPORT depuis `dist` — jamais un nom de fichier.
export * from './direct-grant-failure';
export * from './mfa-enrolment-policy';
