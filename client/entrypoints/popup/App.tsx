import { useEffect, useRef, useState, type ReactNode } from 'react';
import '../../src/ui/theme.css';
import { t } from '../../src/ui/tokens';
import { chromeKv } from '../../src/store/chrome-kv';
import { migrateLegacySlots, runKey } from '../../src/store/provider';
import { buildDiagnosticReport } from '../../src/debug/dlog';

type Provider = 'claude' | 'chatgpt';
type Mode = 'init' | 'starting' | 'running' | 'done' | 'error' | 'needclaude' | 'stopped';
type Progress = { phase: 'capture' | 'evidence' | 'synthesis'; done: number; total: number } | null;

// One copy system for both providers: same run title, same phase vocabulary, same done/error
// cards. Only the honest behavioral differences remain (Claude must keep its tab open and runs
// in-session; ChatGPT runs in a background tab and can be stopped).
const RUN_TITLE: Record<Provider, string> = {
  claude: 'Profiling your Claude history…',
  chatgpt: 'Profiling your ChatGPT history…',
};
const PHASE_LABEL: Record<string, string> = {
  capture: 'Reading your conversations',
  evidence: 'Extracting evidence from your conversations',
  synthesis: 'Scoring your four fluencies',
};

function pct(p: Progress): number {
  if (!p || !p.total) return 4;
  const f = Math.min(1, p.done / p.total);
  if (p.phase === 'capture') return 4 + f * 24;
  if (p.phase === 'evidence') return 28 + f * 52;
  return 80 + f * 20;
}

async function firstTabId(globs: string[]): Promise<number | null> {
  const tabs = await chrome.tabs.query({ url: globs });
  return tabs[0]?.id ?? null;
}
async function activeUrl(): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? '';
}
function openResults() { chrome.tabs.create({ url: chrome.runtime.getURL('results.html') }); window.close(); }

async function latestVersionOf(provider: Provider): Promise<number> {
  const key = `aibadges:latestVersion:${provider}`;
  const r = await chrome.storage.local.get(key);
  return Number(r[key] ?? '0');
}

// ---------------------------------------------------------------------------

export default function App() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [override, setOverride] = useState<Provider | null>(null);
  const [unpinned, setUnpinned] = useState(false);

  useEffect(() => {
    (async () => {
      // Panels key their "profile exists" checks on the provider-namespaced slots, so make sure
      // any pre-split profile has been migrated before they mount (idempotent; results does it too).
      await migrateLegacySlots(chromeKv);
      const url = await activeUrl();
      if (url.startsWith('https://chatgpt.com/') || url.startsWith('https://chat.openai.com/')) setProvider('chatgpt');
      else setProvider('claude');
      // Someone reading this popup from the puzzle menu will lose the icon again — nudge once per open.
      try { setUnpinned(!(await chrome.action.getUserSettings()).isOnToolbar); } catch { /* old Chrome */ }
    })();
  }, []);

  const active = override ?? provider;

  return (
    <div style={{ width: 324, padding: 18, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em', color: t.g900 }}>AI Fluency Index</span>
        {active != null && <ProviderTabs active={active} onPick={setOverride} />}
      </div>
      {active == null ? <div style={{ fontSize: 13, color: t.g500 }}>Loading…</div>
        : active === 'chatgpt' ? <ChatGptPanel /> : <ClaudePanel />}
      {unpinned && (
        <div style={{ marginTop: 14, fontSize: 12, color: t.g500, background: t.g100, borderRadius: 8, padding: '7px 10px', lineHeight: 1.5 }}>
          Tip: pin this extension (puzzle piece → 📌) so your score stays one click away.
        </div>
      )}
      <DiagnosticLink />
    </div>
  );
}

// Beta support without telemetry: a local, chat-free event log the user copies and sends by hand.
function DiagnosticLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(await buildDiagnosticReport());
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch { /* clipboard denied: nothing to do */ }
      }}
      style={{ display: 'block', margin: '12px auto 0', border: 'none', background: 'none', cursor: 'pointer',
        fontFamily: 'inherit', fontSize: 11.5, color: copied ? '#12b76a' : t.g500, textDecoration: copied ? 'none' : 'underline' }}>
      {copied ? 'Copied — paste it in a message to us' : 'Having trouble? Copy diagnostic report'}
    </button>
  );
}

