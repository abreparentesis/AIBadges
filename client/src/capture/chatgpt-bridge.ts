import { importGptReply } from '../run/import-chatgpt';

// In-page bridge: prefill the ChatGPT composer with the AI Fluency Index prompt+data, submit it, then read
// the finished reply from the DOM and import it. Submit is automatic: we click ChatGPT's own send
// button, so ChatGPT's frontend computes the sentinel/Turnstile token and issues the request from the
// user's own logged-in session (a scripted click still fires ChatGPT's send handler). If a challenge
// is showing or the click never takes, we fall back to asking the user to press Enter. All DOM
// coupling lives here; selectors are multi-fallback because ChatGPT's UI changes, and any miss
// degrades to the manual paste flow.

type Notify = (m: Record<string, unknown>) => void;

const COMPOSER_SELECTORS = [
  '#prompt-textarea',
  'textarea[data-testid="prompt-textarea"]',
  'main form textarea',
  'div[contenteditable="true"]#prompt-textarea',
  'div[contenteditable="true"]',
  'textarea',
];
const STOP_SELECTORS = ['[data-testid="stop-button"]', 'button[aria-label*="Stop"]', 'button[data-testid="composer-stop-button"]'];
const SEND_SELECTORS = ['#composer-submit-button', 'button[data-testid="send-button"]', 'button[aria-label="Send prompt"]', 'button[aria-label*="Send"]', 'main form button[type="submit"]'];
const CHALLENGE_SELECTORS = ['iframe[src*="challenges.cloudflare.com"]', '[id*="turnstile"]', '[class*="turnstile"]'];
const MODEL_PICKER_SELECTORS = [
  'button[data-testid="model-switcher-dropdown-button"]',
  'button[aria-label*="model" i]',
  'button[aria-label*="ChatGPT" i]',
];
const MODEL_ITEM_SELECTORS = [
  '[role="menuitem"]',
  '[role="option"]',
  'button',
];

export type ChatGptModelPolicy = 'current' | 'extract' | 'best';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function normLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

function isUnavailableModelLabel(label: string): boolean {
  return /\b(upgrade|unavailable|limit reached|coming soon|disabled)\b/i.test(label);
}

function isNonChatModelLabel(label: string): boolean {
  return /\b(deep research|research|agent|operator|image|video|canvas|temporary chat|settings|customize)\b/i.test(label);
}

export function scoreChatGptModelLabel(label: string, policy: Exclude<ChatGptModelPolicy, 'current'>): number {
  const s = normLabel(label).toLowerCase();
  if (!s || isUnavailableModelLabel(s) || isNonChatModelLabel(s)) return -Infinity;
  if (policy === 'extract') {
    let score = 10;
    if (/\binstant\b/.test(s)) score += 100;
    if (/\bfast\b/.test(s)) score += 90;
    if (/\bmini\b|4o-mini|o4-mini/.test(s)) score += 80;
    if (/\bauto\b|\bdefault\b/.test(s)) score += 65;
    if (/\b4o\b|gpt-4o/.test(s)) score += 55;
    if (/\bgpt-5\b|\bgpt-4\b/.test(s)) score += 45;
    if (/\bthinking\b|\breasoning\b|\bo[1-9]\b/.test(s)) score += 20;
    if (/\bpro\b|\bextended\b/.test(s)) score -= 200;
    return score;
  }

  let score = 10;
  if (/\bextended\b/.test(s)) score += 120;
  if (/\bpro\b/.test(s)) score += 110;
  if (/\bthinking\b|\breasoning\b/.test(s)) score += 90;
  if (/\bgpt-5\b/.test(s)) score += 85;
  if (/\bo[1-9]\b/.test(s)) score += 80;
  if (/\bgpt-4\b|\b4o\b|gpt-4o/.test(s)) score += 60;
  if (/\binstant\b|\bfast\b|\bmini\b/.test(s)) score += 25;
  return score;
}

export function chooseChatGptModelLabel(
  labels: string[], policy: Exclude<ChatGptModelPolicy, 'current'>,
): string | null {
  let best: { label: string; score: number; index: number } | null = null;
  labels.forEach((raw, index) => {
    const label = normLabel(raw);
    const score = scoreChatGptModelLabel(label, policy);
    if (!Number.isFinite(score)) return;
    if (!best || score > best.score || (score === best.score && index < best.index)) best = { label, score, index };
  });
  return best?.label ?? null;
}

function modelPickerText(el: HTMLElement): string {
  return normLabel(`${el.getAttribute('aria-label') ?? ''} ${el.innerText ?? el.textContent ?? ''}`);
}

