import { useEffect, useState, type ReactNode } from 'react';
import '../../src/ui/theme.css';
import { t } from '../../src/ui/tokens';
import type { CaptureBundle } from '../../src/capture/chatgpt-export';
import { exportSize } from '../../src/capture/chatgpt-export';
import { buildBridgePrompt } from '../../src/capture/chatgpt-prompt';
import { GptImportError } from '../../src/engine/chatgpt-import';
import { importGptReply, loadCaptureBundle } from '../../src/run/import-chatgpt';
import { chromeKv } from '../../src/store/chrome-kv';
import { CHATGPT_GPT_URL } from '../../src/config';

type Bridge = 'idle' | 'opening' | 'watching' | 'done' | 'error';

function waitForTabComplete(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; chrome.tabs.onUpdated.removeListener(onUpd); resolve(); } };
    const onUpd = (id: number, info: chrome.tabs.TabChangeInfo) => { if (id === tabId && info.status === 'complete') finish(); };
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId, (tab) => { if (!chrome.runtime.lastError && tab?.status === 'complete') finish(); });
    setTimeout(finish, timeoutMs);
  });
}
async function sendBridge(tabId: number, prompt: string): Promise<boolean> {
  const send = () => new Promise<boolean>((res) =>
    chrome.tabs.sendMessage(tabId, { type: 'aibadges:cg-bridge', prompt }, (r) => res(!chrome.runtime.lastError && !!(r as { ok?: boolean })?.ok)));
  if (await send()) return true;
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/chatgpt-capture.js'] }); } catch { return false; }
  return await send();
}