// Always-visible source picker so both paths are discoverable in every state; defaults to the
// active tab's provider but lets the user switch regardless of which tab they're on.
function ProviderTabs({ active, onPick }: { active: Provider; onPick: (p: Provider) => void }) {
  const tab = (p: Provider, label: string) => {
    const on = active === p;
    return (
      <button type="button" onClick={() => onPick(p)} aria-pressed={on}
        style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: 500, border: 'none', borderRadius: 50,
          padding: '5px 12px', cursor: 'pointer', background: on ? t.white : 'transparent',
          color: on ? t.g900 : t.g500, boxShadow: on ? '0 1px 2px rgba(16,24,40,.10)' : 'none' }}>
        {label}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Profile source"
      style={{ display: 'inline-flex', background: t.g100, border: `1px solid ${t.g200}`, borderRadius: 50, padding: 3, flex: '0 0 auto' }}>
      {tab('claude', 'Claude')}{tab('chatgpt', 'ChatGPT')}
    </div>
  );
}

// ---- shared cards: identical end states for both providers ----------------

function DoneCard({ onRerun }: { onRerun: () => void }) {
  return (
    <div>
      <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 2 }}>Your profile is ready</div>
      <div style={{ fontSize: 13, color: t.g600, marginBottom: 14 }}>Open it, or re-run with your latest conversations.</div>
      <button className="bb-btn bb-btn-primary" style={{ width: '100%', marginBottom: 8 }} onClick={openResults}>Open profile</button>
      <button className="bb-btn bb-btn-secondary" style={{ width: '100%' }} onClick={onRerun}>Re-run the profiling</button>
    </div>
  );
}

function ErrorCard({ err, onRetry }: { err: string; onRetry: () => void }) {
  return (
    <div>
      <Row dot={t.error}><span style={{ color: t.error, fontWeight: 500 }}>Profiling failed.</span>{err ? <span style={{ color: t.g600 }}> {err}</span> : null}</Row>
      <button className="bb-btn bb-btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={onRetry}>Try again</button>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div style={{ height: 8, background: t.g100, borderRadius: 50, overflow: 'hidden' }}>
      <div className="bb-bar-fill" style={{ height: '100%', width: `${Math.max(3, Math.min(100, value))}%`, background: t.purple, borderRadius: 50, transition: 'width .4s ease' }} />
    </div>
  );
}

// Shown above a running re-run so the previous profile stays one click away, on both providers.
function OpenCurrentProfile() {
  return (
    <button className="bb-btn bb-btn-secondary bb-btn-sm" style={{ width: '100%', marginBottom: 12 }} onClick={openResults}>
      Open your current profile
    </button>
  );
}

// ---------------------------------------------------------------------------
// Claude: in-session profiling (unchanged behavior — auto-starts when a profile isn't ready).

