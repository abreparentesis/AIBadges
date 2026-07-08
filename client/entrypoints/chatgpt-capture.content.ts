import { ChatGPTCaptureAdapter } from '../src/capture/chatgpt';
import { selectAcrossTimeline } from '../src/capture/select';
import { buildChatGptExport } from '../src/capture/chatgpt-export';
import { runBridge } from '../src/capture/chatgpt-bridge';
import { runAutoProfile, runExtractionBatch } from '../src/capture/chatgpt-autorun';
import { maybeMountReveal } from '../src/ui/reveal';
import type { RawConversation } from '../src/capture/types';

// ChatGPT path on chatgpt.com. Default flow is INVISIBLE: the service worker opens this page in a
// background tab with the 'aibadges:cg:autorun' flag set, and runAutoProfile() captures history, runs
// the analysis in a throwaway conversation, reads the reply from the API (works while the tab is
// hidden), deletes the conversation, and imports. Nothing is left in the user's ChatGPT history.
// Legacy visible paths remain for compatibility: 'aibadges:cg-capture' (capture only) and
// 'aibadges:cg-bridge' (prefill + auto-submit, manual-Enter fallback). We never call the bot-gated
// completion endpoint directly and never compute a sentinel/Turnstile token; ChatGPT's own frontend
// issues the request when its send button is clicked. Distinct 'aibadges:cg-*' message namespace so
// it never touches the Claude run state machine.
const MAX_CONVOS = 30;
const PER_CONVO_CHARS = 4000;
const CAPTURE_KEY = 'aibadges:chatgpt:capture';

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  async main() {
    if ((window as unknown as { __aibadgesCgLoaded?: boolean }).__aibadgesCgLoaded) return;
    (window as unknown as { __aibadgesCgLoaded?: boolean }).__aibadgesCgLoaded = true;

    let running = false;
    const notify = (m: Record<string, unknown>) => { try { chrome.runtime.sendMessage(m); } catch { /* popup may be closed */ } };

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return;
      if (msg?.type === 'aibadges:cg-alive') { sendResponse({ running }); return false; }
      if (msg?.type === 'aibadges:cg-bridge') {
        // Prefill the composer + watch for the reply. The user presses send; we never auto-submit.
        runBridge(String(msg.prompt ?? ''), notify);
        sendResponse({ ok: true });
        return false;
      }
      if (msg?.type === 'aibadges:cg-run-batch') {
        // Extraction worker: this background tab was spawned by the service worker to run ONE
        // evidence-extraction batch in its own throwaway conversation. runExtractionBatch never
        // throws (a failed batch writes its failure marker for the orchestrator); when it settles
        // we ask the service worker to close this tab.
        if (running) { sendResponse({ ok: false, error: 'already running' }); return false; }
        running = true;
        sendResponse({ ok: true, started: true });
        const batch = Number(msg.batch);
        runExtractionBatch(batch, notify)
          .catch((e) => console.error('[aibadges] chatgpt extraction worker failed', e))
          .finally(() => { running = false; notify({ type: 'aibadges:cg-batch-tab-done', batch }); });
        return false;
      }
      if (msg?.type !== 'aibadges:cg-capture') return;
      if (running) { sendResponse({ ok: false, error: 'already running' }); return false; }

      running = true;
      sendResponse({ ok: true, started: true });
      notify({ type: 'aibadges:cg-start' });

      (async () => {
        const adapter = new ChatGPTCaptureAdapter();
        const list = await adapter.listConversations();
        if (list.length === 0) throw new Error('No ChatGPT conversations found (are you logged in to chatgpt.com?)');

        const picked = selectAcrossTimeline(list, MAX_CONVOS);
        const convos: RawConversation[] = [];
        notify({ type: 'aibadges:cg-phase', done: 0, total: picked.length });
        for (let i = 0; i < picked.length; i++) {
          try { convos.push(await adapter.fetchConversation(picked[i].id)); } catch { /* skip a single unreadable convo */ }
          notify({ type: 'aibadges:cg-phase', done: i + 1, total: picked.length });
        }

        const bundle = buildChatGptExport(convos, new Date().toISOString(), { perConvoChars: PER_CONVO_CHARS });
        if (bundle.export.conversations.length === 0) throw new Error('Captured no readable conversation text.');
        await chrome.storage.local.set({ [CAPTURE_KEY]: JSON.stringify(bundle) });
        return bundle.export.conversations.length;
      })()
        .then((count) => notify({ type: 'aibadges:cg-done', count }))
        .catch((e) => { console.error('[aibadges] chatgpt capture failed', e); notify({ type: 'aibadges:cg-error', error: String(e?.message ?? e) }); })
        .finally(() => { running = false; });

      return false;
    });

    // Invisible run: the service worker opened this (background) tab with the autorun flag set. Gated
    // by the flag so a normal chatgpt.com visit never triggers it. On finish/fail we tell the service
    // worker, which closes this tab and opens the results.
    const flag = (await chrome.storage.local.get('aibadges:cg:autorun'))['aibadges:cg:autorun'];
    if (flag) {
      await chrome.storage.local.remove('aibadges:cg:autorun');
      running = true;
      notify({ type: 'aibadges:cg-start' });
      runAutoProfile(notify)
        .catch((e) => {
          console.error('[aibadges] chatgpt autorun failed', e);
          notify({ type: 'aibadges:cg-autorun-error', error: String(e?.message ?? e) });
        })
        .finally(() => { running = false; });
    } else {
      // A NORMAL chatgpt.com visit (not one of our spawned run tabs): self-reveal for users who
      // installed but never ran a profile. Starting uses the same invisible autorun as the popup.
      void maybeMountReveal('chatgpt', () =>
        chrome.runtime.sendMessage({ type: 'aibadges:cg-autorun' }, () => void chrome.runtime.lastError));
    }
  },
});
