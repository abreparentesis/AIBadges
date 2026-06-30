import { z } from 'zod';

export const SourceRefSchema = z.object({
  provider: z.enum(['claude', 'chatgpt']),
  conversationId: z.string(),
  messageAnchor: z.string().optional(),
});

export const EvidenceUnitSchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  sourceRef: SourceRefSchema,
  type: z.enum(['decision', 'reasoning_move', 'episode', 'preference']),
  quote: z.string(),
  summary: z.string(),
});

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

// Behavioral 4-letter cognitive type (Jungian dichotomies, public domain). `lean` is 50–100:
// how strongly the chosen `letter` leans (50 = barely, 100 = strongly).
export const TypeAxisSchema = z.object({
  letter: z.string().length(1),
  lean: z.number().min(0).max(100),
  evidenceIds: z.array(z.string()),
});

export const CognitiveTypeSchema = z.object({
  code: z.string().regex(/^[EI][SN][TF][JP]$/),
  summary: z.string(),
  confidence: ConfidenceSchema,
  axes: z.object({ EI: TypeAxisSchema, SN: TypeAxisSchema, TF: TypeAxisSchema, JP: TypeAxisSchema }),
});

export const ProfileSchema = z.object({
  version: z.number().int(),
  computedAt: z.string(),
  modelProvenance: z.string(),
  sourceWindow: z.object({ fromDate: z.string(), toDate: z.string(), conversationCount: z.number().int() }),
  thinking: z.array(ClaimSchema),
  capability: CapabilitySchema.optional(),
  trajectory: TrajectorySchema,
  type: CognitiveTypeSchema.optional(),
  evidence: z.array(EvidenceUnitSchema).optional(),
});

export const SignalSchema = z.object({
  id: z.string(),
  type: z.enum(['identityCard', 'statBadge', 'trajectorySnippet', 'typeCard']),
  fromProfileVersion: z.number().int(),
  surfacedContent: z.record(z.string(), z.unknown()),
  disclosure: z.enum(['private', 'public']),
  provenanceLabel: z.string(),
  createdAt: z.string(),
});

export type EvidenceUnit = z.infer<typeof EvidenceUnitSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Capability = z.infer<typeof CapabilitySchema>;
export type Trajectory = z.infer<typeof TrajectorySchema>;
export type CognitiveType = z.infer<typeof CognitiveTypeSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Signal = z.infer<typeof SignalSchema>;
