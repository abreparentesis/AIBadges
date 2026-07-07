// Storage keys shared between the chatgpt.com tabs (orchestrator + extraction workers, see
// chatgpt-autorun.ts) and the service worker (entrypoints/background.ts) for the parallel
// extraction phase. They live in their own module so the service worker bundle can name a key
// without pulling in the whole capture/analysis graph.

// Per-batch extraction result, written by the worker tab (or by the service worker as a fast-fail
// when the worker tab never became reachable): JSON of { units: RawUnit[] } or { failed: true }.
export const CG_BATCH_OUT_PREFIX = 'aibadges:cg:batchout:';
// Per-batch scratch conversation id, recorded by the worker as soon as it binds one so that an
// interrupted run's next attempt can still delete it (workers normally delete their own).
export const CG_BATCH_CONVO_PREFIX = 'aibadges:cg:batchconvo:';
// Service-worker-owned map of live extraction worker tabs: { [tabId]: { batch, started? } }.
// Kept in storage so a service-worker restart mid-run can still find and close them.
export const CG_WORKERS_KEY = 'aibadges:cg:workers';

export const batchOutKey = (batch: number): string => `${CG_BATCH_OUT_PREFIX}${batch}`;
export const batchConvoKey = (batch: number): string => `${CG_BATCH_CONVO_PREFIX}${batch}`;
