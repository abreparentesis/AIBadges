import type { RawConversation } from '../src/capture/types';
import { ClaudeCaptureAdapter } from '../src/capture/claude';
import { InSessionClaudeCaller, isRateLimitError } from '../src/inference/in-session';
import { buildProfile, isEmptyProfile } from '../src/engine/profile';
import { distill } from '../src/engine/distill';
import { ProfileStore } from '../src/store/local';
import { chromeKv } from '../src/store/chrome-kv';
import { ensureUserKey } from '../src/store/userkey';
import { BackendSync, needsRepushKey } from '../src/sync/backend';
import { BACKEND_URL, INVITE_TOKEN } from '../src/config';
import { pickModels } from '../src/engine/models';
import { selectAcrossTimeline } from '../src/capture/select';

export default defineContentScript({
  matches: ['https://claude.ai/*'],
  async main() {
    if ((window as unknown as { __aibadgesLoaded?: boolean }).__aibadgesLoaded) return;
    (window as unknown as { __aibadgesLoaded?: boolean }).__aibadgesLoaded = true;

    let running = false;
    const notify = (m: Record<string, unknown>) => { try { chrome.runtime.sendMessage(m); } catch {} };

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return;
      if (msg?.type === 'aibadges:alive') { sendResponse({ running }); return false; }
      if (msg?.type !== 'aibadges:run') return;
      if (running) { sendResponse({ ok: false, error: 'already running' }); return false; }

      running = true;
      sendResponse({ ok: true, started: true }); // ack immediately; run continues in the background
      notify({ type: 'aibadges:start' });
      const ticker = setInterval(() => notify({ type: 'aibadges:progress' }), 700);

      (async () => {
        const orgsRes = await fetch('/api/organizations', { credentials: 'include' });
        if (!orgsRes.ok) throw new Error(`org lookup failed: ${orgsRes.status}`);
        const orgs = await orgsRes.json();
        const org = Array.isArray(orgs) && orgs[0]?.uuid;
        if (!org) throw new Error('No Claude organization found (are you logged in?)');

        const adapter = new ClaudeCaptureAdapter(org);
        const store = new ProfileStore(chromeKv, 'claude');
        // Sample across the WHOLE history (oldest->newest), not just the most recent, so the
        // trajectory lens sees real span. The char budget below is sized to cover all of these.
        // 90 matches the ChatGPT path's window (cross-provider comparability); the tighter
        // per-conversation budget below keeps the total inside the same 6-chunk cap.
        const conversations = selectAcrossTimeline(await adapter.listConversations(), 90);

        // Choose models from what this account actually has: a fast model for bulk evidence
        // extraction, the best for synthesis. Never assume a tier.
        const { fast, best } = pickModels(conversations.map((c) => c.model));
        const caller = new InSessionClaudeCaller(org, best ?? conversations[0]?.model ?? null);

        const convos: RawConversation[] = [];
        notify({ type: 'aibadges:phase', phase: 'capture', done: 0, total: conversations.length });
        for (let i = 0; i < conversations.length; i++) {
          convos.push(await adapter.fetchConversation(conversations[i].id));
          notify({ type: 'aibadges:phase', phase: 'capture', done: i + 1, total: conversations.length });
        }
        const capturedChars = convos.reduce((n, c) => n + c.messages.reduce((s, m) => s + m.text.length, 0), 0);
        if (capturedChars === 0) console.warn('[aibadges] captured 0 chars of message text');

        const version = (await store.latestVersion()) + 1;
        const now = new Date().toISOString();
        try {
          const profile = await buildProfile(convos, caller, {
            version, now,
            modelProvenance: `claude-in-session (${fast ?? '?'} + ${best ?? '?'})`,
            fastModel: fast ?? undefined, bestModel: best ?? undefined,
            // Budget sized for ~90 time-spread conversations at the calibration-validated
            // 2500 chars each (~225k total): still 6 chunks x 48k, and the scratch-conversation
            // caller is API-parallel, so 3-wide extraction keeps wall-clock roughly flat vs
            // the old 40-conversation run while more than doubling the window.
            maxChars: 48000, maxChunks: 6, perConvoChars: 2500, concurrency: 3,
            onPhase: (p) => notify({ type: 'aibadges:phase', ...p }),
            onSynthesisDebug: (d) => { void chromeKv.set('aibadges:debug:synthesis', JSON.stringify(d)); },
          });
          // Don't overwrite an existing good profile with an empty one. In fluency-only mode
          // "empty" means the capability lens failed (see isEmptyProfile) — the console above
          // carries the [aibadges] capability warn with the underlying cause.
          if (isEmptyProfile(profile)) {
            throw new Error('The analysis produced no fluency result this run (usually a transient Claude error — try again in a minute). Your existing profile, if any, was kept.');
          }
          await store.saveProfileVersion(profile);
          await chromeKv.set('aibadges:signals:claude', JSON.stringify(distill(profile, now, undefined, 'Claude')));
          let synced: number | string;
          try {
            const userKey = await ensureUserKey(chromeKv, 'claude');
            synced = (await new BackendSync({ backendUrl: BACKEND_URL, inviteToken: INVITE_TOKEN, userKey }).pushProfile(profile)).version;
            await chromeKv.set(needsRepushKey('claude'), '0'); // fresh push satisfies the post-delete repush guarantee
          } catch (e) { console.warn('[aibadges] sync failed (non-fatal)', e); synced = `error: ${String(e)}`; }
          console.log('[aibadges] done', { version, capturedChars, fast, best, thinking: profile.thinking.length, type: profile.type?.code ?? null, shifts: profile.trajectory.shifts.length, synced });
          return version;
        } finally { await caller.dispose(); }
      })()
        .then((version) => notify({ type: 'aibadges:done', version }))
        .catch((e) => {
          console.error('[aibadges] run failed', e);
          let msg = String(e);
          if (isRateLimitError(e)) {
            const when = e.resetsAt ? new Date(e.resetsAt * 1000).toLocaleString() : 'later';
            msg = `Claude ${e.windowKey === 'seven_day' ? '7-day' : e.windowKey ?? 'usage'} limit reached. Profiling runs inside your Claude session, so it needs available Claude usage. It resets ${when}. Your existing profile was not changed.`;
          }
          notify({ type: 'aibadges:error', error: msg });
        })
        .finally(() => { clearInterval(ticker); running = false; });

      return false;
    });
  },
});
