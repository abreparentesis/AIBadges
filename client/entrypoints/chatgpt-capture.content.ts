import { ChatGPTCaptureAdapter } from '../src/capture/chatgpt';
import { selectAcrossTimeline } from '../src/capture/select';
import { buildChatGptExport } from '../src/capture/chatgpt-export';
import { runBridge } from '../src/capture/chatgpt-bridge';
import type { RawConversation } from '../src/capture/types';

// ChatGPT path on chatgpt.com does two jobs: (1) capture the user's history via the session cookies
// (read-only), and (2) the "bridge": prefill the composer with the prompt+data and auto-submit by
// clicking ChatGPT's own send button, then read the finished reply from the DOM and import it. We
// never call the bot-gated completion endpoint directly and never compute a sentinel/Turnstile token;
// ChatGPT's own frontend issues the request from the user's session when its send button is clicked.
// If a challenge shows or the click doesn't take, it falls back to the user pressing Enter. Distinct
// message namespace ('aibadges:cg-*') so it never touches the Claude run state machine.
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
  },
});
