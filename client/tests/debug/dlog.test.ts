import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeDetail, dlog, flushDlog, buildDiagnosticReport, clearDlog } from '../../src/debug/dlog';

// Minimal chrome mock: storage.local over a Map, manifest version for the report header.
const store = new Map<string, unknown>();
(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: {
      get: async (keys: string | string[] | null) => {
        if (keys == null) return Object.fromEntries(store);
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, store.get(k)]));
      },
      set: async (obj: Record<string, unknown>) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
      remove: async (keys: string | string[]) => { for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k); },
    },
  },
  runtime: { getManifest: () => ({ version: '1.0.0-test' }) },
};

beforeEach(async () => { store.clear(); await clearDlog(); });

describe('sanitizeDetail (the privacy boundary)', () => {
  it('drops every chat-ish key wholesale, whatever its value', () => {
    const out = sanitizeDetail({
      quote: 'verbatim user words', text: 'transcript', prompt: 'the whole prompt', message: 'hi',
      content: 'x', body: 'y', summary: 'z', title: 'convo title', reply: 'model said', convoText: 'x',
      batch: 2,
    })!;
    expect(Object.keys(out)).toEqual(['batch']);
  });

  it('hard-truncates long strings so an error can pass but a transcript cannot', () => {
    const out = sanitizeDetail({ err: 'x'.repeat(5000) })!;
    expect((out.err as string).length).toBeLessThan(340);
    expect(out.err as string).toContain('…[+');
  });

  it('flattens arrays and objects to counts — no nested payloads ever', () => {
    const out = sanitizeDetail({ units: [{ quote: 'secret' }], detail: { inner: 'secret' } })!;
    expect(out.units).toBe('array(1)');
    expect(out.detail).toBe('object(1 keys)');
  });

  it('skips undefined but keeps null, numbers, and booleans', () => {
    const out = sanitizeDetail({ a: undefined, b: null, c: 0, d: false })!;
    expect(out).toEqual({ b: null, c: 0, d: false });
  });
});

describe('dlog ring buffer + report', () => {
  it('caps the log and keeps the newest entries', async () => {
    for (let i = 0; i < 650; i++) dlog('t', `e${i}`);
    await flushDlog();
    const report = JSON.parse(await buildDiagnosticReport());
    expect(report.log.length).toBe(600);
    expect(report.log[report.log.length - 1].e).toBe('e649');
    expect(report.log[0].e).toBe('e50');
  });

  it('the report carries version, state snapshot with counts only, and never pool contents', async () => {
    store.set('aibadges:evidencePool:claude', JSON.stringify([
      { timestamp: 't', sourceRef: { provider: 'claude', conversationId: 'c' }, type: 'decision', quote: 'SECRET-QUOTE', summary: 's' },
    ]));
    store.set('aibadges:latestVersion:claude', '7');
    dlog('bg', 'aibadges:error', { err: 'something broke' });
    await flushDlog();
    const raw = await buildDiagnosticReport();
    expect(raw).not.toContain('SECRET-QUOTE');
    const report = JSON.parse(raw);
    expect(report.extensionVersion).toBe('1.0.0-test');
    expect(report.state.claude.profileVersion).toBe(7);
    expect(report.state.claude.poolSize).toBe(1);
    expect(report.log[0].d.err).toBe('something broke');
  });
});
