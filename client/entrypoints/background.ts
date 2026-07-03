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
  const idle = () => setBadge('●', '#0046ff', 'AIBadges — click to profile your Claude history');
  const running = () => setBadge('●', '#f5a623', 'AIBadges — profiling your Claude history…');
  const done = () => setBadge('●', '#12b76a', 'AIBadges — your profile is ready (click to open)');
  const error = () => setBadge('!', '#d92d20', 'AIBadges — profiling failed (click to retry)');

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

  const restore = async () => {
    const s = (await chrome.storage.local.get('aibadges:status'))['aibadges:status'];
    if (s === 'running') running(); else if (s === 'done') done(); else if (s === 'error') error(); else idle();
  };
  chrome.runtime.onInstalled.addListener(idle);
  chrome.runtime.onStartup?.addListener(() => void restore());
  void restore();

  chrome.alarms.onAlarm.addListener(async (a) => {
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
        blink = !blink; setBadge(blink ? '●' : '', '#f5a623', 'AIBadges — profiling your Claude history…'); arm(); break;
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
      case 'aibadges:cg-autorun':
        // Invisible ChatGPT run: open chatgpt.com in a BACKGROUND tab (active:false) with the flag the
        // content script checks on load. It captures, analyzes in a throwaway conversation, deletes
        // it, and imports — the user never sees a chat.
        chrome.storage.local.set({ 'aibadges:cg:autorun': 1, 'aibadges:status': 'running', 'aibadges:progress': null });
        blink = true; running(); chrome.tabs.create({ url: 'https://chatgpt.com/', active: false }); arm(); break;
      case 'aibadges:cg-autorun-done':
        // The invisible worker tab (the sender) finished: close it and surface the fresh profile.
        disarm();
        if (sender.tab?.id != null) chrome.tabs.remove(sender.tab.id).catch(() => { /* already gone */ });
        chrome.storage.local.set({ 'aibadges:status': 'done', 'aibadges:progress': null }); done();
        chrome.tabs.create({ url: chrome.runtime.getURL('results.html') }); break;
      case 'aibadges:cg-autorun-error':
        disarm();
        if (sender.tab?.id != null) chrome.tabs.remove(sender.tab.id).catch(() => { /* already gone */ });
        chrome.storage.local.set({ 'aibadges:status': 'error', 'aibadges:error': String(msg.error ?? '') }); error(); break;
    }
  });
});
