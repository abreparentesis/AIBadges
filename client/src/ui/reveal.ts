import type { Provider } from '../store/provider';
import { PROVIDER_LABEL } from '../store/provider';

/**
 * Self-reveal on the provider's own site. An unpinned extension is invisible (Chrome buries it
 * behind the puzzle menu), but our content scripts already run on claude.ai / chatgpt.com — the
 * only places the product can act. So for users who installed but never ran a profile, a small
 * dismissible pill introduces the product exactly where it works. Constraints that keep this
 * onboarding rather than spam (and store-review safe): it shows only while NO profile exists for
 * the provider, one dismissal hides it permanently, and it never mounts in our own hidden worker
 * tabs (callers gate on tab visibility).
 */

export const dismissKey = (provider: Provider): string => `aibadges:revealDismissed:${provider}`;

/** Pure decision: reveal only for never-ran users who have not dismissed the pill. */
export function shouldReveal(latestVersion: number, dismissed: unknown): boolean {
  return latestVersion === 0 && !dismissed;
}

export async function maybeMountReveal(provider: Provider, onStart: () => void): Promise<void> {
  const versionKey = `aibadges:latestVersion:${provider}`;
  const got = await chrome.storage.local.get([versionKey, dismissKey(provider)]);
  if (!shouldReveal(Number(got[versionKey] ?? '0'), got[dismissKey(provider)])) return;

  // Never in background tabs (our ChatGPT worker tabs live there); wait for first visibility.
  if (document.visibilityState !== 'visible') {
    await new Promise<void>((res) => {
      const onVis = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', onVis); res(); } };
      document.addEventListener('visibilitychange', onVis);
    });
    // Re-check: the run that spawned this hidden tab may have produced a profile meanwhile.
    const again = await chrome.storage.local.get([versionKey, dismissKey(provider)]);
    if (!shouldReveal(Number(again[versionKey] ?? '0'), again[dismissKey(provider)])) return;
  }

  mount(provider, onStart);
}

function mount(provider: Provider, onStart: () => void): void {
  if (document.getElementById('aibadges-reveal')) return;
  const host = document.createElement('div');
  host.id = 'aibadges-reveal';
  const root = host.attachShadow({ mode: 'closed' }); // isolated from the page's CSS
  root.innerHTML = `
    <style>
      .pill { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
        display: flex; align-items: center; gap: 10px; max-width: 340px;
        background: #fff; color: #111927; border: 1px solid #e5e7eb; border-radius: 14px;
        box-shadow: 0 8px 28px rgba(16,24,40,.14); padding: 12px 14px;
        font: 13px/1.5 Inter, system-ui, sans-serif; }
      @media (prefers-color-scheme: dark) {
        .pill { background: #1f2a37; color: #f3f4f6; border-color: #384250; } .x { color: #9da4ae; } }
      .txt b { font-weight: 650; }
      .go { flex: 0 0 auto; border: 0; border-radius: 50px; padding: 7px 14px; cursor: pointer;
        background: #5737f4; color: #fff; font: 600 12.5px Inter, system-ui, sans-serif; }
      .x { flex: 0 0 auto; border: 0; background: none; cursor: pointer; font-size: 15px;
        color: #6c737f; padding: 2px 4px; line-height: 1; }
    </style>
    <div class="pill" role="dialog" aria-label="AI Fluency Index">
      <span class="txt"><b>How skillfully do you use AI?</b><br>Score your ${PROVIDER_LABEL[provider]} history — private, ~3 min.</span>
      <button class="go">Measure</button>
      <button class="x" aria-label="Dismiss">✕</button>
    </div>`;
  root.querySelector('.go')!.addEventListener('click', () => { host.remove(); onStart(); });
  root.querySelector('.x')!.addEventListener('click', () => {
    void chrome.storage.local.set({ [dismissKey(provider)]: Date.now() }); // permanent, by design
    host.remove();
  });
  document.documentElement.appendChild(host);
}
