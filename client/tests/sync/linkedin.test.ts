import { describe, it, expect } from 'vitest';
import { certName, buildAddToProfileUrl, buildShareOnLinkedInUrl, stageDrift } from '../../src/sync/linkedin';

describe('certName', () => {
  it('uses the exact credential wording', () => {
    expect(certName(5)).toBe('AI Fluency Index - Stage 5');
  });
});

describe('buildAddToProfileUrl', () => {
  const url = buildAddToProfileUrl({
    stage: 5, computedAt: '2026-07-06T10:00:00Z',
    shareUrl: 'https://aibadges-api.mindmaterial.io/s/tok123', token: 'tok123',
  });
  const params = new URL(url).searchParams;

  it('targets the certification form', () => {
    expect(url.startsWith('https://www.linkedin.com/profile/add?')).toBe(true);
    expect(params.get('startTask')).toBe('CERTIFICATION_NAME');
  });
  it('prefills name, org, dates, url, and id', () => {
    expect(params.get('name')).toBe('AI Fluency Index - Stage 5');
    expect(params.get('organizationName')).toBe('AIBadges');
    expect(params.get('issueYear')).toBe('2026');
    expect(params.get('issueMonth')).toBe('7');
    expect(params.get('certUrl')).toBe('https://aibadges-api.mindmaterial.io/s/tok123');
    expect(params.get('certId')).toBe('tok123');
  });
});

describe('buildShareOnLinkedInUrl', () => {
  it('URL-encodes the share page into the offsite share link', () => {
    expect(buildShareOnLinkedInUrl('https://aibadges-api.mindmaterial.io/s/tok123'))
      .toBe('https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Faibadges-api.mindmaterial.io%2Fs%2Ftok123');
  });
});

describe('stageDrift', () => {
  it('detects a published stage that differs from the current one', () => {
    expect(stageDrift('5', 6)).toBe(true);
  });
  it('is false when equal, and false when nothing was published', () => {
    expect(stageDrift('5', 5)).toBe(false);
    expect(stageDrift('', 6)).toBe(false);
  });
});
