import { useEffect, useState } from 'react';
import '../../src/ui/theme.css';
import { t } from '../../src/ui/tokens';

// One-time onboarding page, opened by the service worker on FRESH INSTALL only. Its single job
// is getting the extension pinned (Chrome buries new extensions behind the puzzle-piece menu, and
// an unpinned extension is never used again). Chrome reserves pinning itself for the user, but
// chrome.action.getUserSettings().isOnToolbar lets us watch for it and celebrate live.

function usePinned(): boolean {
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const s = await chrome.action.getUserSettings();
        if (alive) setPinned(!!s.isOnToolbar);
      } catch { /* very old Chrome: keep showing the instructions */ }
    };
    void check();
    const timer = setInterval(check, 1000); // live: flips the moment the user pins
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return pinned;
}

const open = (url: string) => { void chrome.tabs.create({ url }); };

export default function App() {
  const pinned = usePinned();

  return (
    <div style={{ minHeight: '100vh', background: '#fbfafd', fontFamily: 'Inter, system-ui, sans-serif', color: t.g900 }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 24px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <img src="/icon/48.png" alt="" width={28} height={28} style={{ borderRadius: 6 }} />
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>AI Fluency Index</span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: '18px 0 6px' }}>
          Two steps and you're measuring
        </h1>
        <p style={{ fontSize: 15, color: t.g600, lineHeight: 1.55, margin: '0 0 28px' }}>
          Your chats never leave your own AI session — the analysis runs there, and only you decide
          if anything is shared.
        </p>

        {/* Step 1: pin */}
        <div style={{
          background: t.white, border: `1px solid ${pinned ? '#a6f4c5' : '#e5e7eb'}`, borderRadius: 14,
          padding: '18px 20px', marginBottom: 14, transition: 'border-color .3s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StepDot done={pinned} n={1} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {pinned ? 'Pinned — you’ll always find it' : 'Pin the extension'}
            </span>
          </div>
          {!pinned && (
            <div style={{ fontSize: 14, color: t.g600, lineHeight: 1.6, marginTop: 10, paddingLeft: 34 }}>
              Click the puzzle piece <PuzzleIcon /> at the top-right of Chrome, then the pin
              <PinIcon /> next to <b>AI Fluency Index</b>. This page notices as soon as you do.
            </div>
          )}
        </div>

        {/* Step 2: run */}
        <div style={{ background: t.white, border: '1px solid #e5e7eb', borderRadius: 14, padding: '18px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <StepDot done={false} n={2} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Open your AI and click the icon</span>
          </div>
          <div style={{ fontSize: 14, color: t.g600, lineHeight: 1.6, paddingLeft: 34, marginBottom: 14 }}>
            Sign in as usual, click the toolbar icon, and start a run. A few minutes later you get
            your four fluencies and a 1-100 score, every claim backed by your own words.
          </div>
          <div style={{ display: 'flex', gap: 10, paddingLeft: 34 }}>
            <button className="bb-btn bb-btn-primary" onClick={() => open('https://claude.ai/')}>Open Claude</button>
            <button className="bb-btn bb-btn-secondary" onClick={() => open('https://chatgpt.com/')}>Open ChatGPT</button>
          </div>
        </div>

        <p style={{ fontSize: 12.5, color: t.g500, marginTop: 26, lineHeight: 1.6 }}>
          Private by default. Nothing is added to your chat history, and your conversations are
          never sent to our servers.
        </p>
      </div>
    </div>
  );
}

function StepDot({ done, n }: { done: boolean; n: number }) {
  return (
    <span style={{
      width: 24, height: 24, borderRadius: 24, flex: '0 0 auto', display: 'grid', placeItems: 'center',
      fontSize: 12.5, fontWeight: 700, transition: 'all .3s ease',
      background: done ? '#12b76a' : t.g100, color: done ? t.white : t.g700,
    }}>
      {done ? '✓' : n}
    </span>
  );
}

// Inline glyphs so the instructions read visually, with no external assets (store CSP-safe).
function PuzzleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: '-2px', margin: '0 2px' }} aria-label="Extensions menu">
      <path d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5Z" stroke={t.g600} strokeWidth="1.6" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: '-2px', margin: '0 2px' }} aria-label="Pin">
      <path d="M16 3l5 5-6.5 2.5L12 14l-2-2-6 8 8-6-2-2 3.5-2.5L16 3Z" stroke={t.g600} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
