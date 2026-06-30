import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from 'react';
import '../../src/ui/theme.css';
import type { Profile, Signal } from '../../src/engine/types';
import { lookupType } from '../../src/engine/typeTable';
import { ensureUserKey } from '../../src/store/userkey';
import { BackendSync } from '../../src/sync/backend';
import { BACKEND_URL, INVITE_TOKEN, shareUrl } from '../../src/config';
import { t } from '../../src/ui/tokens';

type UiSignal = Signal & { shareToken?: string | null };
type Quote = { quote: string; date: string };
const kv = {
  get: async (k: string) => ((await chrome.storage.local.get(k))[k] as string | undefined) ?? null,
  set: async (k: string, v: string) => { await chrome.storage.local.set({ [k]: v }); },
};
// Map each report section to the signal type it shares.
const SECTION_TYPE = { type: 'typeCard', thinking: 'identityCard', trajectory: 'trajectorySnippet' } as const;
const AXIS_WORD: Record<string, string> = { E: 'Extraversion', I: 'Introversion', S: 'Sensing', N: 'iNtuition', T: 'Thinking', F: 'Feeling', J: 'Judging', P: 'Perceiving' };
const TRAIT_ACCENT = ['high', 'medium', 'low'];
const ARROW: Record<string, string> = { rising: '↑', falling: '↓', steady: '→' };

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [signals, setSignals] = useState<UiSignal[]>([]);
  const [busy, setBusy] = useState('');

  // Index the verified quotes once per profile, then resolve claim/axis/shift ids → quotes.
  // Old profiles may lack `evidence`; quotesFor then yields [] and no expander is rendered.
  const evById = useMemo(() => new Map((profile?.evidence ?? []).map((e) => [e.id, e] as const)), [profile]);
  const quotesFor = (ids: string[]): Quote[] => {
    const out: Quote[] = [];
    for (const id of ids ?? []) {
      const e = evById.get(id);
      if (!e) continue;
      const d = new Date(e.timestamp);
      out.push({ quote: e.quote, date: Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString() });
    }
    return out;
  };

  async function load() {
    const latest = Number((await kv.get('aibadges:latestVersion')) ?? '0');
    if (latest > 0) { const p = await kv.get(`aibadges:profile:${latest}`); if (p) setProfile(JSON.parse(p)); }
    const s = await kv.get('aibadges:signals');
    if (s) {
      // Normalize legacy 3-level disclosure (published / unlistedLink) down to public.
      const parsed = (JSON.parse(s) as UiSignal[]).map((sig) =>
        ({ ...sig, disclosure: (sig.disclosure === 'private' ? 'private' : 'public') as Signal['disclosure'] }));
      setSignals(parsed);
    }
  }
  useEffect(() => {
    void load();
    try { chrome.runtime.sendMessage({ type: 'aibadges:opened' }); } catch { /* noop */ }
  }, []);

  async function changeDisclosure(sig: UiSignal, disclosure: Signal['disclosure']) {
    setBusy(sig.type);
    try {
      const userKey = await ensureUserKey(kv);
      const [res] = await new BackendSync({ backendUrl: BACKEND_URL, inviteToken: INVITE_TOKEN, userKey })
        .setSignals([{ type: sig.type, surfacedContent: sig.surfacedContent, disclosure }]);
      const next = signals.map((s) => (s.type === sig.type ? { ...s, disclosure, shareToken: res?.shareToken ?? null } : s));
      setSignals(next);
      await kv.set('aibadges:signals', JSON.stringify(next));
    } catch (e) { alert('Share update failed: ' + String(e)); } finally { setBusy(''); }
  }

  if (!profile) {
    return <Shell><div className="bb-card" style={{ textAlign: 'center', color: t.g600 }}>
      No profile yet. Open the AIBadges popup and run <b style={{ color: t.g900 }}>profiling</b>.</div></Shell>;
  }

  const ty = profile.type;
  // Source provider drives copy: chats stay on-device for Claude (in-session), or go to the user's
  // own ChatGPT for the GPT path — but in neither case do they reach our servers.
  const provider = profile.evidence?.[0]?.sourceRef.provider
    ?? (profile.modelProvenance.includes('chatgpt') ? 'chatgpt' : 'claude');
  const sourceLabel = provider === 'chatgpt' ? 'ChatGPT' : 'Claude';
  const sigFor = (type: string) => signals.find((s) => s.type === type);
  const isPublic = (type: string) => sigFor(type)?.disclosure === 'public';
  const toggle = (type: string, next: Signal['disclosure']) => {
    const sig = sigFor(type);
    if (sig) void changeDisclosure(sig, next);
  };
  // Any public section's token resolves to the same public report, so any one works as the link.
  const shareToken = signals.find((s) => s.disclosure === 'public' && s.shareToken)?.shareToken ?? null;

  return (
    <Shell>
      <div className="bb-eyebrow">Living profile · v{profile.version}</div>
      <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.01em', margin: '8px 0 6px' }}>How you think</h1>
      <p className="bb-muted" style={{ fontSize: 16, margin: 0, maxWidth: 580 }}>
        An evidence-backed reflection from your own {sourceLabel} history. Every claim links to the quotes behind it.
        This is a behavioral mirror, not a validated personality test. Your raw chats are never sent to our servers.
      </p>

      <div style={{ display: 'flex', gap: 28, alignItems: 'stretch', marginTop: 22, flexWrap: 'wrap' }}>
        {ty ? <HoloCard type={ty} /> : <div className="bb-card" style={{ width: 330 }}>No cognitive type this run.</div>}
        <div style={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div className="bb-eyebrow" style={{ color: t.purple }}>Your cognitive type</div>
          <div style={{ fontSize: 18, lineHeight: 1.55, color: t.g700, margin: '14px 0 8px' }}>{ty?.summary ?? ''}</div>
          {ty && (() => {
            // Union of the four axes' backing quotes, deduped by id (an id may justify more than one axis).
            const ids = Array.from(new Set((['EI', 'SN', 'TF', 'JP'] as const).flatMap((k) => ty.axes[k].evidenceIds ?? [])));
            const quotes = quotesFor(ids);
            return quotes.length > 0 ? <Evidence quotes={quotes} label="see the quotes" style={{ margin: '0 0 14px' }} /> : null;
          })()}
          {sigFor(SECTION_TYPE.type) && (
            <Toggle label="Cognitive Type" pub={isPublic(SECTION_TYPE.type)} busy={busy === SECTION_TYPE.type}
              onChange={(next) => toggle(SECTION_TYPE.type, next)} />
          )}
          <div style={{ marginTop: 18 }}>
            {shareToken
              ? <ShareRow url={shareUrl(shareToken)} />
              : <span className="bb-muted" style={{ fontSize: 13 }}>Make a section public to get a shareable link.</span>}
          </div>
        </div>
      </div>

      <SecH dot={t.purple} title="How you think" cap={`${profile.thinking.length} traits · evidence-backed`}
        toggle={sigFor(SECTION_TYPE.thinking) && (
          <Toggle label="How you think" pub={isPublic(SECTION_TYPE.thinking)} busy={busy === SECTION_TYPE.thinking}
            onChange={(next) => toggle(SECTION_TYPE.thinking, next)} />
        )} />
      {profile.thinking.length === 0 ? <Empty /> : (
        <div className="bb-grid2">
          {profile.thinking.map((c, i) => {
            const quotes = quotesFor(c.evidenceIds);
            return (
              <div key={i} className={`trait c${i % 6}`}>
                <div className="tt">{c.claim}</div>
                <span className={`conf ${TRAIT_ACCENT.includes(c.confidence) ? c.confidence : 'low'}`}>
                  {c.confidence} confidence{quotes.length > 0 ? ` · ${quotes.length} quote${quotes.length === 1 ? '' : 's'}` : ''}
                </span>
                {quotes.length > 0 && <Evidence quotes={quotes} style={{ marginTop: 12 }} />}
              </div>
            );
          })}
        </div>
      )}

      <SecH dot={t.success} title="Where you're heading" cap="trajectory"
        toggle={sigFor(SECTION_TYPE.trajectory) && (
          <Toggle label="Where you're heading" pub={isPublic(SECTION_TYPE.trajectory)} busy={busy === SECTION_TYPE.trajectory}
            onChange={(next) => toggle(SECTION_TYPE.trajectory, next)} />
        )} />
      {profile.trajectory.shifts.length === 0
        ? <div className="bb-muted">No clear shifts yet. The trajectory sharpens as more of your history accrues.</div>
        : profile.trajectory.shifts.map((s, i) => {
          const quotes = quotesFor(s.evidenceIds);
          return (
            <div key={i}>
              <div className="mrow" style={quotes.length > 0 ? { marginBottom: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : undefined}>
                <span className={`arr ${s.direction}`}>{ARROW[s.direction] ?? ARROW.steady}</span>
                <span className="dim">{s.dimension}</span>
                <span className="vel">{s.direction} · {s.velocity}</span>
              </div>
              {quotes.length > 0 && (
                <Evidence quotes={quotes}
                  style={{ border: `1px solid ${t.g200}`, borderTop: 'none', borderRadius: '0 0 14px 14px', padding: '10px 18px 4px', marginBottom: 12 }} />
              )}
            </div>
          );
        })}

      <footer className="bb-muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 30, paddingTop: 18, borderTop: `1px solid ${t.g200}`, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
        Computed by a language model from your chats; claims are shown only when backed by quotes you can inspect. Treat it as a thoughtful read, not a measurement.
        {' '}Self-computed in your own AI session. Not verified by us. Cognitive Type uses public-domain Jungian dichotomies (E/I, S/N, T/F, J/P); not affiliated with the Myers-Briggs Type Indicator® or The Myers-Briggs Company.
      </footer>
    </Shell>
  );
}

function HoloCard({ type }: { type: NonNullable<Profile['type']> }) {
  const meta = lookupType(type.code);
  const axes = (['EI', 'SN', 'TF', 'JP'] as const).map((k) => ({ word: AXIS_WORD[type.axes[k].letter] ?? type.axes[k].letter, lean: type.axes[k].lean }));
  return (
    <div className="holo" data-group={meta.group}>
      <div className="top"><span>● AIBADGES</span><span className="rar">{meta.group.replace(/s$/, '').toUpperCase()}</span></div>
      <div className="code">{type.code}</div>
      <div className="nm">{meta.name}</div>
      <div className="grp"><span className="gdot" />{meta.group}</div>
      <div className="stats">
        {axes.map((a, i) => (
          <div key={i}><div className="sl"><span>{a.word}</span><b>{a.lean}</b></div><div className="hbar"><i style={{ width: `${a.lean}%` }} /></div></div>
        ))}
      </div>
      <div className="hfoot"><span>AIBadges</span><span>behavioral · no quiz</span></div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: t.white }}>
      <div style={{ borderBottom: `1px solid ${t.g200}`, height: 60, display: 'flex', alignItems: 'center', padding: '0 24px' }}>
        <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', color: t.g900 }}>AIBadges</span>
        <span style={{ marginLeft: 12, paddingLeft: 12, borderLeft: `1px solid ${t.g200}`, color: t.g600, fontSize: 14 }}>living profile</span>
      </div>
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '34px 24px 60px' }}>{children}</main>
    </div>
  );
}
function SecH({ dot, title, cap, toggle }: { dot: string; title: string; cap: string; toggle?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '38px 0 16px' }}>
      <span className="bb-dot" style={{ background: dot }} />
      <h2 style={{ fontSize: 21, fontWeight: 600 }}>{title}</h2>
      <span style={{ marginLeft: 'auto' }}>
        {toggle ?? <span style={{ fontSize: 12, color: t.g500 }}>{cap}</span>}
      </span>
    </div>
  );
}