function findModelPickerButton(): HTMLElement | null {
  const direct = q1(MODEL_PICKER_SELECTORS);
  if (direct) return direct;
  const buttons = Array.from(document.querySelectorAll('button')) as HTMLElement[];
  return buttons
    .map((button) => ({ button, score: Math.max(scoreChatGptModelLabel(modelPickerText(button), 'extract'), scoreChatGptModelLabel(modelPickerText(button), 'best')) }))
    .filter((x) => Number.isFinite(x.score) && x.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.button ?? null;
}

function modelMenuItems(): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const out: HTMLElement[] = [];
  for (const selector of MODEL_ITEM_SELECTORS) {
    for (const el of Array.from(document.querySelectorAll(selector)) as HTMLElement[]) {
      if (seen.has(el)) continue;
      const text = normLabel(el.innerText ?? el.textContent ?? '');
      if (!text || isUnavailableModelLabel(text) || isNonChatModelLabel(text)) continue;
      if (!Number.isFinite(Math.max(scoreChatGptModelLabel(text, 'extract'), scoreChatGptModelLabel(text, 'best')))) continue;
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

async function waitForModelItems(timeoutMs = 1500): Promise<HTMLElement[]> {
  const start = Date.now();
  do {
    const items = modelMenuItems();
    if (items.length) return items;
    await sleep(100);
  } while (Date.now() - start < timeoutMs);
  return [];
}

// Best-effort model switching for ChatGPT's web UI. The labels and DOM are not a stable API, so this
// intentionally fails open: if the menu cannot be read, the caller still submits with the current model.
export async function selectChatGptModel(policy: ChatGptModelPolicy): Promise<boolean> {
  if (policy === 'current') return true;
  const picker = findModelPickerButton();
  if (!picker) return false;
  picker.click();
  const items = await waitForModelItems();
  const labels = items.map((el) => normLabel(el.innerText ?? el.textContent ?? ''));
  const choice = chooseChatGptModelLabel(labels, policy);
  const item = choice ? items.find((el) => normLabel(el.innerText ?? el.textContent ?? '') === choice) : null;
  if (!item) {
    picker.click();
    return false;
  }
  item.click();
  await sleep(250);
  return true;
}

function q1(selectors: string[]): HTMLElement | null {
  for (const s of selectors) { const el = document.querySelector(s); if (el) return el as HTMLElement; }
  return null;
}
function isGenerating(): boolean { return !!q1(STOP_SELECTORS); }
export function hasChallenge(): boolean { return !!q1(CHALLENGE_SELECTORS); }
// Click ChatGPT's own send button. A scripted click still fires their React send handler, and their
// frontend attaches the sentinel/Turnstile token — we never compute it. Returns false if the button
// is missing or still disabled (composer not yet registered), so the caller can retry or fall back.
export function clickSend(): boolean {
  const el = q1(SEND_SELECTORS) as HTMLButtonElement | null;
  if (!el || el.disabled) return false;
  el.click();
  return true;
}
function assistantTurns(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-message-author-role="assistant"]')) as HTMLElement[];
}
// Prefer the LAST code block that looks like our JSON (the model may emit an inline `code` span or a
// preamble snippet before the fenced answer); fall back to the last code block, then plain text.
function lastAssistantText(): string {
  const turns = assistantTurns();
  const last = turns[turns.length - 1];
  if (!last) return '';
  const blocks = Array.from(last.querySelectorAll('pre code')) as HTMLElement[];
  const jsonish = [...blocks].reverse().find((b) => /"(thinking|assessments|evidence)"\s*:/.test(b.textContent ?? ''));
  return (jsonish?.textContent ?? blocks[blocks.length - 1]?.textContent ?? last.innerText ?? '').trim();
}

// Pure decision for the reply-watcher, extracted so it can be unit-tested without a DOM. Never
// finalize before generation was actually observed (guards against a pre-send empty read), and
// require the text to hold stable while NOT generating (guards against finalizing on a partial
// reply during a streaming pause). On timeout, import only if a real reply arrived, else give up.
export interface WatchState {
  hasNewTurn: boolean;     // a new assistant turn appeared after the user sent
  generating: boolean;     // the stop button is present (model is streaming)
  everGenerated: boolean;  // we have seen generating === true at least once
  hasText: boolean;        // the last assistant turn has non-empty text
  textStableMs: number;    // how long the text has been unchanged
  elapsedMs: number;       // since the watcher started
}
export function watcherDecision(
  s: WatchState,
  opts: { stableMs: number; timeoutMs: number } = { stableMs: 2500, timeoutMs: 12 * 60 * 1000 },
): 'wait' | 'finalize' | 'giveup' {
  if (s.elapsedMs > opts.timeoutMs) return s.hasNewTurn && s.hasText ? 'finalize' : 'giveup';
  if (!s.hasNewTurn || !s.everGenerated || s.generating || !s.hasText) return 'wait';
  return s.textStableMs >= opts.stableMs ? 'finalize' : 'wait';
}

// React/ProseMirror-controlled composer: a naive `el.value = x` is ignored, so use the native value
// setter + an input event for <textarea>, or execCommand('insertText') for the contenteditable.
export function setComposer(text: string): boolean {
  const el = q1(COMPOSER_SELECTORS);
  if (!el) return false;
  el.focus();
  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) setter.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value.length > 0; // confirm it actually took (React may reject a bad set)
  }
  el.textContent = '';
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  if (!ok) { el.textContent = text; el.dispatchEvent(new InputEvent('input', { bubbles: true })); }
  return (el.textContent ?? '').length > 0; // ProseMirror may ignore textContent; don't report a false fill
}

