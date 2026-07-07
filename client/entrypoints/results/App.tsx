import { useEffect, useMemo, useState, type ReactNode, type CSSProperties } from 'react';
import '../../src/ui/theme.css';
import type { Profile, Signal } from '../../src/engine/types';
import { lookupType } from '../../src/engine/typeTable';
import { ensureUserKey } from '../../src/store/userkey';
import { BackendSync, NEEDS_REPUSH_KEY, repushIfNeeded } from '../../src/sync/backend';
import { BACKEND_URL, INVITE_TOKEN, shareUrl, FLUENCY_ONLY } from '../../src/config';
import { buildAddToProfileUrl, buildShareOnLinkedInUrl, defaultShareText, stageDrift } from '../../src/sync/linkedin';
import { namedLevel } from '../../src/engine/levels';
import { learningPath } from '../../src/engine/learningPath';
import { t, bandColor } from '../../src/ui/tokens';

type UiSignal = Signal & { shareToken?: string | null };
type Quote = { quote: string; date: string };
const kv = {
  get: async (k: string) => ((await chrome.storage.local.get(k))[k] as string | undefined) ?? null,
  set: async (k: string, v: string) => { await chrome.storage.local.set({ [k]: v }); },
};
// Map each report section to the signal type it shares.
const SECTION_TYPE = { type: 'typeCard', thinking: 'identityCard', trajectory: 'trajectorySnippet' } as const;
type Tab = 'personality' | 'literacy';
// weak = only partly visible from chat (the real behavior happens off-platform), so we surface a caveat.
const FLUENCY = [
  ['delegation', 'Delegation', 'What you hand off and how you scope it', true],
  ['description', 'Description', 'How clearly you prompt and give context', false],
  ['discernment', 'Discernment', 'Pushing back and judging output quality', false],
  ['diligence', 'Diligence', 'Verification signals in your chats', true],
] as const;
const AXIS_WORD: Record<string, string> = { E: 'Extraversion', I: 'Introversion', S: 'Sensing', N: 'iNtuition', T: 'Thinking', F: 'Feeling', J: 'Judging', P: 'Perceiving' };
const TRAIT_ACCENT = ['high', 'medium', 'low'];
const ARROW: Record<string, string> = { rising: '↑', falling: '↓', steady: '→' };

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [signals, setSignals] = useState<UiSignal[]>([]);
  const [busy, setBusy] = useState('');
  const [tab, setTab] = useState<Tab>(FLUENCY_ONLY ? 'literacy' : 'personality');
  const [publishedStage, setPublishedStage] = useState('');

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
      // Fluency-only: a personality section published before the pivot must not stay silently
      // live on a server page the UI no longer shows. Unpublish any such leftovers once.
      if (FLUENCY_ONLY && parsed.some((sig) => sig.type !== 'statBadge' && sig.disclosure === 'public')) {
        void (async () => {
          try {
            const userKey = await ensureUserKey(kv);
            const sync = new BackendSync({ backendUrl: BACKEND_URL, inviteToken: INVITE_TOKEN, userKey });
            await sync.setSignals(parsed
              .filter((sig) => sig.type !== 'statBadge' && sig.disclosure === 'public')
              .map((sig) => ({ type: sig.type, surfacedContent: sig.surfacedContent, disclosure: 'private' as const })));
            const next = parsed.map((sig) =>
              (sig.type !== 'statBadge' ? { ...sig, disclosure: 'private' as Signal['disclosure'], shareToken: null } : sig));
            setSignals(next);
            await kv.set('aibadges:signals', JSON.stringify(next));
          } catch { /* offline or server error: retried next time the page opens */ }
        })();
      }
    }
    setPublishedStage((await kv.get('aibadges:publishedStage')) ?? '');
  }
  useEffect(() => {
    void load();
    try { chrome.runtime.sendMessage({ type: 'aibadges:opened' }); } catch { /* noop */ }
  }, []);

  // Wipes everything the backend holds for this key (badge, share links). Local profile and
  // evidence stay on-device; flipping the local signals to private mirrors the server state.
  async function deleteServerData() {
    if (busy) return; // one server mutation at a time; a racing share-toggle could resurrect data mid-delete
    if (!confirm('Delete your badge data from the AI Fluency Index server? Your profile stays on this device, but share links will stop working.')) return;
    setBusy('delete-server');
    try {
      const userKey = await ensureUserKey(kv);
      await new BackendSync({ backendUrl: BACKEND_URL, inviteToken: INVITE_TOKEN, userKey }).deleteServerData();
      const next = signals.map((s) => ({ ...s, disclosure: 'private' as Signal['disclosure'], shareToken: null }));
      setSignals(next);
      await kv.set('aibadges:signals', JSON.stringify(next));
      await kv.set(NEEDS_REPUSH_KEY, '1'); // the next share must re-push the profile first
      setPublishedStage('');
      await kv.set('aibadges:publishedStage', '');
      alert('Deleted. Our server no longer holds any data for you.');
    } catch (e) { alert('Delete failed: ' + String(e)); } finally { setBusy(''); }
  }

  async function changeDisclosure(sig: UiSignal, disclosure: Signal['disclosure']) {
    if (busy) return;
    if (disclosure === sig.disclosure) return; // no-op click: no network call, nothing to change
    setBusy(sig.type);
    try {
      const userKey = await ensureUserKey(kv);
      const sync = new BackendSync({ backendUrl: BACKEND_URL, inviteToken: INVITE_TOKEN, userKey });
      // Only when publishing: a private toggle must never recreate server state after a delete.
      if (disclosure === 'public') await repushIfNeeded(kv, sync);
      const [res] = await sync
        .setSignals([{ type: sig.type, surfacedContent: sig.surfacedContent, disclosure }]);
      const next = signals.map((s) => (s.type === sig.type ? { ...s, disclosure, shareToken: res?.shareToken ?? null } : s));
      setSignals(next);
      await kv.set('aibadges:signals', JSON.stringify(next));
      if (sig.type === 'statBadge') {
        const c = sig.surfacedContent as { fluencyScore?: number; yeggeStage?: number | string };
        const published = disclosure === 'public' ? String(c.fluencyScore ?? c.yeggeStage ?? '') : '';
        setPublishedStage(published);
        await kv.set('aibadges:publishedStage', published);
      }
    } catch (e) { alert('Share update failed: ' + String(e)); } finally { setBusy(''); }
  }

  // Explicit refresh: pushes the CURRENT local statBadge content (kv signals are re-distilled
  // after every run) so the share page and og image match, then reopens LinkedIn's form.
  async function updateLinkedInBadge() {
    if (busy) return;
    const sig = sigFor('statBadge');
    if (!sig?.shareToken) return;
    setBusy('statBadge');
    try {
      const userKey = await ensureUserKey(kv);
      const sync = new BackendSync({ backendUrl: BACKEND_URL, inviteToken: INVITE_TOKEN, userKey });
      await repushIfNeeded(kv, sync);
      const [res] = await sync.setSignals([{ type: 'statBadge', surfacedContent: sig.surfacedContent, disclosure: 'public' }]);
      const next = signals.map((s) => (s.type === 'statBadge' ? { ...s, disclosure: 'public' as Signal['disclosure'], shareToken: res?.shareToken ?? null } : s));
      setSignals(next);
      await kv.set('aibadges:signals', JSON.stringify(next));
      const c = sig.surfacedContent as { fluencyScore?: number; yeggeStage?: number | string; level?: string };
      const published = String(c.fluencyScore ?? c.yeggeStage ?? '');
      setPublishedStage(published);
      await kv.set('aibadges:publishedStage', published);
      if (res?.shareToken && profile) {
        window.open(buildAddToProfileUrl({
          score: published, level: c.level ?? namedLevel(Number(c.yeggeStage) || 1).name,
          computedAt: profile.computedAt,
          shareUrl: shareUrl(res.shareToken), token: res.shareToken,
        }), '_blank');
      }
    } catch (e) { alert('Badge update failed: ' + String(e)); } finally { setBusy(''); }
  }

  if (!profile) {
    return <Shell><div className="bb-card" style={{ textAlign: 'center', color: t.g600 }}>
      No profile yet. Open the AI Fluency Index popup and run <b style={{ color: t.g900 }}>profiling</b>.</div></Shell>;
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
  const cap = profile.capability;

  return (
    <Shell>
      {!FLUENCY_ONLY && <Tabs tab={tab} onPick={setTab} />}
      {!FLUENCY_ONLY && tab === 'personality' && (<>
      <div className="bb-eyebrow">Living profile · v{profile.version}</div>
      <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.01em', margin: '8px 0 6px' }}>How you think</h1>
      <p className="bb-muted" style={{ fontSize: 16, margin: 0, maxWidth: 580 }}>
        An evidence-backed reflection from your own {sourceLabel} history. Every claim links to the quotes behind it.
        This is a behavioral mirror, not a validated personality test. Your raw chats are never sent to our servers.
      </p>
      {profile.coverage?.provisional && (
        <div className="bb-card" role="status" style={{ marginTop: 16, maxWidth: 580, padding: '12px 16px', borderLeft: 'none', background: 'var(--bb-amber-soft, #fdf3e3)' }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Provisional read</div>
          <div className="bb-muted" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            This profile draws on {profile.coverage.conversationCount} conversation{profile.coverage.conversationCount === 1 ? '' : 's'}
            {profile.coverage.evidenceConversations < 5 ? `, with quotable evidence from only ${profile.coverage.evidenceConversations}` : ''}.
            With this little history, levels read low no matter who you are. Import more of your chat history for a reliable picture.
          </div>
        </div>
      )}

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
      </>)}

      {tab === 'literacy' && !cap && (
        <div className="bb-card" style={{ marginTop: 24, color: t.g600 }}>
          Your AI Fluency Index isn&rsquo;t in this profile yet. Re-run profiling from the AI Fluency Index popup to generate them.
        </div>
      )}
      {tab === 'literacy' && cap && (() => {
        const level = namedLevel(cap.yeggeStage.stage);
        const steps = learningPath(cap);
        const stageQuotes = quotesFor(cap.yeggeStage.evidenceIds);
        const CHAT_CEIL = 6; // chat can only evidence stages 1-6; 7-8 (Orchestrator) need an agentic source
        const BAND_RANK = ['emerging', 'developing', 'proficient', 'advanced'];
        const weakest = [...FLUENCY]
          .map(([key, label]) => ({ label, band: cap.aiFluency[key].band }))
          .sort((a, b) => BAND_RANK.indexOf(a.band) - BAND_RANK.indexOf(b.band))[0];
        const atCeiling = cap.yeggeStage.stage >= CHAT_CEIL;
        return (
          <>
            <div className="bb-eyebrow" style={{ color: t.blue }}>AI Fluency Index</div>
            <h1 style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.01em', margin: '8px 0 6px' }}>How capably you operate</h1>
            <p className="bb-muted" style={{ fontSize: 16, margin: 0, maxWidth: 580 }}>
              An evidence-backed read of your AI-working maturity from your own {sourceLabel} history, across four fluency dimensions. This is a reflection, not a certification.
            </p>

            <div className="bb-card" style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ width: 108, height: 108, borderRadius: 18, background: 'linear-gradient(150deg,#3f86ff,#0046ff 55%,#103d9f)', color: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
                <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1 }}>{cap.fluencyScore ?? cap.yeggeStage.stage * 10}</div>
                <div style={{ fontSize: 10, opacity: 0.85, marginTop: 5, letterSpacing: '.08em', textTransform: 'uppercase' }}>of 100</div>
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="bb-eyebrow" style={{ color: t.blue }}>Overall level</div>
                <div style={{ fontSize: 26, fontWeight: 700, margin: '6px 0 2px' }}>{level.name}</div>
                <div style={{ fontSize: 12, color: t.g500 }}>Rolled up from your four fluencies below. Chat history can evidence at most 80 of 100 &mdash; the last 20 points live in agentic work.</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {(['Beginner', 'Intermediate', 'Advanced', 'Expert'] as const).map((n) => {
                    const isCurrent = n === level.name;
                    const locked = n === 'Expert';
                    return (
                      <span key={n} style={{
                        fontSize: 12, fontWeight: 600, padding: '4px 11px', borderRadius: 50, display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: isCurrent ? t.blue : t.g50, color: isCurrent ? '#fff' : (locked ? t.g500 : t.g700),
                        border: `1px solid ${isCurrent ? t.blue : t.g200}`, ...(locked ? { borderStyle: 'dashed' as const } : {}),
                      }}>{locked ? '🔒 ' : ''}{n}</span>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 12 }} aria-hidden="true">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
                    const locked = n > CHAT_CEIL;
                    const filled = n <= cap.yeggeStage.stage;
                    return <div key={n} style={{
                      flex: 1, height: 7, borderRadius: 4, boxSizing: 'border-box',
                      background: filled ? t.blue : locked ? 'transparent' : t.g200,
                      border: locked ? `1px dashed ${t.g200}` : 'none',
                    }} />;
                  })}
                </div>
                <div style={{ fontSize: 12.5, color: t.g600, marginTop: 8, lineHeight: 1.5 }}>
                  {weakest.band !== 'advanced' && (
                    <><b style={{ color: t.blue }}>Room to grow.</b> Your lowest fluency is <b>{weakest.label}</b> ({weakest.band}) &mdash; strengthening it is your clearest next step (see &ldquo;Grow your AI fluency&rdquo; below). </>
                  )}
                  {atCeiling
                    ? <>You&rsquo;re at the top of the range chat can measure (stage {CHAT_CEIL} of 8). </>
                    : <>You&rsquo;re at stage {cap.yeggeStage.stage} of the {CHAT_CEIL} that chat can measure. </>}
                  The top tier, <b>Expert</b>, can&rsquo;t be seen in chat at all &mdash; it means directing autonomous agents across multi-step work, and unlocks only when you connect an agentic source like <b>Claude Code</b> or <b>Codex</b>.
                </div>
                {stageQuotes.length > 0 && <Evidence quotes={stageQuotes} style={{ marginTop: 10 }} />}
              </div>
            </div>

            <SecH dot={t.blue} title="Your four fluencies" cap="AI-fluency · evidence-backed"
              toggle={sigFor('statBadge') && (
                <Toggle label="AI Fluency Index" pub={isPublic('statBadge')} busy={busy === 'statBadge'}
                  onChange={(next) => toggle('statBadge', next)} />
              )} />
            {(() => {
              const sig = sigFor('statBadge');
              if (!sig || sig.disclosure !== 'public' || !sig.shareToken) return null;
              const link = shareUrl(sig.shareToken);
              const scoreNow = cap.fluencyScore ?? cap.yeggeStage.stage * 10;
              const drift = stageDrift(publishedStage, scoreNow);
              return (
                <div style={{ margin: '0 0 16px' }}>
                  {drift && (
                    <div className="bb-card" style={{ marginBottom: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderLeft: `4px solid ${t.blue}` }}>
                      <span style={{ fontSize: 13 }}>
                        Your LinkedIn badge shows {publishedStage} &mdash; your current score is {scoreNow}/100.
                      </span>
                      <button type="button" className="bb-btn" onClick={() => void updateLinkedInBadge()} disabled={busy !== ''}
                        style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 50, padding: '5px 14px', border: `1px solid ${t.g300}`, background: t.white }}>
                        Update LinkedIn badge
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <a href={buildAddToProfileUrl({ score: scoreNow, level: level.name, computedAt: profile.computedAt, shareUrl: link, token: sig.shareToken })}
                      target="_blank" rel="noreferrer"
                      style={{ fontSize: 13, fontWeight: 600, textDecoration: 'none', borderRadius: 50, padding: '7px 16px', background: '#0A66C2', color: '#fff' }}>
                      Add to LinkedIn profile
                    </a>
                    <a href={buildShareOnLinkedInUrl(link, defaultShareText(scoreNow, level.name))} target="_blank" rel="noreferrer"
                      style={{ fontSize: 13, fontWeight: 600, textDecoration: 'none', borderRadius: 50, padding: '7px 16px', border: `1px solid ${t.g300}`, color: t.g700 }}>
                      Share on LinkedIn
                    </a>
                  </div>
                </div>
              );
            })()}
            <div className="bb-grid2">
              {FLUENCY.map(([key, label, desc, weak]) => {
                const band = cap.aiFluency[key].band;
                const note = cap.aiFluency[key].note;
                const quotes = quotesFor(cap.aiFluency[key].evidenceIds);
                return (
                  <div key={key} className="bb-card" style={{ padding: '16px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{label}</div>
                      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#fff', background: bandColor[band] ?? t.g500, padding: '3px 10px', borderRadius: 50 }}>{band}</span>
                    </div>
                    <div className="bb-muted" style={{ fontSize: 13, marginTop: 4 }}>{desc}</div>
                    {note && <div style={{ fontSize: 13, color: t.g700, marginTop: 8, lineHeight: 1.45 }}>{note}</div>}
                    {cap.aiFluency[key].nextStep && (
                      <div style={{ fontSize: 13, marginTop: 8, padding: '8px 12px', borderRadius: 10, background: t.g50, lineHeight: 1.45 }}>
                        <b style={{ color: t.blue }}>Try next:</b> {cap.aiFluency[key].nextStep}
                      </div>
                    )}
                    {weak && <div style={{ fontSize: 11, color: t.g500, marginTop: 6, fontStyle: 'italic' }}>Only partly visible from chat &mdash; the real signal is off-platform.</div>}
                    {quotes.length > 0 && <Evidence quotes={quotes} style={{ marginTop: 10 }} />}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 18 }}>
              {shareToken
                ? <ShareRow url={shareUrl(shareToken)} />
                : <span className="bb-muted" style={{ fontSize: 13 }}>Make a section public to get a shareable link.</span>}
            </div>

            <SecH dot={t.success} title="Grow your AI fluency" cap="personalized" />
            {steps.length === 0 ? (
              <div className="bb-muted">You&rsquo;re fluent across what your chats reveal. The next rung, Orchestrator, is directing agents and tools across multi-step work. Chat can&rsquo;t show it; it grows in agentic tools like Claude Code or Codex, and we&rsquo;d only score it from those sources.</div>
            ) : steps.map((s) => (
              <div key={s.dimension} className="bb-card" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize', color: t.g700 }}>{s.dimension}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: '#fff', background: bandColor[s.band] ?? t.g500, padding: '2px 9px', borderRadius: 50 }}>{s.band}</span>
                </div>
                {cap.aiFluency[s.dimension]?.nextStep && (
                  <div style={{ fontSize: 15, lineHeight: 1.55, margin: '8px 0 4px' }}>
                    <b style={{ color: t.blue }}>Your next step:</b> {cap.aiFluency[s.dimension].nextStep}
                  </div>
                )}
                <div style={{ fontSize: cap.aiFluency[s.dimension]?.nextStep ? 13 : 15, color: cap.aiFluency[s.dimension]?.nextStep ? t.g600 : undefined, lineHeight: 1.55, margin: '4px 0 10px' }}>{s.how}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                  {s.links.map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 500 }}>{l.label} &rarr;</a>
                  ))}
                </div>
              </div>
            ))}

            <footer className="bb-muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 30, paddingTop: 18, borderTop: `1px solid ${t.g200}`, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
              AI-fluency scored by a language model from your chats against the Anthropic 4D framework (Delegation, Description, Discernment, Diligence) plus a 1&ndash;8 fluency stage. Chat shows Description and Discernment well but only hints at Delegation and Diligence, and the top stage reflects agent orchestration chat rarely captures. Self-computed in your own AI session. Not verified by us.
            </footer>
          </>
        );
      })()}
      <div style={{ marginTop: 40, paddingTop: 16, borderTop: `1px solid ${t.g200}`, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="bb-muted" style={{ fontSize: 12 }}>
          Our server only holds the badge you synced; your chats and quotes never leave this device.
        </span>
        <button type="button" onClick={() => void deleteServerData()} disabled={busy !== ''}
          style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: 600, border: 'none', background: 'transparent',
            cursor: 'pointer', color: t.g600, textDecoration: 'underline', padding: 0 }}>
          {busy === 'delete-server' ? 'Deleting…' : 'Delete my server data'}
        </button>
      </div>
    </Shell>
  );
}

