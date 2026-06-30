import type { ModelCaller } from '../../inference/types';
import { Trajectory, TrajectoryShiftSchema, EvidenceUnit } from '../types';
import { parseJsonResponse } from '../json';
import { trajectoryPrompt } from '../../prompts';
import { retrying, LENS_TIMEOUT_MS } from './retry';
import { z } from 'zod';

export async function trajectoryLens(evidence: EvidenceUnit[], caller: ModelCaller, model?: string): Promise<Trajectory> {
  if (evidence.length === 0) {
    return { window: { earlyTo: '', recentFrom: '' }, shifts: [] };
  }
  const sorted = [...evidence].sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0));
  const midIdx = Math.floor((sorted.length - 1) / 2);
  const earlyTo = sorted[midIdx].timestamp;
  const recentFrom = sorted[Math.min(midIdx + 1, sorted.length - 1)].timestamp;
  const shifts = await retrying('trajectory', 2, async () => {
    const raw = await caller.complete(trajectoryPrompt(sorted), { model, timeoutMs: LENS_TIMEOUT_MS });
    try {
      const obj = parseJsonResponse(raw) as { shifts?: unknown };
      const parsed = z.array(TrajectoryShiftSchema).safeParse(obj?.shifts ?? []);
      return parsed.success ? parsed.data : null;
    } catch { return null; }
  });
  return { window: { earlyTo, recentFrom }, shifts: shifts ?? [] };
}