const HINT_ID = 'aibadges-bridge-hint';
function showHint(text: string, tone: 'info' | 'success' | 'error' = 'info'): void {
  let el = document.getElementById(HINT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HINT_ID;
    el.style.cssText = [
      'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)', 'z-index:2147483647',
      'max-width:520px', 'padding:12px 16px', 'border-radius:12px', 'font:500 14px/1.45 system-ui,sans-serif',
      'box-shadow:0 8px 28px rgba(16,24,40,.22)', 'color:#fff', 'text-align:center',
    ].join(';');
    document.body.appendChild(el);
  }
  el.style.background = tone === 'success' ? '#12b76a' : tone === 'error' ? '#d92d20' : '#0046ff';
  el.textContent = text;
}
function clearHintLater(ms: number): void {
  window.setTimeout(() => document.getElementById(HINT_ID)?.remove(), ms);
}

let bridgeActive = false;

export function runBridge(prompt: string, notify: Notify): void {
  if (bridgeActive) return;
  bridgeActive = true;

  let tries = 0;
  const tryFill = () => {
    if (setComposer(prompt)) { startWatching(); return; }
    if (++tries > 15) {
      bridgeActive = false;
      notify({ type: 'aibadges:cg-bridge-error', error: 'Could not find the ChatGPT message box. Use the manual paste option instead.' });
      return;
    }
    window.setTimeout(tryFill, 300);
  };

  const startWatching = () => {
    const baseline = assistantTurns().length;
    const startedAt = Date.now();
    let lastText = '';
    let stableSince = 0;
    let everGenerated = false;
    let done = false;
    let manualShown = false;
    let autoSubmittedAt = 0;
    const showManual = () => {
      if (manualShown) return;
      manualShown = true;
      showHint('AI Fluency Index filled your message. Review it, then press Enter to run. We will read the result automatically.');
    };

    const stop = () => { obs.disconnect(); window.clearInterval(poll); };
    const importNow = async () => {
      const text = lastAssistantText();
      try {
        const profile = await importGptReply(text);
        notify({ type: 'aibadges:done', version: profile.version });
        notify({ type: 'aibadges:cg-bridge-done', version: profile.version });
        notify({ type: 'aibadges:open-results' });
        showHint('Your AI Fluency Index profile is ready. Opening it…', 'success');
        clearHintLater(6000);
      } catch (e) {
        notify({ type: 'aibadges:cg-bridge-error', error: String((e as Error)?.message ?? e) });
        showHint('AI Fluency Index could not read that reply. Open the AI Fluency Index page and paste it manually.', 'error');
        clearHintLater(9000);
      }
    };
    const giveUp = () => {
      notify({ type: 'aibadges:cg-bridge-error', error: 'Timed out waiting for a reply. Use the manual paste option below.' });
      showHint('AI Fluency Index timed out waiting for a reply.', 'error'); clearHintLater(8000);
    };

    const check = () => {
      if (done) return;
      const generating = isGenerating();
      if (generating) everGenerated = true;
      const text = lastAssistantText();
      if (text && text !== lastText) { lastText = text; stableSince = Date.now(); }
      const hasNewTurn = assistantTurns().length > baseline;

      // Auto-submit didn't take (a challenge is showing, or 8s passed with no generation and no new
      // turn): hand off to the user by asking them to press Enter. The watcher keeps running.
      if (autoSubmittedAt && !manualShown && !everGenerated && !hasNewTurn &&
          (hasChallenge() || Date.now() - autoSubmittedAt > 8000)) {
        showManual();
      }

      const decision = watcherDecision({
        hasNewTurn,
        generating, everGenerated, hasText: !!text,
        textStableMs: stableSince ? Date.now() - stableSince : 0,
        elapsedMs: Date.now() - startedAt,
      });
      if (decision === 'wait') return;
      done = true; stop(); bridgeActive = false;
      if (decision === 'finalize') void importNow(); else giveUp();
    };

    const obs = new MutationObserver(check);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    const poll = window.setInterval(check, 800);

    // Auto-submit by clicking ChatGPT's own send button, retrying briefly while React enables it.
    // A visible challenge means we must not auto-submit; ask the user to press Enter instead.
    let sendTries = 0;
    const trySubmit = () => {
      if (done) return;
      if (hasChallenge()) { showManual(); return; }
      if (clickSend()) { autoSubmittedAt = Date.now(); showHint('AI Fluency Index is running your analysis in ChatGPT…'); return; }
      if (++sendTries > 8) { showManual(); return; } // ~2.4s of retrying, then hand off to the user
      window.setTimeout(trySubmit, 300);
    };
    trySubmit();
  };

  tryFill();
}
