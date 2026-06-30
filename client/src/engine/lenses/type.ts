import type { ModelCaller } from '../../inference/types';
import { CognitiveType, CognitiveTypeSchema, EvidenceUnit } from '../types';
import { parseJsonResponse } from '../json';
import { typePrompt } from '../../prompts';

// Behavioral 4-letter type inferred from chat evidence. Returns null (not a fake default) when
// there's no evidence or the model output is unusable — the profile's `type` is optional, so a
// failed inference simply shows no Type section rather than a confabulated one.
export async function typeLens(evidence: EvidenceUnit[], caller: ModelCaller, model?: string): Promise<CognitiveType | null> {
  if (evidence.length === 0) return null;
  try {
    const raw = parseJsonResponse(await caller.complete(typePrompt(evidence), { model }));
    const parsed = CognitiveTypeSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
