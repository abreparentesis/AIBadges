// LinkedIn integration is pure URL construction; nothing is fetched and nothing leaves
// the device beyond the user opening linkedin.com themselves.

export function certName(score: number | string, level: string, source?: string): string {
  return `AI Fluency Index${source ? ` (${source})` : ''} — ${score}/100 (${level})`;
}

export function buildAddToProfileUrl(o: {
  score: number | string;
  level: string;
  source?: string;
  computedAt: string;
  shareUrl: string;
  token: string;
}): string {
  const d = new Date(o.computedAt);
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: certName(o.score, o.level, o.source),
    organizationName: 'AI Fluency Index',
    issueYear: String(d.getUTCFullYear()),
    issueMonth: String(d.getUTCMonth() + 1),
    certUrl: o.shareUrl,
    certId: o.token,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

/**
 * Opens LinkedIn's post composer prefilled with `text` (which must contain the share
 * URL — LinkedIn unfurls the first URL into the OpenGraph card, so the badge image
 * comes from our og endpoint rather than a manual attachment).
 */
export function buildShareOnLinkedInUrl(shareUrl: string, text?: string): string {
  const body = text ? `${text}\n\n${shareUrl}` : shareUrl;
  return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(body)}`;
}

/** Default post copy for the share composer. */
export function defaultShareText(score: number | string, level: string, source?: string): string {
  return `I measured how I actually work with AI. My AI Fluency Index${source ? ` (${source})` : ''}: ${score}/100 (${level}) — computed from my own chat history, with every claim backed by real quotes.`;
}

// True when a badge was published at some value and the current profile disagrees.
export function stageDrift(published: string, current: number | string): boolean {
  return published !== '' && published !== String(current);
}
