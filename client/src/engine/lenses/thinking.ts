import type { ModelCaller } from '../../inference/types';
import { Claim, ClaimSchema, EvidenceUnit } from '../types';
import { parseJsonResponse } from '../json';
import { thinkingPrompt } from '../../prompts';
import { retrying, LENS_TIMEOUT_MS } from './retry';
import { z } from 'zod';

export async function thinkingLens(evidence: EvidenceUnit[], caller: ModelCaller, model?: string): Promise<Claim[]> {
  const claims = await retrying('thinking', 2, async () => {
    const raw = await caller.complete(thinkingPrompt(evidence), { model, timeoutMs: LENS_TIMEOUT_MS });
    try {
      const parsed = z.array(ClaimSchema).safeParse(parseJsonResponse(raw));
      return parsed.success ? parsed.data : null;
    } catch { return null; }
  });
  return claims ?? [];
}