export default function App() {
  const [bundle, setBundle] = useState<CaptureBundle | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bridge, setBridge] = useState<Bridge>('idle');
  const [bridgeMsg, setBridgeMsg] = useState('');

  useEffect(() => {
    (async () => { setBundle(await loadCaptureBundle(chromeKv)); setLoaded(true); })();
    const onMsg = (m: any) => {
      if (m?.type === 'aibadges:cg-bridge-done') { setBridge('done'); setBridgeMsg('Your profile is ready — opening it in a new tab.'); }
      else if (m?.type === 'aibadges:cg-bridge-error') { setBridge('error'); setBridgeMsg(String(m.error || 'Could not read the reply automatically.')); }
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, []);

  const convoCount = bundle?.export.conversations.length ?? 0;
  const sizeK = bundle ? Math.round(exportSize(bundle) / 1000) : 0;
  const large = sizeK > 45; // ~free-tier single-message comfort ceiling
  const payload = bundle ? JSON.stringify(bundle.export, null, 2) : '';

  async function copyData() {
    await navigator.clipboard.writeText(payload);
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  }
  function downloadData() {
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'aibadges-chatgpt-data.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function runInChatGpt() {
    if (!bundle) return;
    setBridge('opening'); setBridgeMsg('');
    try {
      const prompt = buildBridgePrompt(bundle);
      const tab = await chrome.tabs.create({ url: 'https://chatgpt.com/' });
      const tabId = tab.id;
      if (tabId == null) throw new Error('Could not open a ChatGPT tab.');
      await waitForTabComplete(tabId);
      const ok = await sendBridge(tabId, prompt);
      if (!ok) { setBridge('error'); setBridgeMsg('Could not reach the ChatGPT tab. Use the manual option below.'); return; }
      setBridge('watching');
    } catch (e) {
      setBridge('error'); setBridgeMsg(String((e as Error)?.message ?? e));
    }
  }

  async function build() {
    if (!bundle || !paste.trim()) return;
    setBusy(true); setErr('');
    try {
      const profile = await importGptReply(paste, { kv: chromeKv });
      try { chrome.runtime.sendMessage({ type: 'aibadges:done', version: profile.version }); } catch { /* noop */ }
      window.location.href = chrome.runtime.getURL('results.html');
    } catch (e) {
      console.warn('[aibadges] import failed', e);
      setErr(e instanceof GptImportError ? e.message : "Couldn't build your profile from that paste. Make sure you copied the GPT's full JSON reply.");
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="bb-eyebrow" style={{ color: t.purple }}>ChatGPT · self-run</div>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.01em', margin: '8px 0 8px' }}>
        Build your profile from ChatGPT
      </h1>
      <p className="bb-muted" style={{ fontSize: 16, margin: 0, maxWidth: 620, lineHeight: 1.55 }}>
        Your chats are analyzed by your own ChatGPT, not by us. Only the resulting badge is ever sent to
        our servers, never your conversations.
      </p>

      {!loaded ? (
        <div className="bb-card" style={{ marginTop: 24, color: t.g600 }}>Loading…</div>
      ) : !bundle || convoCount === 0 ? (
        <div className="bb-card" style={{ marginTop: 24 }}>
          <div style={{ fontWeight: 500, fontSize: 17, marginBottom: 6 }}>No capture yet</div>
          <p className="bb-muted" style={{ margin: '0 0 4px', lineHeight: 1.55 }}>
            Open <b style={{ color: t.g900 }}>chatgpt.com</b> (signed in), click the AIBadges icon, and choose
            <b style={{ color: t.g900 }}> Capture my ChatGPT history</b>. Then come back to this page.
          </p>
        </div>
      ) : (
        <>
          <section className="bb-card" style={{ marginTop: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: t.purple, color: '#fff', fontWeight: 700,
                fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>★</span>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Run it in your ChatGPT</h2>
            </div>
            <p className="bb-muted" style={{ margin: '0 0 14px', lineHeight: 1.55 }}>
              Captured <b style={{ color: t.g900 }}>{convoCount} conversations</b> (~{sizeK}k characters). We'll open
              ChatGPT, run the analysis in your own session, read the result, and build your profile automatically.
              No copy-paste, no sending anything yourself.
            </p>

            {bridge === 'idle' && (
              <button className="bb-btn bb-btn-primary" onClick={runInChatGpt}>Run it in ChatGPT →</button>
            )}
            {bridge === 'opening' && <div className="bb-muted" style={{ fontSize: 14 }}>Opening ChatGPT…</div>}
            {bridge === 'watching' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, color: '#0b4a6f',
                background: t.blue50, border: `1px solid ${t.blue100}`, borderRadius: 10, padding: '10px 12px' }}>
                <span>⏳</span>
                <span>Running your analysis in the ChatGPT tab. We'll open your profile here automatically when it's
                  done. Keep that tab open, and if ChatGPT asks you to confirm, press <b>Enter</b> in that tab.</span>
              </div>
            )}
            {bridge === 'done' && (
              <div style={{ fontSize: 14, color: t.successText, background: t.successBg, borderRadius: 10, padding: '10px 12px' }}>
                ✓ {bridgeMsg}
              </div>
            )}
            {bridge === 'error' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, color: '#7a1d12',
                background: '#fff4f3', border: '1px solid #fecdca', borderRadius: 10, padding: '10px 12px' }}>
                <span>⚠️</span><span>{bridgeMsg} You can use the manual option below.</span>
              </div>
            )}
            {large && bridge === 'idle' && (
              <p className="bb-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                Heads up: this capture is large, which can exceed a single free-tier message. If the run stalls, use the
                manual <b>Download .json</b> + upload option below.
              </p>
            )}
          </section>

          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: 14, color: t.g600, fontWeight: 500 }}>Prefer to do it manually?</summary>

            <Step n={1} title="Send your conversations to the AIBadges GPT" accent={t.g500}>
              <p className="bb-muted" style={{ margin: '0 0 14px', lineHeight: 1.55 }}>
                Copy the data or download the file, open the GPT, and paste/upload it as your first message.
              </p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="bb-btn bb-btn-secondary" onClick={copyData}>{copied ? 'Copied ✓' : 'Copy data'}</button>
                <button className="bb-btn bb-btn-secondary" onClick={downloadData}>Download .json</button>
                <a className="bb-btn bb-btn-secondary" href={CHATGPT_GPT_URL} target="_blank" rel="noreferrer"
                  style={{ textDecoration: 'none', display: 'inline-block' }}>Open the AIBadges GPT ↗</a>
              </div>
            </Step>

            <Step n={2} title="Paste the GPT's reply back here" accent={t.g500}>
              <p className="bb-muted" style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
                Copy the GPT's whole JSON reply and paste it below. We keep the quotes on this device and send only the
                badge onward.
              </p>
              <textarea
                value={paste} onChange={(e) => setPaste(e.target.value)} spellCheck={false}
                placeholder='{ "thinking": [...], "trajectory": {...}, "type": {...}, "evidence": [...] }'
                style={{ width: '100%', minHeight: 150, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12.5, lineHeight: 1.5, color: t.g800, border: `1px solid ${t.g300}`, borderRadius: 10,
                  padding: 12, resize: 'vertical', background: '#fff' }} />
              {err && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 13,
                  color: '#7a1d12', background: '#fff4f3', border: '1px solid #fecdca', borderRadius: 10, padding: '10px 12px' }}>
                  <span>⚠️</span><span>{err}</span>
                </div>
              )}
              <button className="bb-btn bb-btn-primary" disabled={busy || !paste.trim()} onClick={build} style={{ marginTop: 14 }}>
                {busy ? 'Building your profile…' : 'Build my profile'}
              </button>
            </Step>
          </details>
        </>
      )}

      <footer className="bb-muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 34, paddingTop: 18,
        borderTop: `1px solid ${t.g200}`, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
        Computed by your own ChatGPT from your chats. Claims appear only when backed by quotes you can inspect.
        We store the badge, never your conversations.
      </footer>
    </Shell>
  );
}

function Step({ n, title, accent, children }: { n: number; title: string; accent: string; children: ReactNode }) {
  return (
    <section className="bb-card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, background: accent, color: '#fff', fontWeight: 700,
          fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{n}</span>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: t.white }}>
      <div style={{ borderBottom: `1px solid ${t.g200}`, height: 60, display: 'flex', alignItems: 'center', padding: '0 24px' }}>
        <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.01em', color: t.g900 }}>AIBadges</span>
        <span style={{ marginLeft: 12, paddingLeft: 12, borderLeft: `1px solid ${t.g200}`, color: t.g600, fontSize: 14 }}>living profile</span>
      </div>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '34px 24px 60px' }}>{children}</main>
    </div>
  );
}
