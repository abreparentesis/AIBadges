import { describe, it, expect } from 'vitest';
import { certName, buildAddToProfileUrl, buildShareOnLinkedInUrl, defaultShareText, stageDrift } from '../../src/sync/linkedin';

describe('certName', () => {
  it('uses the score + level credential wording', () => {
    expect(certName(62, 'Intermediate')).toBe('AI Fluency Index — 62/100 (Intermediate)');
  });
});

describe('buildAddToProfileUrl', () => {
  const url = buildAddToProfileUrl({
    score: 62, level: 'Intermediate', computedAt: '2026-07-06T10:00:00Z',
    shareUrl: 'https://aibadges-api.mindmaterial.io/s/tok123', token: 'tok123',
  });
  const params = new URL(url).searchParams;

  it('targets the certification form', () => {
    expect(url.startsWith('https://www.linkedin.com/profile/add?')).toBe(true);
    expect(params.get('startTask')).toBe('CERTIFICATION_NAME');
  });
  it('prefills name, org, dates, url, and id', () => {
    expect(params.get('name')).toBe('AI Fluency Index — 62/100 (Intermediate)');
    expect(params.get('organizationName')).toBe('AI Fluency Index');
    expect(params.get('issueYear')).toBe('2026');
    expect(params.get('issueMonth')).toBe('7');
    expect(params.get('certUrl')).toBe('https://aibadges-api.mindmaterial.io/s/tok123');
    expect(params.get('certId')).toBe('tok123');
  });
});

describe('buildShareOnLinkedInUrl', () => {
  it('opens the post composer with prefilled text ending in the share URL (OG unfurl)', () => {
    const url = buildShareOnLinkedInUrl('https://x.io/s/t1', 'My score');
    expect(url.startsWith('https://www.linkedin.com/feed/?shareActive=true&text=')).toBe(true);
    const text = decodeURIComponent(url.split('text=')[1]);
    expect(text).toBe('My score\n\nhttps://x.io/s/t1');
  });
  it('falls back to just the URL without text', () => {
    const text = decodeURIComponent(buildShareOnLinkedInUrl('https://x.io/s/t1').split('text=')[1]);
    expect(text).toBe('https://x.io/s/t1');
  });
});

describe('defaultShareText', () => {
  it('mentions score, level, and provenance', () => {
    const t = defaultShareText(62, 'Intermediate');
    expect(t).toContain('62/100');
    expect(t).toContain('Intermediate');
    expect(t).toContain('own chat history');
  });
});

describe('stageDrift', () => {
  it('detects a published value that differs from the current one', () => {
    expect(stageDrift('55', 62)).toBe(true);
  });
  it('is false when equal, and false when nothing was published', () => {
    expect(stageDrift('62', 62)).toBe(false);
    expect(stageDrift('', 62)).toBe(false);
  });
});
