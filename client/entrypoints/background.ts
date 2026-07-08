import { CG_WORKERS_KEY, batchOutKey } from '../src/capture/cg-keys';
import { runKey, PROVIDERS } from '../src/store/provider';

// Run-lifecycle keys are namespaced per provider (aibadges:status:claude vs :chatgpt etc.) so the
// two flows can never bleed state into each other. The Claude flow owns the :claude keys; the
// invisible ChatGPT autorun owns the :chatgpt keys.
const CLAUDE_STATUS = runKey('status', 'claude');
const CLAUDE_ERROR = runKey('error', 'claude');
const CLAUDE_PROGRESS = runKey('progress', 'claude');
const CLAUDE_STARTED = runKey('startedAt', 'claude');
const CG_STATUS = runKey('status', 'chatgpt');
const CG_ERROR = runKey('error', 'chatgpt');
const CG_PROGRESS = runKey('progress', 'chatgpt');
// The pre-namespacing shared keys; removed on startup after seeding (see restore()).
const LEGACY_RUN_KEYS = ['aibadges:status', 'aibadges:error', 'aibadges:progress', 'aibadges:startedAt'];

// Service worker: owns the action badge dot and run status/progress.
// blue idle/rest → amber while profiling → green when a fresh profile is ready → blue again once
// the profile is opened. A watchdog flips out of "profiling" if the Claude.ai tab is closed mid-run.
export default defineBackground(() => {
  const WATCHDOG = 'aibadges-watchdog';
  const setBadge = (text: string, bg: string, title: string) => {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: bg });
    chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    chrome.action.setTitle({ title });
  };
  const idle = () => setBadge('●', '#0046ff', 'AI Fluency Index — click to profile your AI history');
  const running = (what = 'your AI history') => setBadge('●', '#f5a623', `AI Fluency Index — profiling ${what}…`);
  const done = () => setBadge('●', '#12b76a', 'AI Fluency Index — your profile is ready (click to open)');
  const error = () => setBadge('!', '#d92d20', 'AI Fluency Index — profiling failed (click to retry)');

  // Generous interval: a backgrounded Claude.ai tab throttles its heartbeat to ~once a
  // minute, and a single completion can back off for a while, so a short window produced
  // false "stalled" errors. When the alarm does fire we don't assume death — we ask.
  const WATCHDOG_MS = 60000;
  const arm = () => chrome.alarms.create(WATCHDOG, { when: Date.now() + WATCHDOG_MS });
  const disarm = () => chrome.alarms.clear(WATCHDOG);
  const failRun = (reason: string) => {
    chrome.storage.local.set({ [CLAUDE_STATUS]: 'error', [CLAUDE_ERROR]: reason });
    error();
  };

  // The invisible ChatGPT run has its own watchdog (the Claude one looks for a claude.ai tab, so it
  // can't watch this). The worker content script answers 'aibadges:cg-alive' throughout the run, so
  // we can tell a live-but-slow run (long reply waits) from a dead one (tab redirected to a login
  // host where our script never loads, tab crashed, or a hung fetch) without false-failing.
  const CG_WATCHDOG = 'aibadges-cg-watchdog';
  // Re-armed by cg-phase AND by the per-poll cg-heartbeat the worker emits during long reply waits.
  // Must exceed the worst heartbeat gap, which in a throttled hidden tab can stretch to ~60s per
  // timer tick — 90s here used to kill perfectly healthy multi-minute synthesis turns.
  const CG_WATCHDOG_MS = 240000;
  const armCg = () => chrome.alarms.create(CG_WATCHDOG, { when: Date.now() + CG_WATCHDOG_MS });
  const disarmCg = () => chrome.alarms.clear(CG_WATCHDOG);
  const notifyPopup = (m: Record<string, unknown>) => chrome.runtime.sendMessage(m, () => void chrome.runtime.lastError);

  // ---- parallel extraction worker tabs (spawned for the ChatGPT run's extraction batches) ----
  // The orchestrator content script asks for one tab per batch ('aibadges:cg-spawn-batch'); we open
  // it, and once it finishes loading push 'aibadges:cg-run-batch' into it (send → inject → send,
  // the same pattern the popup uses to start a capture). The live map is kept in storage so a
  // service-worker restart mid-run can still find and close every tab we opened. Mutations of the
  // map are serialized through a promise chain — spawn acks, batch-done, and kill can interleave.
  type CgWorker = { batch: number; started?: boolean };
  let cgOps: Promise<unknown> = Promise.resolve();
  const cgSerial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const p = cgOps.then(fn, fn);
    cgOps = p.catch(() => undefined);
    return p;
  };
  const getCgWorkers = async (): Promise<Record<string, CgWorker>> => {
    const v = (await chrome.storage.local.get(CG_WORKERS_KEY))[CG_WORKERS_KEY];
    return v && typeof v === 'object' ? { ...(v as Record<string, CgWorker>) } : {};
  };
  const setCgWorkers = (w: Record<string, CgWorker>) => chrome.storage.local.set({ [CG_WORKERS_KEY]: w });
  // A worker tab we can never reach (e.g. redirected to a login host where our script won't load)
  // would otherwise stall the orchestrator until its deadline; fail its batch fast instead.
  const failBatchFast = (batch: number) => chrome.storage.local.set({ [batchOutKey(batch)]: '{"failed":true}' });
  const startBatchInTab = async (tabId: number, batch: number): Promise<boolean> => {
    const send = () => new Promise<boolean>((res) => {
      chrome.tabs.sendMessage(tabId, { type: 'aibadges:cg-run-batch', batch }, (r) => {
        if (chrome.runtime.lastError) { res(false); return; }
        const resp = r as { ok?: boolean; error?: string } | undefined;
        res(resp?.ok === true || resp?.error === 'already running');
      });
    });
    if (await send()) return true;
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/chatgpt-capture.js'] }); } catch { return false; }
    return await send();
  };
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status !== 'complete') return;
    void cgSerial(async () => {
      const workers = await getCgWorkers();
      const w = workers[String(tabId)];
      if (!w || w.started) return; // not one of ours, or its batch already started
      w.started = true;
      await setCgWorkers(workers);
      if (!(await startBatchInTab(tabId, w.batch))) {
        await failBatchFast(w.batch);
        await chrome.tabs.remove(tabId).catch(() => { /* already gone */ });
        const ws = await getCgWorkers();
        delete ws[String(tabId)];
        await setCgWorkers(ws);
      }
    });
  });

  // Close the orchestrator tab AND every extraction worker tab we opened (never the user's own
  // ChatGPT tabs — only ids we recorded).
  const closeCgTab = async () => {
    const g = await chrome.storage.local.get(['aibadges:cg:tabId', CG_WORKERS_KEY]);
    const tid = g['aibadges:cg:tabId'];
    if (typeof tid === 'number') await chrome.tabs.remove(tid).catch(() => { /* already gone */ });
    const workers = g[CG_WORKERS_KEY];
    if (workers && typeof workers === 'object') {
      for (const k of Object.keys(workers)) await chrome.tabs.remove(Number(k)).catch(() => { /* already gone */ });
    }
    await chrome.storage.local.remove(CG_WORKERS_KEY);
  };
  // Stuck ChatGPT run -> stop it: clear state, close the (invisible) worker tab, tell an open popup.
  const failCg = (reason: string) => {
    disarmCg(); void closeCgTab();
    chrome.storage.local.set({ [CG_STATUS]: 'error', [CG_ERROR]: reason, 'aibadges:cg:running': 0, [CG_PROGRESS]: null });
    chrome.storage.local.remove(['aibadges:cg:tabId', 'aibadges:cg:autorun']);
    error(); notifyPopup({ type: 'aibadges:cg-autorun-error', error: reason });
  };
  // User pressed Stop: same teardown but no error state — return to rest (or the prior profile).
  const cancelCg = async () => {
    disarmCg(); await closeCgTab();
    const slots = await chrome.storage.local.get(['aibadges:latestVersion:claude', 'aibadges:latestVersion:chatgpt', 'aibadges:latestVersion']);
    const hasChatGpt = Number(slots['aibadges:latestVersion:chatgpt'] ?? 0) > 0;
    const hasAny = Object.values(slots).some((v) => Number(v ?? 0) > 0);
    await chrome.storage.local.set({ 'aibadges:cg:running': 0, [CG_PROGRESS]: null, [CG_STATUS]: hasChatGpt ? 'done' : 'idle' });
    await chrome.storage.local.remove(['aibadges:cg:tabId', 'aibadges:cg:autorun']);
    hasAny ? done() : idle();
  };

  // Badge = the more urgent of the two flows' states: running > error > done > idle.
  const badgeFromStatuses = (ss: unknown[]) => {
    if (ss.includes('running')) running();
    else if (ss.includes('error')) error();
    else if (ss.includes('done')) done();
    else idle();
  };
  const restore = async () => {
    // Upgrade path from the shared-key era: seed each provider's status as "done" when a profile
    // for it exists but its namespaced status was never written, then drop the legacy keys. Stale
    // legacy running/error states die here — an in-flight run doesn't survive an upgrade anyway.
    const seed = await chrome.storage.local.get([
      CLAUDE_STATUS, CG_STATUS,
      'aibadges:latestVersion:claude', 'aibadges:latestVersion:chatgpt', 'aibadges:cg:running',
    ]);
    const writes: Record<string, string> = {};
    for (const p of PROVIDERS) {
      if (seed[runKey('status', p)] == null && Number(seed[`aibadges:latestVersion:${p}`] ?? 0) > 0) {
        writes[runKey('status', p)] = 'done';
      }
    }
    if (Object.keys(writes).length) await chrome.storage.local.set(writes);
    await chrome.storage.local.remove(LEGACY_RUN_KEYS);
    badgeFromStatuses([writes[CLAUDE_STATUS] ?? seed[CLAUDE_STATUS], writes[CG_STATUS] ?? seed[CG_STATUS]]);
    // Resume watching an in-flight ChatGPT run after a service-worker restart, so a run that outlived
    // the worker (or a stale flag from a dead run) gets re-checked within one watchdog interval.
    if (seed['aibadges:cg:running']) armCg();
  };
  chrome.runtime.onInstalled.addListener((details) => {
    idle();
    // FRESH installs only (not updates/reloads): Chrome buries new extensions behind the puzzle
    // menu, so a one-time welcome tab walks the user through pinning and starting a first run.
    if (details.reason === 'install') {
      chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
    }
  });
  chrome.runtime.onStartup?.addListener(() => void restore());
  void restore();

  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name === CG_WATCHDOG) {
      const s = await chrome.storage.local.get(['aibadges:cg:running', 'aibadges:cg:tabId']);
      if (!s['aibadges:cg:running']) { disarmCg(); return; } // run already finished
      const tid = s['aibadges:cg:tabId'];
      let reason = '';
      if (typeof tid !== 'number') {
        reason = 'The ChatGPT run didn’t start. Open chatgpt.com, make sure you’re logged in, then try again.';
      } else {
        let gone = false;
        try { await chrome.tabs.get(tid); } catch { gone = true; }
        if (gone) reason = 'The background ChatGPT tab closed before it finished. Try again.';
        else {
          const alive = await new Promise<boolean>((res) => {
            let answered = false;
            chrome.tabs.sendMessage(tid, { type: 'aibadges:cg-alive' }, (r) => { answered = true; res(!chrome.runtime.lastError && !!(r as { running?: boolean })?.running); });
            setTimeout(() => { if (!answered) res(false); }, 4000);
          });
          if (!alive) reason = 'The ChatGPT run stopped unexpectedly. Make sure you’re logged in to chatgpt.com, then try again.';
        }
      }
      if (!reason) { armCg(); return; } // still working (even mid reply-wait) — keep watching
      // Re-check: the run may have finished during the async probe above (done/error clears the flag).
      // Don't clobber a completed run with a watchdog error.
      if ((await chrome.storage.local.get('aibadges:cg:running'))['aibadges:cg:running']) failCg(reason);
      else disarmCg();
      return;
    }
    if (a.name !== WATCHDOG) return;
    const status = (await chrome.storage.local.get(CLAUDE_STATUS))[CLAUDE_STATUS];
    if (status !== 'running') { disarm(); return; } // run already finished — nothing to watch
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    if (!tabs.length || tabs[0].id == null) {
      failRun('Interrupted — the Claude.ai tab was closed. Reopen Claude.ai and run again.');
      return;
    }
    // A backgrounded tab throttles its heartbeat, so a missing heartbeat does NOT mean the
    // run died. Ask the content script directly; only error if the tab/run is truly gone.
    const tabId = tabs[0].id;
    const alive = await new Promise<boolean>((res) => {
      let answered = false;
      chrome.tabs.sendMessage(tabId, { type: 'aibadges:alive' }, (r) => {
        answered = true;
        res(!chrome.runtime.lastError && !!(r as { running?: boolean })?.running);
      });
      setTimeout(() => { if (!answered) res(false); }, 4000);
    });
    if (alive) arm();
    else failRun('Interrupted — the run stopped unexpectedly. Reopen Claude.ai and run again.');
  });

  let blink = false;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;
    switch (msg?.type) {
      case 'aibadges:cg-spawn-batch': {
        // Orchestrator wants a background worker tab for one extraction batch. Ack only after the
        // worker map is written, so the orchestrator's sequential spawns can't race each other.
        const batch = Number(msg.batch);
        void cgSerial(async () => {
          const tab = await new Promise<{ id?: number } | undefined>((res) => chrome.tabs.create({ url: 'https://chatgpt.com/', active: false }, res));
          if (tab?.id == null) { await failBatchFast(batch); return; }
          const workers = await getCgWorkers();
          workers[String(tab.id)] = { batch };
          await setCgWorkers(workers);
        }).then(() => sendResponse({ ok: true }));
        armCg();
        return true; // async sendResponse
      }
      case 'aibadges:cg-batch-tab-done': {
        // A worker tab finished its batch (result already in storage): close it and forget it.
        const tid = sender.tab?.id;
        if (tid != null) {
          chrome.tabs.remove(tid).catch(() => { /* already gone */ });
          void cgSerial(async () => {
            const workers = await getCgWorkers();
            delete workers[String(tid)];
            await setCgWorkers(workers);
          });
        }
        armCg(); break;
      }
      case 'aibadges:cg-kill-batch':
        // Orchestrator gave up on a batch whose tab went dark: close that tab if we still know it.
        void cgSerial(async () => {
          const workers = await getCgWorkers();
          for (const [tid, w] of Object.entries(workers)) {
            if (w.batch !== Number(msg.batch)) continue;
            await chrome.tabs.remove(Number(tid)).catch(() => { /* already gone */ });
            delete workers[tid];
          }
          await setCgWorkers(workers);
        });
        armCg(); break;
      case 'aibadges:start':
        chrome.storage.local.set({ [CLAUDE_STATUS]: 'running', [CLAUDE_STARTED]: Date.now(), [CLAUDE_PROGRESS]: null });
        blink = true; running('your Claude history'); arm(); break;
      case 'aibadges:progress':
        blink = !blink; setBadge(blink ? '●' : '', '#f5a623', 'AI Fluency Index — profiling your Claude history…'); arm(); break;
      case 'aibadges:phase':
        chrome.storage.local.set({ [CLAUDE_PROGRESS]: { phase: msg.phase, done: msg.done, total: msg.total } }); arm(); break;
      case 'aibadges:done':
        disarm(); chrome.storage.local.set({ [CLAUDE_STATUS]: 'done', [CLAUDE_PROGRESS]: null }); done(); break;
      case 'aibadges:error':
        disarm(); chrome.storage.local.set({ [CLAUDE_STATUS]: 'error', [CLAUDE_ERROR]: String(msg.error ?? '') }); error(); break;
      case 'aibadges:cancelled':
        // User pressed Stop on the Claude run: no error state, back to rest. The 'cancelled'
        // status keeps the popup from auto-starting a run the user just stopped.
        disarm(); chrome.storage.local.set({ [CLAUDE_STATUS]: 'cancelled', [CLAUDE_PROGRESS]: null }); idle(); break;
      case 'aibadges:opened':
        // Profile was opened — the "fresh" green dot has served its purpose; return to rest.
        idle(); break;
      case 'aibadges:reveal-start':
        // The in-page pill on claude.ai: start the run in the tab that asked, exactly as the
        // popup would (the ChatGPT pill sends 'aibadges:cg-autorun' directly instead).
        if (sender.tab?.id != null) chrome.tabs.sendMessage(sender.tab.id, { type: 'aibadges:run' }, () => void chrome.runtime.lastError);
        break;
      case 'aibadges:open-results':
        // The in-ChatGPT bridge finished on the chatgpt.com tab (a content script can't open tabs),
        // so it asks the background to surface the freshly built profile.
        chrome.tabs.create({ url: chrome.runtime.getURL('results.html') }); break;
      case 'aibadges:cg-phase':
        // Persist ChatGPT run progress so reopening the popup mid-run shows the bar, not the button.
        // Progress means the worker is alive, so re-arm the ChatGPT watchdog.
        chrome.storage.local.set({ [CG_PROGRESS]: { phase: msg.phase, done: msg.done, total: msg.total } }); armCg(); break;
      case 'aibadges:cg-heartbeat':
        // The worker polls a long-running reply: alive, just slow. Keep the watchdog off its back.
        armCg(); break;
      case 'aibadges:cg-autorun':
        // Invisible ChatGPT run: open chatgpt.com in a BACKGROUND tab (active:false) with the flag the
        // content script checks on load. It captures, analyzes in a throwaway conversation, deletes
        // it, and imports — the user never sees a chat. Store the worker tab id so Stop / the watchdog
        // can find and close exactly this tab (never the user's own ChatGPT tabs). Use the ChatGPT
        // watchdog (armCg), NOT the Claude arm() (which looks for a claude.ai tab and would false-fail).
        chrome.storage.local.set({ 'aibadges:cg:autorun': 1, 'aibadges:cg:running': 1, [CG_STATUS]: 'running', [CG_PROGRESS]: null });
        blink = true; running('your ChatGPT history');
        chrome.tabs.create({ url: 'https://chatgpt.com/', active: false }, (tab) => { if (tab?.id != null) chrome.storage.local.set({ 'aibadges:cg:tabId': tab.id }); });
        armCg(); break;
      case 'aibadges:cg-cancel':
        // User pressed Stop in the popup.
        void cancelCg(); break;
      case 'aibadges:cg-autorun-done':
        // The invisible orchestrator tab (the sender) finished: close it — plus any extraction
        // worker tab still lingering — and surface the fresh profile.
        disarm(); disarmCg();
        if (sender.tab?.id != null) chrome.tabs.remove(sender.tab.id).catch(() => { /* already gone */ });
        void closeCgTab();
        chrome.storage.local.set({ [CG_STATUS]: 'done', [CG_PROGRESS]: null, 'aibadges:cg:running': 0 });
        chrome.storage.local.remove('aibadges:cg:tabId'); done();
        chrome.tabs.create({ url: chrome.runtime.getURL('results.html') }); break;
      case 'aibadges:cg-autorun-error':
        disarm(); disarmCg();
        if (sender.tab?.id != null) chrome.tabs.remove(sender.tab.id).catch(() => { /* already gone */ });
        void closeCgTab();
        chrome.storage.local.set({ [CG_STATUS]: 'error', [CG_ERROR]: String(msg.error ?? ''), 'aibadges:cg:running': 0 });
        chrome.storage.local.remove('aibadges:cg:tabId'); error(); break;
    }
  });
});
