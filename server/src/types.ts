import { z } from 'zod';

// Distilled-profile schemas, mirrored from the client (client/src/engine/types.ts).
// The backend re-validates incoming profiles against these — the privacy + integrity guard.
// NOTE: there is intentionally NO raw-message or quote-text field anywhere here.

export const BandSchema = z.enum(['emerging', 'developing', 'proficient', 'advanced']);
export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);

export const ClaimSchema = z.object({
  claim: z.string(),
  evidenceIds: z.array(z.string()),
  confidence: ConfidenceSchema,
});

const BandedSchema = z.object({ band: BandSchema, evidenceIds: z.array(z.string()) });

export const CapabilitySchema = z.object({
  aiFluency: z.object({
    delegation: BandedSchema,
    description: BandedSchema,
    discernment: BandedSchema,
    diligence: BandedSchema,
  }),
  yeggeStage: z.object({ stage: z.number().int().min(1).max(8), evidenceIds: z.array(z.string()) }),
  domains: z.array(z.object({ name: z.string(), band: BandSchema, evidenceIds: z.array(z.string()) })),
});

export const TrajectoryShiftSchema = z.object({
  dimension: z.string(),
  direction: z.enum(['rising', 'falling', 'steady']),
  velocity: z.enum(['slow', 'moderate', 'fast']),
  evidenceIds: z.array(z.string()),
});

export const TrajectorySchema = z.object({
  window: z.object({ earlyTo: z.string(), recentFrom: z.string() }),
  shifts: z.array(TrajectoryShiftSchema),
});

export const ProfileSchema = z.object({
  version: z.number().int(),
  computedAt: z.string(),
  modelProvenance: z.string(),
  sourceWindow: z.object({ fromDate: z.string(), toDate: z.string(), conversationCount: z.number().int() }),
  thinking: z.array(ClaimSchema),
  capability: CapabilitySchema.optional(), // optional after the personality pivot (client no longer sends it)
  trajectory: TrajectorySchema,
});

// Incoming signal shape for POST /v1/signals (the backend mints id/token/timestamps itself).
export const SignalInputSchema = z.array(z.object({
  type: z.enum(['identityCard', 'statBadge', 'trajectorySnippet', 'typeCard']),
  surfacedContent: z.record(z.string(), z.unknown()),
  disclosure: z.enum(['private', 'public']),
  fromVersion: z.number().int().optional(),
}));

export type Profile = z.infer<typeof ProfileSchema>;
export type SignalInput = z.infer<typeof SignalInputSchema>;
