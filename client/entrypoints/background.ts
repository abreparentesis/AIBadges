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
  const idle = () => setBadge('●', '#0046ff', 'AI Fluency Index — click to profile your Claude history');
  const running = () => setBadge('●', '#f5a623', 'AI Fluency Index — profiling your Claude history…');
  const done = () => setBadge('●', '#12b76a', 'AI Fluency Index — your profile is ready (click to open)');
  const error = () => setBadge('!', '#d92d20', 'AI Fluency Index — profiling failed (click to retry)');

  // Generous interval: a backgrounded Claude.ai tab throttles its heartbeat to ~once a
  // minute, and a single completion can back off for a while, so a short window produced
  // false "stalled" errors. When the alarm does fire we don't assume death — we ask.
  const WATCHDOG_MS = 60000;
  const arm = () => chrome.alarms.create(WATCHDOG, { when: Date.now() + WATCHDOG_MS });
  const disarm = () => chrome.alarms.clear(WATCHDOG);
  const failRun = (reason: string) => {
    chrome.storage.local.set({ 'aibadges:status': 'error', 'aibadges:error': reason });
    error();
  };

  // The invisible ChatGPT run has its own watchdog (the Claude one looks for a claude.ai tab, so it
  // can't watch this). The worker content script answers 'aibadges:cg-alive' throughout the run, so
  // we can tell a live-but-slow run (long reply waits) from a dead one (tab redirected to a login
  // host where our script never loads, tab crashed, or a hung fetch) without false-failing.
  const CG_WATCHDOG = 'aibadges-cg-watchdog';
  const CG_WATCHDOG_MS = 90000; // > the longest single reply wait; re-armed while the tab stays alive
  const armCg = () => chrome.alarms.create(CG_WATCHDOG, { when: Date.now() + CG_WATCHDOG_MS });
  const disarmCg = () => chrome.alarms.clear(CG_WATCHDOG);
  const notifyPopup = (m: Record<string, unknown>) => chrome.runtime.sendMessage(m, () => void chrome.runtime.lastError);
  const closeCgTab = async () => {
    const tid = (await chrome.storage.local.get('aibadges:cg:tabId'))['aibadges:cg:tabId'];
    if (typeof tid === 'number') await chrome.tabs.remove(tid).catch(() => { /* already gone */ });
  };
  // Stuck ChatGPT run -> stop it: clear state, close the (invisible) worker tab, tell an open popup.
  const failCg = (reason: string) => {
    disarmCg(); void closeCgTab();
    chrome.storage.local.set({ 'aibadges:status': 'error', 'aibadges:error': reason, 'aibadges:cg:running': 0, 'aibadges:progress': null });
    chrome.storage.local.remove(['aibadges:cg:tabId', 'aibadges:cg:autorun']);
    error(); notifyPopup({ type: 'aibadges:cg-autorun-error', error: reason });
  };
  // User pressed Stop: same teardown but no error state — return to rest (or the prior profile).
  const cancelCg = async () => {
    disarmCg(); await closeCgTab();
    const hasProfile = Number((await chrome.storage.local.get('aibadges:latestVersion'))['aibadges:latestVersion'] ?? 0) > 0;
    await chrome.storage.local.set({ 'aibadges:cg:running': 0, 'aibadges:progress': null, 'aibadges:status': hasProfile ? 'done' : 'idle' });
    await chrome.storage.local.remove(['aibadges:cg:tabId', 'aibadges:cg:autorun']);
    hasProfile ? done() : idle();
  };

  const restore = async () => {
    const g = await chrome.storage.local.get(['aibadges:status', 'aibadges:cg:running']);
    const s = g['aibadges:status'];
    if (s === 'running') running(); else if (s === 'done') done(); else if (s === 'error') error(); else idle();
    // Resume watching an in-flight ChatGPT run after a service-worker restart, so a run that outlived
    // the worker (or a stale flag from a dead run) gets re-checked within one watchdog interval.
    if (g['aibadges:cg:running']) armCg();
  };
  chrome.runtime.onInstalled.addListener(idle);
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
    const status = (await chrome.storage.local.get('aibadges:status'))['aibadges:status'];
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
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    switch (msg?.type) {
      case 'aibadges:start':
        chrome.storage.local.set({ 'aibadges:status': 'running', 'aibadges:startedAt': Date.now(), 'aibadges:progress': null });
        blink = true; running(); arm(); break;
      case 'aibadges:progress':
        blink = !blink; setBadge(blink ? '●' : '', '#f5a623', 'AI Fluency Index — profiling your Claude history…'); arm(); break;
      case 'aibadges:phase':
        chrome.storage.local.set({ 'aibadges:progress': { phase: msg.phase, done: msg.done, total: msg.total } }); arm(); break;
      case 'aibadges:done':
        disarm(); chrome.storage.local.set({ 'aibadges:status': 'done', 'aibadges:progress': null }); done(); break;
      case 'aibadges:error':
        disarm(); chrome.storage.local.set({ 'aibadges:status': 'error', 'aibadges:error': String(msg.error ?? '') }); error(); break;
      case 'aibadges:opened':
        // Profile was opened — the "fresh" green dot has served its purpose; return to rest.
        idle(); break;
      case 'aibadges:open-results':
        // The in-ChatGPT bridge finished on the chatgpt.com tab (a content script can't open tabs),
        // so it asks the background to surface the freshly built profile.
        chrome.tabs.create({ url: chrome.runtime.getURL('results.html') }); break;
      case 'aibadges:cg-phase':
        // Persist ChatGPT run progress so reopening the popup mid-run shows the bar, not the button.
        // Progress means the worker is alive, so re-arm the ChatGPT watchdog.
        chrome.storage.local.set({ 'aibadges:progress': { phase: msg.phase, done: msg.done, total: msg.total } }); armCg(); break;
      case 'aibadges:cg-autorun':
        // Invisible ChatGPT run: open chatgpt.com in a BACKGROUND tab (active:false) with the flag the
        // content script checks on load. It captures, analyzes in a throwaway conversation, deletes
        // it, and imports — the user never sees a chat. Store the worker tab id so Stop / the watchdog
        // can find and close exactly this tab (never the user's own ChatGPT tabs). Use the ChatGPT
        // watchdog (armCg), NOT the Claude arm() (which looks for a claude.ai tab and would false-fail).
        chrome.storage.local.set({ 'aibadges:cg:autorun': 1, 'aibadges:cg:running': 1, 'aibadges:status': 'running', 'aibadges:progress': null });
        blink = true; running();
        chrome.tabs.create({ url: 'https://chatgpt.com/', active: false }, (tab) => { if (tab?.id != null) chrome.storage.local.set({ 'aibadges:cg:tabId': tab.id }); });
        armCg(); break;
      case 'aibadges:cg-cancel':
        // User pressed Stop in the popup.
        void cancelCg(); break;
      case 'aibadges:cg-autorun-done':
        // The invisible worker tab (the sender) finished: close it and surface the fresh profile.
        disarm(); disarmCg();
        if (sender.tab?.id != null) chrome.tabs.remove(sender.tab.id).catch(() => { /* already gone */ });
        chrome.storage.local.set({ 'aibadges:status': 'done', 'aibadges:progress': null, 'aibadges:cg:running': 0 });
        chrome.storage.local.remove('aibadges:cg:tabId'); done();
        chrome.tabs.create({ url: chrome.runtime.getURL('results.html') }); break;
      case 'aibadges:cg-autorun-error':
        disarm(); disarmCg();
        if (sender.tab?.id != null) chrome.tabs.remove(sender.tab.id).catch(() => { /* already gone */ });
        chrome.storage.local.set({ 'aibadges:status': 'error', 'aibadges:error': String(msg.error ?? ''), 'aibadges:cg:running': 0 });
        chrome.storage.local.remove('aibadges:cg:tabId'); error(); break;
    }
  });
});