// Two-button segmented control [Private | Public], bound to one section's signal.
function Toggle({ label, pub, busy, onChange }: {
  label: string; pub: boolean; busy: boolean; onChange: (d: Signal['disclosure']) => void;
}) {
  const base: CSSProperties = {
    fontFamily: 'inherit', fontSize: 13, fontWeight: 500, border: 'none', padding: '6px 14px',
    cursor: busy ? 'default' : 'pointer', background: 'transparent', color: t.g600,
  };
  const on: CSSProperties = { background: t.white, color: t.g900, boxShadow: '0 1px 2px rgba(16,24,40,.08)' };
  return (
    <span role="group" aria-label={`${label} visibility`}
      style={{ display: 'inline-flex', background: t.g100, border: `1px solid ${t.g200}`, borderRadius: 50, padding: 3, opacity: busy ? 0.6 : 1 }}>
      <button type="button" disabled={busy} aria-pressed={!pub} onClick={() => onChange('private')}
        style={{ ...base, borderRadius: 50, ...(!pub ? on : {}) }}>Private</button>
      <button type="button" disabled={busy} aria-pressed={pub} onClick={() => onChange('public')}
        style={{ ...base, borderRadius: 50, ...(pub ? on : {}) }}>Public</button>
    </span>
  );
}
function ShareRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 12px', background: t.g50, border: `1px solid ${t.g200}`, borderRadius: 10, padding: '8px 12px' }}>
      <a href={url} target="_blank" rel="noreferrer" style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{url}</a>
      <button className="bb-btn bb-btn-secondary bb-btn-sm" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1300); }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
// Subtle, self-contained expander: a muted caret control that reveals the backing quotes.
// Quotes are display-only in this in-app report; they are never added to any share payload.
function Evidence({ quotes, label, style }: { quotes: Quote[]; label?: string; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  const n = quotes.length;
  const text = label ?? `${n} quote${n === 1 ? '' : 's'}`;
  return (
    <div style={style}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{
          fontFamily: 'inherit', fontSize: 12, fontWeight: 500, color: t.g500, background: 'none', border: 'none',
          padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
        }}>
        <span style={{ display: 'inline-block', transition: 'transform .12s', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
        {open ? 'hide quotes' : text}
      </button>
      {open && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {quotes.map((q, i) => (
            <div key={i} style={{ borderLeft: `2px solid ${t.g200}`, paddingLeft: 12 }}>
              <div style={{ fontSize: 13, fontStyle: 'italic', lineHeight: 1.5, color: t.g700 }}>&ldquo;{q.quote}&rdquo;</div>
              {q.date && <div style={{ fontSize: 11, color: t.g500, marginTop: 4 }}>{q.date}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function Empty() { return <div className="bb-muted">Nothing surfaced for this lens in the latest run.</div>; }
