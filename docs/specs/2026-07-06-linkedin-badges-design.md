# LinkedIn badges design

Date: 2026-07-06
Status: approved pending user review

## Goal

Let a user put their AI Literacy result on LinkedIn in two forms: a permanent Licenses and Certifications entry on their profile, and a feed post with a personalized badge image. Scope is the AI Literacy section only. The credential name is exactly "AI Fluency - Stage N", with N from the statBadge signal's Yegge stage. A drift nudge tells the user when their published badge no longer matches their current profile.

Decisions made during brainstorming:

- Credential form: LinkedIn "Add to profile" deep link (create-only, like Credly and Coursera). No Open Badges: LinkedIn does not consume them, and identity-bound credentials conflict with the anonymous-key architecture and the "not verified by us" provenance.
- Badge image: approach B, a server-rendered dynamic PNG showing the stage plus the four dimension bands, chosen over static per-stage images after comparing mockups.
- One credential, updated over time: `certId` stays constant (the share token) across re-adds.

## Architecture

Everything hangs off the existing public share infrastructure. The share page `/s/:token` already renders the owner's public sections from server-held `surfaced_json`; that snapshot updates only when the user explicitly re-publishes. No new data crosses the privacy boundary: the badge image renders only content the user already made public, and the client sends nothing new to the server.

### Server: dynamic badge image

New route `GET /og/:token.png` in `server/src/app.ts`:

1. Resolve the token to its owner with the same lookup `/s/:token` uses (public signals only).
2. Read the owner's public statBadge signal. Unknown token or statBadge not public: 404, matching the share page policy so the route is not an existence oracle.
3. Fill an SVG template (1200x627) with the stage headline ("AI Fluency - Stage N"), AIBadges branding, and the four dimension bands (Delegation, Description, Discernment, Diligence) from `surfaced_json`. Missing band fields degrade to the stage-only layout.
4. Rasterize with `@resvg/resvg-js`. The Inter font file ships with the server because the container has no system fonts.
5. On any rasterization error: log and serve a bundled static fallback PNG with 200. A broken image on a LinkedIn post is worse than a generic one.
6. `Cache-Control: public, max-age=300` so a re-publish propagates quickly without rendering per crawler hit.

### Server: OG tags

`renderReportPage` gains `og:image` (absolute URL to `/og/<token>.png`, derived from the request host), `og:image:width` 1200, `og:image:height` 627, and `twitter:card` upgraded to `summary_large_image`. LinkedIn's crawler scrapes these when a post is created and caches for about a week; existing posts keep the image they were born with.

### Client: Add to LinkedIn button

In the AI Literacy tab of the results page (`client/entrypoints/results/App.tsx`), rendered only when the statBadge section is public and has a share token. Opens LinkedIn's prefilled certification form:

```
https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME
  &name=AI Fluency - Stage N
  &organizationName=AIBadges
  &issueYear=<from profile.computedAt>
  &issueMonth=<from profile.computedAt>
  &certUrl=<share page URL>
  &certId=<share token>
```

A pure function (`client/src/sync/linkedin.ts`, exported for tests) builds this URL with proper encoding. The entry shows a generic icon until an AIBadges LinkedIn company page exists; creating that page is a manual step outside this scope, and the deep link then switches `organizationName` to `organizationId`.

### Client: Share on LinkedIn button

Next to the add button: opens `https://www.linkedin.com/sharing/share-offsite/?url=<share page URL>` in a new tab. The post preview comes from the OG tags.

### Client: drift nudge

When `changeDisclosure` publishes the statBadge section (and when `repushIfNeeded` re-pushes after a deletion), the client records the published stage locally (`aibadges:publishedStage` in extension storage). On the results page, when the section is public and the current profile's stage differs from the published one, a banner shows: "Your LinkedIn badge says Stage X, you're now at Stage Y. Update it." Its button re-publishes the section (refreshing the share page and image) and opens the prefilled form with the new name. LinkedIn has no edit API, so the user deletes the old entry by hand; both entries point at the same live report meanwhile. If the re-publish fails, the nudge stays and the existing error-alert pattern applies.

## Error handling

- `/og/:token.png`: 404 for unknown or private, static fallback PNG on render failure, stage-only layout on malformed band data.
- Buttons are `window.open` targets with no failure modes on our side; they do not render when the section is private.
- Drift nudge failure leaves state unchanged.

## Testing

Server (`server/tests/app.test.ts` pattern):
- `/og/:token.png` returns `image/png` and a body starting with the PNG magic number for a public statBadge.
- 404 for an unknown token and for a private statBadge.
- Fallback image with 200 on a forced render error.
- `/s/:token` HTML contains absolute `og:image`, the dimension tags, and `summary_large_image`.

Client (`client/tests/` pattern):
- Certification URL builder: name contains the stage, `certId` equals the token, issue year and month come from `computedAt`, all parameters URL-encoded.
- Drift detection: public and differing stage shows the nudge; private or equal stage does not.

No new privacy tests needed: the image renders server-held published content and the client gains no new server-bound payload.

## Rollout

1. Server: image route, font asset, OG tags. Deploy, then verify with LinkedIn's Post Inspector (linkedin.com/post-inspector).
2. Client: URL builder, buttons, drift nudge. Rebuild the extension.
3. Manual, anytime: create the AIBadges LinkedIn company page for the logo.

## Out of scope

Open Badges and Credly/Badgr, badges for sections other than AI Literacy, per-stage `certId` variants, image caching beyond HTTP headers, editing or deleting LinkedIn entries on the user's behalf (LinkedIn offers no API for it).