function HoloCard({ type }: { type: NonNullable<Profile['type']> }) {
  const meta = lookupType(type.code);
  const axes = (['EI', 'SN', 'TF', 'JP'] as const).map((k) => ({ word: AXIS_WORD[type.axes[k].letter] ?? type.axes[k].letter, lean: type.axes[k].lean }));
  return (
    <div className="holo" data-group={meta.group}>
      <div className="top"><span>● AI FLUENCY INDEX</span><span className="rar">{meta.group.replace(/s$/, '').toUpperCase()}</span></div>
      <div className="code">{type.code}</div>
      <div className="nm">{meta.name}</div>
      <div className="grp"><span className="gdot" />{meta.group}</div>
      <div className="stats">
        {axes.map((a, i) => (
          <div key={i}><div className="sl"><span>{a.word}</span><b>{a.lean}</b></div><div className="hbar"><i style={{ width: `${a.lean}%` }} /></div></div>
        ))}
      </div>
      <div className="hfoot"><span>AI Fluency Index</span><span>behavioral · no quiz</span></div>
    </div>
  );
}

function Tabs({ tab, onPick }: { tab: Tab; onPick: (t: Tab) => void }) {
  const item = (id: Tab, label: string) => (
    <button type="button" onClick={() => onPick(id)} aria-pressed={tab === id}
      style={{
        fontFamily: 'inherit', fontSize: 14, fontWeight: 600, border: 'none', background: 'transparent',
        cursor: 'pointer', padding: '10px 2px', color: tab === id ? t.g900 : t.g500,
        borderBottom: `2px solid ${tab === id ? t.blue : 'transparent'}`,
      }}>{label}</button>
  );
  return (
    <div style={{ display: 'flex', gap: 24, borderBottom: `1px solid ${t.g200}`, margin: '0 0 20px' }}>
      {item('personality', 'Personality')}
      {item('literacy', 'AI Fluency Index')}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: t.white }}>
      <div style={{ borderBottom: `1px solid ${t.g200}`, height: 60, display: 'flex', alignItems: 'center', padding: '0 24px' }}>
        <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', color: t.g900 }}>AI Fluency Index</span>
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
