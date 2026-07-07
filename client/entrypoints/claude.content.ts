import type { RawConversation } from '../src/capture/types';
import { ClaudeCaptureAdapter } from '../src/capture/claude';
import { InSessionClaudeCaller, isRateLimitError, isCancelledError, CancelledError } from '../src/inference/in-session';
import { buildProfile, isEmptyProfile } from '../src/engine/profile';
import { loadPool, savePool, mergePool, evictedConversations, type PoolUnit } from '../src/engine/evidence-pool';
import { loadScanSet, saveScanSet, partitionScanned, nextScanSet } from '../src/store/scanset';
import { distill } from '../src/engine/distill';
import { ProfileStore } from '../src/store/local';
import { chromeKv } from '../src/store/chrome-kv';
import { ensureUserKey } from '../src/store/userkey';
import { BackendSync, needsRepushKey } from '../src/sync/backend';
import { carryOverSharing } from '../src/sync/signal-state';
import { BACKEND_URL, INVITE_TOKEN } from '../src/config';
import { pickModels } from '../src/engine/models';
import { selectAcrossTimeline } from '../src/capture/select';

export default defineContentScript({
  matches: ['https://claude.ai/*'],
  async main() {
    if ((window as unknown as { __aibadgesLoaded?: boolean }).__aibadgesLoaded) return;
    (window as unknown as { __aibadgesLoaded?: boolean }).__aibadgesLoaded = true;

    let running = false;
    let cancelled = false;
    let activeCaller: InSessionClaudeCaller | null = null;
    const notify = (m: Record<string, unknown>) => { try { chrome.runtime.sendMessage(m); } catch {} };

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return;
      if (msg?.type === 'aibadges:alive') { sendResponse({ running }); return false; }
      if (msg?.type === 'aibadges:cancel') {
        // Stop button: abort the in-flight call and let the run wind down through its normal
        // cleanup (scratch conversations are deleted in the caller's finally blocks).
        cancelled = true;
        activeCaller?.abortAll();
        sendResponse({ ok: true, running });
        return false;
      }
      if (msg?.type !== 'aibadges:run') return;
      if (running) { sendResponse({ ok: false, error: 'already running' }); return false; }
      cancelled = false;

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
        const fullList = await adapter.listConversations();
        const conversations = selectAcrossTimeline(fullList, 90);

        // Choose models from what this account actually has: a fast model for bulk evidence
        // extraction, the best for synthesis. Never assume a tier.
        const { fast, best } = pickModels(conversations.map((c) => c.model));
        const caller = new InSessionClaudeCaller(org, best ?? conversations[0]?.model ?? null);
        activeCaller = caller;

        // Incremental extraction: fetch + extract only conversations that are new or changed since
        // their last scan; everything else is already represented in the evidence pool. An empty
        // pool forces a full scan (a scan set without its pool would mask the whole history).
        const priorPool = await loadPool(chromeKv, 'claude');
        const scanned = await loadScanSet(chromeKv, 'claude');
        const { toScan } = priorPool.length ? partitionScanned(conversations, scanned) : { toScan: conversations };

        const convos: RawConversation[] = [];
        notify({ type: 'aibadges:phase', phase: 'capture', done: 0, total: toScan.length });
        for (let i = 0; i < toScan.length; i++) {
          if (cancelled) throw new CancelledError(); // capture happens before any caller call
          convos.push(await adapter.fetchConversation(toScan[i].id));
          notify({ type: 'aibadges:phase', phase: 'capture', done: i + 1, total: toScan.length });
        }
        const capturedChars = convos.reduce((n, c) => n + c.messages.reduce((s, m) => s + m.text.length, 0), 0);
        if (toScan.length > 0 && capturedChars === 0) console.warn('[aibadges] captured 0 chars of message text');

        const version = (await store.latestVersion()) + 1;
        const now = new Date().toISOString();
        // The measured window is the full selection, not just what needed re-scanning — an
        // unchanged re-run still measures the same 90 conversations (via the pool).
        const windowDates = conversations.map((c) => c.updatedAt).sort();
        let runPool: PoolUnit[] = [];
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
            priorEvidence: priorPool,
            onEvidencePool: (units) => { runPool = units.map(({ id: _id, ...u }) => u); },
            sourceWindow: {
              fromDate: windowDates[0] ?? now, toDate: windowDates[windowDates.length - 1] ?? now,
              conversationCount: conversations.length,
            },
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
          // Persist the pool + scan set only for a KEPT profile — a discarded run must not grow
          // them. The scan set drops deleted conversations and any evicted from the pool's cap
          // (those must be re-scanned), then records this run's scans at their fingerprints.
          if (runPool.length) {
            const merged = mergePool(priorPool, runPool);
            await savePool(chromeKv, 'claude', merged);
            const evicted = evictedConversations([...priorPool, ...runPool], merged);
            await saveScanSet(chromeKv, 'claude', nextScanSet(scanned, toScan, new Set(fullList.map((c) => c.id)), evicted));
          }
          // Publishing is USER state, not run output: a re-run must not flip a published badge
          // back to private (that bug made the share section "forget" the URL after every run).
          const signals = carryOverSharing(await chromeKv.get('aibadges:signals:claude'), distill(profile, now, undefined, 'Claude'));
          await chromeKv.set('aibadges:signals:claude', JSON.stringify(signals));
          let synced: number | string;
          try {
            const userKey = await ensureUserKey(chromeKv, 'claude');
            const sync = new BackendSync({ backendUrl: BACKEND_URL, inviteToken: INVITE_TOKEN, userKey });
            synced = (await sync.pushProfile(profile)).version;
            await chromeKv.set(needsRepushKey('claude'), '0'); // fresh push satisfies the post-delete repush guarantee
            // Keep the public share page in sync with the newest run (the server keeps the token,
            // so the URL never changes — only its content).
            const pub = signals.filter((s) => s.disclosure === 'public');
            if (pub.length) {
              await sync.setSignals(pub.map((s) => ({ type: s.type, surfacedContent: s.surfacedContent, disclosure: 'public' as const })));
              const stat = pub.find((s) => s.type === 'statBadge');
              if (stat) {
                const c = stat.surfacedContent as { fluencyScore?: number; yeggeStage?: number | string };
                await chromeKv.set('aibadges:publishedStage:claude', String(c.fluencyScore ?? c.yeggeStage ?? ''));
              }
            }
          } catch (e) { console.warn('[aibadges] sync failed (non-fatal)', e); synced = `error: ${String(e)}`; }
          console.log('[aibadges] done', { version, capturedChars, fast, best, thinking: profile.thinking.length, type: profile.type?.code ?? null, shifts: profile.trajectory.shifts.length, synced });
          return version;
        } finally { activeCaller = null; await caller.dispose(); }
      })()
        .then((version) => notify({ type: 'aibadges:done', version }))
        .catch((e) => {
          if (cancelled || isCancelledError(e)) {
            console.log('[aibadges] run cancelled by the user');
            notify({ type: 'aibadges:cancelled' });
            return;
          }
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
