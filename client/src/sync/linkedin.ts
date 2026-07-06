// LinkedIn integration is pure URL construction; nothing is fetched and nothing leaves
// the device beyond the user opening linkedin.com themselves.

export function certName(stage: number | string): string {
  return `AI Fluency Index - Stage ${stage}`;
}

export function buildAddToProfileUrl(o: { stage: number | string; computedAt: string; shareUrl: string; token: string }): string {
  const d = new Date(o.computedAt);
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: certName(o.stage),
    organizationName: 'AIBadges',
    issueYear: String(d.getUTCFullYear()),
    issueMonth: String(d.getUTCMonth() + 1),
    certUrl: o.shareUrl,
    certId: o.token,
  });
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

export function buildShareOnLinkedInUrl(shareUrl: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
}

// True when a badge was published at some stage and the current profile disagrees.
export function stageDrift(publishedStage: string, currentStage: number | string): boolean {
  return publishedStage !== '' && publishedStage !== String(currentStage);
}
