// Run a lens attempt up to `attempts` times.
//
// `run` returns the parsed value on success, or null when the model output failed to
// parse/validate — a content-level problem a fresh generation may fix, so we retry.
// If `run` THROWS, the call itself failed (e.g. the caller exhausted its own HTTP
// backoff on a persistent 429, or a network/abort error). Re-issuing would just hammer
// the same wall, so we surface it and stop. Either way the caller falls back to a floor.
export async function retrying<T>(label: string, attempts: number, run: () => Promise<T | null>): Promise<T | null> {
  for (let n = 1; n <= attempts; n++) {
    let r: T | null;
    try {
      r = await run();
    } catch (e) {
      console.warn(`[aibadges] ${label} lens: call failed, not retrying — ${String(e)}`);
      return null;
    }
    if (r !== null) return r;
  }
  console.warn(`[aibadges] ${label} lens: output failed to parse after ${attempts} attempts`);
  return null;
}

// Lenses ask for sizeable JSON; give them more room than the default per-call budget so
// a slow-but-fine completion is not aborted mid-stream.
export const LENS_TIMEOUT_MS = 100000;
