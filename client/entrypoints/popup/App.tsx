import { useEffect, useRef, useState, type ReactNode } from 'react';
import '../../src/ui/theme.css';
import { t } from '../../src/ui/tokens';

type Provider = 'claude' | 'chatgpt';
type Mode = 'init' | 'starting' | 'running' | 'done' | 'error' | 'needclaude';
type Progress = { phase: 'capture' | 'evidence' | 'synthesis'; done: number; total: number } | null;

const PHASE_LABEL: Record<string, string> = {
  capture: 'Reading your conversations', evidence: 'Analyzing how you think', synthesis: 'Synthesizing your profile',
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

// ---------------------------------------------------------------------------

export default function App() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [override, setOverride] = useState<Provider | null>(null);

  useEffect(() => {
    (async () => {
      const url = await activeUrl();
      if (url.startsWith('https://chatgpt.com/') || url.startsWith('https://chat.openai.com/')) setProvider('chatgpt');
      else setProvider('claude');
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
    </div>
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

  useEffect(() => {
    (async () => {
      const r = await chrome.storage.local.get(['aibadges:status', 'aibadges:error', 'aibadges:progress', 'aibadges:startedAt']);
      const status = r['aibadges:status'] as string | undefined;
      startedAt.current = (r['aibadges:startedAt'] as number) || Date.now();
      if (status === 'done') { setMode('done'); return; }
      if (status === 'error') { setErr(String(r['aibadges:error'] || '')); setMode('error'); return; }
      if (status === 'running') {
        if (await pingAliveClaude()) {
          const pr = (r['aibadges:progress'] as Progress) ?? null;
          setProgress(pr); lastPct.current = pct(pr);
          const elapsed = (Date.now() - startedAt.current) / 1000; const cur = pct(pr);
          if (cur > 3 && cur < 99) eta.current = { sec: Math.round((elapsed * (100 - cur)) / cur), at: Date.now() };
          setMode('running'); return;
        }
        void begin(); return;
      }
      void begin();
    })();
    const onMsg = (m: any) => {
      if (m?.type === 'aibadges:phase') { const pr = { phase: m.phase, done: m.done, total: m.total }; setProgress(pr); recomputeEta(pr); }
      else if (m?.type === 'aibadges:start') { startedAt.current = Date.now(); lastPct.current = 0; eta.current = null; setProgress(null); setMode('running'); }
      else if (m?.type === 'aibadges:done') setMode('done');
      else if (m?.type === 'aibadges:error') { setErr(String(m.error || '')); setMode('error'); }
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
      {running && (
        <div>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 2 }}>Profiling your Claude history…</div>
          <div style={{ fontSize: 13, color: t.g600, marginBottom: 12 }}>{progress ? PHASE_LABEL[progress.phase] : 'Starting…'}</div>
          <div style={{ height: 8, background: t.g100, borderRadius: 50, overflow: 'hidden' }}>
            <div className="bb-bar-fill" style={{ height: '100%', width: `${Math.max(3, Math.min(100, p))}%`, background: t.blue, borderRadius: 50, transition: 'width .4s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: t.g500, marginTop: 6 }}>
            <span>{Math.round(p)}%</span><span>{etaText}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 14, fontSize: 12.5, color: '#7a4a12', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '9px 11px' }}>
            <span style={{ flex: '0 0 auto' }}>⚠️</span>
            <span><b>Keep this Claude.ai tab open</b> until it finishes. The analysis runs inside your session, so closing the tab stops it. You can safely close this popup; the run keeps going in the background and the icon turns green when it’s ready.</span>
          </div>
        </div>
      )}

      {mode === 'done' && (
        <div>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 2 }}>Your profile is ready</div>
          <div style={{ fontSize: 13, color: t.g600, marginBottom: 14 }}>Open it, or re-run with your latest conversations.</div>
          <button className="bb-btn bb-btn-primary" style={{ width: '100%', marginBottom: 8 }} onClick={openResults}>Open profile</button>
          <button className="bb-btn bb-btn-secondary" style={{ width: '100%' }} onClick={begin}>Re-run the profiling</button>
        </div>
      )}

      {mode === 'error' && (
        <div>
          <Row dot={t.error}><span style={{ color: t.error, fontWeight: 500 }}>Profiling failed.</span>{err ? <span style={{ color: t.g600 }}> {err}</span> : null}</Row>
          <button className="bb-btn bb-btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={begin}>Try again</button>
        </div>
      )}

      {mode === 'needclaude' && (
        <Row dot={t.g300}>Open <b>claude.ai</b> in a tab, then click the icon again to profile.</Row>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatGPT: capture-only, then hand off to the GPT page (no auto-start; capture on click).

type CgMode = 'idle' | 'capturing' | 'error';
const CAPTURE_KEY = 'aibadges:chatgpt:capture';

async function findChatGptTab(): Promise<number | null> { return firstTabId(['https://chatgpt.com/*', 'https://chat.openai.com/*']); }
async function pingCaptureAlive(): Promise<boolean> {
  const id = await findChatGptTab();
  if (id == null) return false;
  return new Promise((res) => chrome.tabs.sendMessage(id, { type: 'aibadges:cg-alive' }, (r) => res(!chrome.runtime.lastError && !!(r as { running?: boolean })?.running)));
}
async function startCapture(): Promise<boolean> {
  const id = await findChatGptTab();
  if (id == null) return false;
  // Resolve the content script's actual reply: ok:true (started) OR ok:false+already running both
  // mean "a run is now active and will emit cg-phase/cg-done" — only a transport failure is false.
  const send = () => new Promise<boolean>((res) => chrome.tabs.sendMessage(id, { type: 'aibadges:cg-capture' }, (r) => {
    if (chrome.runtime.lastError) { res(false); return; }
    const resp = r as { ok?: boolean; error?: string } | undefined;
    res(resp?.ok === true || resp?.error === 'already running');
  }));
  if (await send()) return true;
  try { await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content-scripts/chatgpt-capture.js'] }); } catch { return false; }
  return await send();
}
function ChatGptPanel() {
  const [mode, setMode] = useState<CgMode>('idle');
  const [prog, setProg] = useState<{ done: number; total: number; phase?: string } | null>(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const r = await chrome.storage.local.get(['aibadges:status', 'aibadges:cg:running', 'aibadges:progress']);
      setHasProfile(r['aibadges:status'] === 'done');
      // Reattach to an in-flight run from durable storage (the background persists cg:running +
      // progress), so reopening the popup mid-run shows the progress bar, not the start button.
      if (r['aibadges:cg:running']) {
        setMode('capturing');
        const p = r['aibadges:progress'] as { done?: number; total?: number; phase?: string } | null;
        if (p && typeof p.done === 'number') setProg({ done: p.done, total: p.total ?? 0, phase: p.phase });
      }
    })();
    const onMsg = (m: any) => {
      if (m?.type === 'aibadges:cg-phase') setProg({ done: m.done, total: m.total, phase: m.phase });
      else if (m?.type === 'aibadges:cg-start') { setProg(null); setMode('capturing'); }
      else if (m?.type === 'aibadges:cg-autorun-done') { setHasProfile(true); setMode('idle'); }
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
    setProg(null); setErr(''); setMode('idle');
  }

  const p = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 4;

  return (
    <div>
      {hasProfile && mode !== 'capturing' && (
        <button className="bb-btn bb-btn-secondary bb-btn-sm" style={{ width: '100%', marginBottom: 12 }} onClick={openResults}>
          Open your profile
        </button>
      )}

      {mode === 'idle' && (
        <div>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 2 }}>Profile from ChatGPT</div>
          <div style={{ fontSize: 13, color: t.g600, marginBottom: 14, lineHeight: 1.5 }}>
            Runs in the background using your own ChatGPT session. Nothing is added to your chat history, and your chats are never sent to our servers.
          </div>
          <button className="bb-btn bb-btn-primary" style={{ width: '100%' }} onClick={capture}>Profile my ChatGPT</button>
        </div>
      )}

      {mode === 'capturing' && (
        <div>
          <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 2 }}>{prog?.phase === 'analysis' ? 'Analyzing in your ChatGPT…' : 'Reading your ChatGPT history…'}</div>
          <div style={{ fontSize: 13, color: t.g600, marginBottom: 12 }}>
            {prog?.phase === 'analysis'
              ? (() => {
                  // total = extraction batches + synthesis + audit; naming the step makes a
                  // multi-minute GPT-5.5 turn read as progress, not a hang.
                  const total = prog.total || 4;
                  const batches = Math.max(1, total - 2);
                  if (prog.done < batches) return `Step ${prog.done + 1} of ${total}: extracting evidence (batch ${prog.done + 1}/${batches}) — a few minutes per step`;
                  if (prog.done === batches) return `Step ${prog.done + 1} of ${total}: scoring your four fluencies — the longest step`;
                  return `Step ${Math.min(prog.done + 1, total)} of ${total}: adversarial audit of the scores`;
                })()
              : (prog ? `${prog.done} / ${prog.total} conversations` : 'Starting…')}
          </div>
          <div style={{ height: 8, background: t.g100, borderRadius: 50, overflow: 'hidden' }}>
            <div className="bb-bar-fill" style={{ height: '100%', width: `${Math.max(3, Math.min(100, p))}%`, background: t.purple, borderRadius: 50, transition: 'width .4s ease' }} />
          </div>
          <div style={{ fontSize: 12, color: t.g500, marginTop: 8 }}>Runs in a background tab and opens your profile here automatically. You can switch tabs; nothing is added to your ChatGPT history.</div>
          <button className="bb-btn bb-btn-secondary bb-btn-sm" style={{ width: '100%', marginTop: 12 }} onClick={stop}>Stop</button>
        </div>
      )}

      {mode === 'error' && (
        <div>
          <Row dot={t.error}><span style={{ color: t.error, fontWeight: 500 }}>Capture failed.</span>{err ? <span style={{ color: t.g600 }}> {err}</span> : null}</Row>
          <button className="bb-btn bb-btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={capture}>Try again</button>
        </div>
      )}
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