async function findClaudeTab(): Promise<number | null> { return firstTabId(['https://claude.ai/*']); }
async function pingAliveClaude(): Promise<boolean> {
  const id = await findClaudeTab();
  if (id == null) return false;
  return new Promise((res) => chrome.tabs.sendMessage(id, { type: 'aibadges:alive' }, (r) => res(!chrome.runtime.lastError && !!(r as { running?: boolean })?.running)));
}
async function startClaudeRun(): Promise<boolean> {
  const id = await findClaudeTab();
  if (id == null) return false;
  const send = () => new Promise<boolean>((res) => chrome.tabs.sendMessage(id, { type: 'aibadges:run' }, () => res(!chrome.runtime.lastError)));
  if (await send()) return true;
  try { await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content-scripts/claude.js'] }); } catch { return false; }
  return await send();
}

function ClaudePanel() {
  const [mode, setMode] = useState<Mode>('init');
  const [progress, setProgress] = useState<Progress>(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [err, setErr] = useState('');
  const [nowTs, setNowTs] = useState(Date.now());
  const startedAt = useRef(Date.now());
  const lastPct = useRef(0);
  const eta = useRef<{ sec: number; at: number } | null>(null);

  function recomputeEta(p: Progress) {
    const cur = pct(p);
    if (cur > lastPct.current + 0.5) {
      const elapsed = (Date.now() - startedAt.current) / 1000;
      eta.current = { sec: cur > 3 && cur < 99 ? Math.round((elapsed * (100 - cur)) / cur) : 0, at: Date.now() };
      lastPct.current = cur;
    }
  }

  async function begin() {
    setMode('starting'); setProgress(null); lastPct.current = 0; eta.current = null; startedAt.current = Date.now();
    setMode((await startClaudeRun()) ? 'running' : 'needclaude');
  }

  async function stopClaude() {
    // Tell the in-page run to abort; it winds down through its cleanup and answers with
    // 'aibadges:cancelled' (which also settles the badge + stored status via the worker).
    const id = await findClaudeTab();
    if (id != null) chrome.tabs.sendMessage(id, { type: 'aibadges:cancel' }, () => void chrome.runtime.lastError);
    setMode(hasProfile ? 'done' : 'stopped');
  }

  useEffect(() => {
    (async () => {
      const r = await chrome.storage.local.get([
        runKey('status', 'claude'), runKey('error', 'claude'), runKey('progress', 'claude'), runKey('startedAt', 'claude'),
      ]);
      const status = r[runKey('status', 'claude')] as string | undefined;
      const haveClaude = (await latestVersionOf('claude')) > 0;
      setHasProfile(haveClaude);
      startedAt.current = (r[runKey('startedAt', 'claude')] as number) || Date.now();
      if (status === 'error') { setErr(String(r[runKey('error', 'claude')] || '')); setMode('error'); return; }
      // Stopped by the user: rest state, and crucially do NOT auto-start a run they just cancelled.
      if (status === 'cancelled') { setMode(haveClaude ? 'done' : 'stopped'); return; }
      if (status === 'running') {
        if (await pingAliveClaude()) {
          const pr = (r[runKey('progress', 'claude')] as Progress) ?? null;
          setProgress(pr); lastPct.current = pct(pr);
          const elapsed = (Date.now() - startedAt.current) / 1000; const cur = pct(pr);
          if (cur > 3 && cur < 99) eta.current = { sec: Math.round((elapsed * (100 - cur)) / cur), at: Date.now() };
          setMode('running'); return;
        }
        void begin(); return;
      }
      // A Claude profile is the ground truth for "done"; auto-start only when none exists yet.
      if (haveClaude) { setMode('done'); return; }
      void begin();
    })();
    const onMsg = (m: any) => {
      if (m?.type === 'aibadges:phase') { const pr = { phase: m.phase, done: m.done, total: m.total }; setProgress(pr); recomputeEta(pr); }
      else if (m?.type === 'aibadges:start') { startedAt.current = Date.now(); lastPct.current = 0; eta.current = null; setProgress(null); setMode('running'); }
      else if (m?.type === 'aibadges:done') { setHasProfile(true); setMode('done'); }
      else if (m?.type === 'aibadges:error') { setErr(String(m.error || '')); setMode('error'); }
      else if (m?.type === 'aibadges:cancelled') { void latestVersionOf('claude').then((v) => setMode(v > 0 ? 'done' : 'stopped')); }
    };
    chrome.runtime.onMessage.addListener(onMsg);
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => { chrome.runtime.onMessage.removeListener(onMsg); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = mode === 'running' || mode === 'starting';
  const p = pct(progress);
  const etaLeft = eta.current ? Math.max(0, Math.round(eta.current.sec - (nowTs - eta.current.at) / 1000)) : null;
  const etaText = !running ? '' : etaLeft == null ? 'estimating…' : etaLeft > 1 ? `~${etaLeft}s left` : 'almost done…';

  return (
    <div>
      {hasProfile && running && <OpenCurrentProfile />}

      {running && (
        <div>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 2 }}>{RUN_TITLE.claude}</div>
          <div style={{ fontSize: 13, color: t.g600, marginBottom: 12 }}>{progress ? PHASE_LABEL[progress.phase] : 'Starting…'}</div>
          <ProgressBar value={p} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: t.g500, marginTop: 6 }}>
            <span>{Math.round(p)}%</span><span>{etaText}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 14, fontSize: 12.5, color: '#7a4a12', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '9px 11px' }}>
            <span style={{ flex: '0 0 auto' }}>⚠️</span>
            <span><b>Keep this Claude.ai tab open</b> until it finishes. The analysis runs inside your session, so closing the tab stops it. You can close this popup; the run keeps going and the icon turns green when it’s ready. Nothing is added to your Claude history, and your chats are never sent to our servers.</span>
          </div>
          <button className="bb-btn bb-btn-secondary bb-btn-sm" style={{ width: '100%', marginTop: 12 }} onClick={stopClaude}>Stop</button>
        </div>
      )}

      {mode === 'stopped' && (
        <div>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 2 }}>Run stopped</div>
          <div style={{ fontSize: 13, color: t.g600, marginBottom: 14, lineHeight: 1.5 }}>
            Nothing was saved and your Claude history is untouched.
          </div>
          <button className="bb-btn bb-btn-primary" style={{ width: '100%' }} onClick={begin}>Start again</button>
        </div>
      )}

      {mode === 'done' && <DoneCard onRerun={begin} />}
      {mode === 'error' && <ErrorCard err={err} onRetry={begin} />}

      {mode === 'needclaude' && (
        <Row dot={t.g300}>Open <b>claude.ai</b> in a tab, then click the icon again to profile.</Row>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatGPT: invisible autorun in a background tab (starts on click, can be stopped).

type CgMode = 'idle' | 'capturing' | 'done' | 'error';

function ChatGptPanel() {
  const [mode, setMode] = useState<CgMode>('idle');
  const [prog, setProg] = useState<{ done: number; total: number; phase?: string } | null>(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const r = await chrome.storage.local.get([
        'aibadges:cg:running', runKey('progress', 'chatgpt'), runKey('status', 'chatgpt'), runKey('error', 'chatgpt'),
      ]);
      const haveChatGpt = (await latestVersionOf('chatgpt')) > 0;
      setHasProfile(haveChatGpt);
      // Reattach to an in-flight run from durable storage (the background persists cg:running +
      // progress), so reopening the popup mid-run shows the progress bar, not the start button.
      if (r['aibadges:cg:running']) {
        setMode('capturing');
        const p = r[runKey('progress', 'chatgpt')] as { done?: number; total?: number; phase?: string } | null;
        if (p && typeof p.done === 'number') setProg({ done: p.done, total: p.total ?? 0, phase: p.phase });
      } else if (r[runKey('status', 'chatgpt')] === 'error') {
        // A run that failed while the popup was closed: show its (provider-correct) stored error.
        setErr(String(r[runKey('error', 'chatgpt')] || ''));
        setMode('error');
      } else if (haveChatGpt) {
        setMode('done');
      }
    })();
    const onMsg = (m: any) => {
      if (m?.type === 'aibadges:cg-phase') setProg({ done: m.done, total: m.total, phase: m.phase });
      else if (m?.type === 'aibadges:cg-start') { setProg(null); setMode('capturing'); }
      else if (m?.type === 'aibadges:cg-autorun-done') { setHasProfile(true); setMode('done'); }
      else if (m?.type === 'aibadges:cg-autorun-error' || m?.type === 'aibadges:cg-error') { setErr(String(m.error || '')); setMode('error'); }
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, []);

  async function capture() {
    setErr(''); setProg(null); setMode('capturing');
    // Fire-and-forget to the service worker: it opens chatgpt.com in a background tab and runs the
    // whole thing invisibly (capture, analyze in a throwaway conversation, delete, import).
    chrome.runtime.sendMessage({ type: 'aibadges:cg-autorun' });
  }

  function stop() {
    // Tell the worker to tear down (close the background tab, clear run state); reset the popup.
    chrome.runtime.sendMessage({ type: 'aibadges:cg-cancel' }, () => void chrome.runtime.lastError);
    setProg(null); setErr('');
    setMode(hasProfile ? 'done' : 'idle');
  }

  const p = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 4;

  return (
    <div>
      {hasProfile && mode === 'capturing' && <OpenCurrentProfile />}

      {mode === 'idle' && (
        <div>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 2 }}>Profile your ChatGPT history</div>
          <div style={{ fontSize: 13, color: t.g600, marginBottom: 14, lineHeight: 1.5 }}>
            Runs in the background using your own ChatGPT session. Nothing is added to your ChatGPT history, and your chats are never sent to our servers.
          </div>
          <button className="bb-btn bb-btn-primary" style={{ width: '100%' }} onClick={capture}>Start profiling</button>
        </div>
      )}

      {mode === 'capturing' && (
        <div>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 2 }}>{RUN_TITLE.chatgpt}</div>
          <div style={{ fontSize: 13, color: t.g600, marginBottom: 12 }}>
            {prog?.phase === 'analysis'
              ? (() => {
                  // total = extraction batches + synthesis + audit, done = COMPLETED steps; naming
                  // the step makes a multi-minute GPT turn read as progress, not a hang. The
                  // extraction batches run in parallel tabs, so the label counts completions
                  // instead of pretending they happen one at a time.
                  // batches can be 0 on an incremental re-run with nothing new — it goes straight
                  // to synthesis, so the extraction label must never show.
                  const total = prog.total || 4;
                  const batches = Math.max(0, total - 2);
                  if (prog.done < batches) return `Step ${prog.done + 1} of ${total}: extracting evidence from your conversations (${prog.done}/${batches} batches done)`;
                  if (prog.done === batches) return `Step ${prog.done + 1} of ${total}: scoring your four fluencies — the longest step`;
                  return `Step ${Math.min(prog.done + 1, total)} of ${total}: adversarial audit of the scores`;
                })()
              : (prog ? `${PHASE_LABEL.capture} — ${prog.done} / ${prog.total}` : 'Starting…')}
          </div>
          <ProgressBar value={p} />
          <div style={{ fontSize: 12, color: t.g500, marginTop: 8 }}>Runs in a background tab — you can switch tabs or close this popup; the run keeps going. Nothing is added to your ChatGPT history, and your chats are never sent to our servers.</div>
          <button className="bb-btn bb-btn-secondary bb-btn-sm" style={{ width: '100%', marginTop: 12 }} onClick={stop}>Stop</button>
        </div>
      )}

      {mode === 'done' && <DoneCard onRerun={capture} />}
      {mode === 'error' && <ErrorCard err={err} onRetry={capture} />}
    </div>
  );
}

function Row({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13, color: t.g700, lineHeight: 1.5 }}>
      <span className="bb-dot" style={{ background: dot, marginTop: 5, flex: '0 0 auto' }} />
      <span>{children}</span>
    </div>
  );
}
