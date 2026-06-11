/**
 * The import handler registry now lives in the shared `@pilotage/imports-core`
 * package (E11-S1) so the API (validate) and worker (async apply) share ONE
 * implementation byte-for-byte. Re-exported here so existing in-module imports
 * (`./handlers`) keep working without churn.
 */
export { getHandler, listHandlers } from '@pilotage/imports-core';
