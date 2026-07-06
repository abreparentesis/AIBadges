import { parseJsonResponse } from './json';
import { assembleProfile } from './assemble';
import type { CaptureBundle } from '../capture/chatgpt-export';
import type { Profile, EvidenceUnit, Claim, Trajectory, CognitiveType, Confidence, Capability } from './types';

// The AI Fluency Index Custom GPT is the user's own model, configured by hand — so its reply shape varies.
// We've seen two shapes in the wild: the canonical {thinking, trajectory:{shifts}, type, evidence},
// and a richer {assessments:{thinking_style, dominant_request_patterns, communication_style,
// workflows_and_tools, trajectory_shifts}, evidence}. This importer accepts both (plus snake_case
// ids and free-form evidence types), then hands everything to assembleProfile, where ProfileSchema
// hard-validates and unbacked claims are dropped. Tolerant in, strict out.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const EV_TYPES = ['decision', 'reasoning_move', 'episode', 'preference'] as const;
const BANDS = ['emerging', 'developing', 'proficient', 'advanced'] as const;

const asArray = (v: unknown): AnyRec[] => (Array.isArray(v) ? (v as AnyRec[]) : []);
const norm = (s: unknown, allowed: readonly string[], dflt: string): string =>
  typeof s === 'string' && allowed.includes(s.toLowerCase()) ? s.toLowerCase() : dflt;
function clampLean(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}
// Accept evidenceIds / evidence_ids / ids, numbers or strings.
function readIds(o: AnyRec | undefined): string[] {
  const raw = o?.evidenceIds ?? o?.evidence_ids ?? o?.evidenceIDs ?? o?.ids ?? [];
  return Array.isArray(raw) ? raw.map((x) => String(x)) : [];
}

export interface ImportOpts { version: number; now: string; }

export class GptImportError extends Error {}

// Best effort: strip trailing commas (a common model JSON slip) and retry. Does NOT try to repair
// unescaped quotes inside strings — those are unrecoverable, and the GPT instructions tell the model
// to emit a fenced, strictly-valid JSON block to avoid them.
function parseLoose(raw: string): unknown {
  try {
    return parseJsonResponse(raw);
  } catch {
    const repaired = raw.replace(/,(\s*[}\]])/g, '$1');
    return parseJsonResponse(repaired); // throws if still invalid
  }
}

// Map a pasted AI Fluency Index-GPT result back to a Profile, joining its evidence to the captured export
// (by conversationId) to recover real timestamps and conversation ids, then running the shared
// anchoring/grading engine. Throws GptImportError when the paste yields nothing usable.
export function profileFromGptOutput(raw: string, bundle: CaptureBundle, opts: ImportOpts): Profile {
  let root: AnyRec;
  try {
    const parsed = parseLoose(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    root = parsed as AnyRec;
  } catch {
    throw new GptImportError("Couldn't read a profile from that paste. Copy the GPT's full JSON reply (the whole code block) and try again.");
  }

  const exp = bundle.export;
  const createdAtById = new Map(exp.conversations.map((c) => [c.conversationId, c.createdAt]));
  const dates = exp.conversations.map((c) => c.createdAt).filter(Boolean).sort();
  const fromDate = dates[0] ?? opts.now;
  const toDate = dates[dates.length - 1] ?? opts.now;

  // ---- evidence (always top-level `evidence`) ----
  const seenIds = new Set<string>();
  const evidence: EvidenceUnit[] = [];
  for (const e of asArray(root.evidence)) {
    if (!e || e.id == null || typeof e.quote !== 'string') continue;
    const id = String(e.id);
    if (seenIds.has(id)) continue; // first-wins: a repeated id must not create duplicate units
    seenIds.add(id);
    const cidRaw = e.conversationId ?? e.conversation_id;
    const cid = cidRaw != null ? String(cidRaw) : '';
    // hasOwnProperty (not `idMap[cid]`) so a GPT-supplied "__proto__"/"constructor" can't resolve
    // to a prototype member. createdAtById is a Map, so its lookup is already safe.
    const timestamp = createdAtById.get(cid) ?? toDate; // unknown/absent id -> window end date
    const realId = Object.prototype.hasOwnProperty.call(bundle.idMap, cid) ? bundle.idMap[cid] : cid;
    const ty = String(e.type ?? '').toLowerCase();
    const type = (EV_TYPES as readonly string[]).includes(ty) ? (ty as EvidenceUnit['type']) : 'episode';
    evidence.push({
      id,
      timestamp,
      sourceRef: { provider: 'chatgpt' as const, conversationId: realId || 'unknown' },
      type,
      quote: e.quote,
      summary: typeof e.summary === 'string' ? e.summary : '',
    });
  }

  // ---- thinking: top-level `thinking`, plus every assessments array of {claim,...} ----
  const assessments: AnyRec = root.assessments && typeof root.assessments === 'object' ? root.assessments : {};
  const claimSources: AnyRec[] = [];
  if (Array.isArray(root.thinking)) claimSources.push(...asArray(root.thinking));
  for (const [k, v] of Object.entries(assessments)) {
    if (k === 'trajectory_shifts' || k === 'trajectoryShifts') continue; // those are the trajectory
    for (const it of asArray(v)) if (it && typeof it.claim === 'string') claimSources.push(it);
  }
  const thinking: Claim[] = claimSources
    .filter((c) => c && typeof c.claim === 'string')
    .map((c) => ({
      claim: String(c.claim),
      evidenceIds: readIds(c),
      confidence: norm(c.confidence, ['low', 'medium', 'high'], 'low') as Confidence,
    }));

  // ---- trajectory: canonical trajectory.shifts, else assessments.trajectory_shifts (claim-shaped) ----
  let shiftItems: AnyRec[] = [];
  if (root.trajectory && Array.isArray(root.trajectory.shifts)) shiftItems = asArray(root.trajectory.shifts);
  else if (Array.isArray(assessments.trajectory_shifts)) shiftItems = asArray(assessments.trajectory_shifts);
  else if (Array.isArray(root.trajectory_shifts)) shiftItems = asArray(root.trajectory_shifts);
  const trajectory: Trajectory = {
    window: { earlyTo: fromDate, recentFrom: toDate },
    shifts: shiftItems
      .map((s) => ({
        dimension: String(s.dimension ?? s.claim ?? '').trim(),
        direction: norm(s.direction, ['rising', 'falling', 'steady'], 'steady') as Trajectory['shifts'][number]['direction'],
        velocity: norm(s.velocity, ['slow', 'moderate', 'fast'], 'moderate') as Trajectory['shifts'][number]['velocity'],
        evidenceIds: readIds(s),
      }))
      .filter((s) => s.dimension),
  };

  // ---- type (optional; the GPT may correctly omit it) ----
  let type: CognitiveType | undefined;
  const rt = root.type;
  if (rt && typeof rt === 'object' && typeof rt.code === 'string' && rt.axes && typeof rt.axes === 'object') {
    const code = rt.code.toUpperCase();
    if (/^[EI][SN][TF][JP]$/.test(code)) {
      const axis = (a: AnyRec | undefined, fallback: string) => ({
        letter: (String(a?.letter ?? fallback).toUpperCase().slice(0, 1)) || fallback,
        lean: clampLean(a?.lean),
        evidenceIds: readIds(a),
      });
      type = {
        code,
        summary: typeof rt.summary === 'string' ? rt.summary : '',
        confidence: norm(rt.confidence, ['low', 'medium', 'high'], 'low') as Confidence,
        axes: {
          EI: axis(rt.axes.EI, code[0]),
          SN: axis(rt.axes.SN, code[1]),
          TF: axis(rt.axes.TF, code[2]),
          JP: axis(rt.axes.JP, code[3]),
        },
      };
    }
  }

  // ---- capability (optional AI-fluency 4D + stage; the AI Fluency Index tab renders it) ----
  let capability: Capability | undefined;
  const rc = root.capability;
  if (rc && typeof rc === 'object' && rc.aiFluency && typeof rc.aiFluency === 'object') {
    const dim = (o: AnyRec | undefined) => ({
      band: norm(o?.band, BANDS, 'emerging') as Capability['aiFluency']['delegation']['band'],
      ...(typeof o?.note === 'string' && o.note.trim() ? { note: o.note.trim() } : {}),
      evidenceIds: readIds(o),
    });
    const f = rc.aiFluency as AnyRec;
    const stageRaw = Math.round(Number(rc.yeggeStage?.stage ?? rc.stage?.stage ?? rc.stage));
    const stage = (Number.isFinite(stageRaw) ? Math.max(1, Math.min(8, stageRaw)) : 1) as Capability['yeggeStage']['stage'];
    capability = {
      aiFluency: { delegation: dim(f.delegation), description: dim(f.description), discernment: dim(f.discernment), diligence: dim(f.diligence) },
      yeggeStage: { stage, evidenceIds: readIds(rc.yeggeStage) },
      domains: asArray(rc.domains)
        .map((d) => ({ name: String(d?.name ?? '').trim(), band: norm(d?.band, BANDS, 'emerging') as Capability['domains'][number]['band'], evidenceIds: readIds(d) }))
        .filter((d) => d.name),
    };
  }

  const profile = assembleProfile(
    { thinking, trajectory, type, capability, evidence },
    {
      version: opts.version, now: opts.now,
      modelProvenance: 'chatgpt-custom-gpt (self-run in your ChatGPT)',
      sourceWindow: { fromDate, toDate, conversationCount: exp.conversations.length },
    },
  );

  const empty = profile.thinking.length === 0 && profile.trajectory.shifts.length === 0 && !profile.type;
  if (empty) {
    throw new GptImportError(
      'That result had no evidence-backed claims, so nothing was saved. Make sure you pasted the whole reply, including the "evidence" list, and that each claim cites evidence ids.',
    );
  }
  return profile;
}
