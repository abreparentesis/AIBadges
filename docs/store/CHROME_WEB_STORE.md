# Chrome Web Store submission pack

Everything to paste into the developer dashboard (https://chrome.google.com/webstore/devconsole) when submitting the extension. The privacy policy to host is in [PRIVACY_POLICY.md](PRIVACY_POLICY.md); its public URL goes in the "Privacy policy" field.

## Single purpose description

> AI Fluency Index turns the user's own AI chat history (claude.ai, chatgpt.com) into a private, evidence-backed measure of how skillfully they work with AI — four fluency dimensions and a 1-100 score — with an optional shareable badge. All analysis runs through the user's own AI provider session; raw chats never leave the provider or the user's device.

## Permission justifications

Paste one block per field in the "Privacy practices" tab.

### storage

> Stores the user's generated profile (behavioral claims, scores, and the verbatim evidence quotes that back them) locally in extension storage. Local storage is the core of our privacy model: the full profile including quotes stays on the device, and only a distilled badge is ever synced.

### scripting

> Injects our own bundled content scripts (packaged in the extension, never remote code) into claude.ai and chatgpt.com tabs that were already open before the extension was installed or that need re-injection after an update. Without this, the user would have to reload their AI tabs before starting an analysis.

### alarms

> A watchdog timer that keeps the Manifest V3 service worker monitoring an in-flight analysis run. Long analyses outlive the service worker's idle timeout; the alarm wakes it to check progress and recover if the tab was closed.

### Host permission: https://claude.ai/*

> The extension reads the user's own Claude conversation history and runs the analysis inside their logged-in claude.ai session. This is the product's core function and its privacy guarantee: the only party processing raw chats is the provider that already holds them.

### Host permission: https://chatgpt.com/* and https://chat.openai.com/*

> Same as claude.ai, for ChatGPT users: when the user clicks "Start profiling", the extension operates their own logged-in ChatGPT session in background tabs it opens for the run — it submits the analysis prompts, reads the replies through the same backend API the page uses, and deletes the temporary conversations afterwards so nothing is left in the user's history. Both domains are needed because OpenAI serves ChatGPT from both.

### Host permission: https://aibadges-api.mindmaterial.io/*

> Our own API. Receives only the distilled badge (claims, scores, type, trajectory, opaque evidence ids); verbatim chat quotes are stripped in code before any request, and the boundary is covered by automated tests. Also serves the share pages for badges the user marks public.

## Remote code

Answer "No, I am not using remote code". All scripts ship inside the package; `chrome.scripting.executeScript` only injects files bundled with the extension.

## Data-use disclosure (Privacy practices tab)

Check these data types:

- Personal communications: the extension reads the user's AI chat history on the provider's site. Processing is local or via the user's own provider session; what our server receives is derived from it, so disclose it.
- Website content: content is captured from claude.ai and chatgpt.com pages.

Leave unchecked: personally identifiable information (we never ask for name or email; the sync key is a random identifier), health, financial, authentication (we use the user's existing session in their own browser and never read credentials or cookies), location, web history, user activity.

Certify all three usage statements: data is not sold, not used for purposes unrelated to the single purpose, and not used for creditworthiness or lending.

## Listing copy

Short description (under 132 characters):

> Measure how skillfully you work with AI from your own chat history — an evidence-backed fluency score. Your chats stay yours.

Detailed description:

> AI Fluency Index reads your own conversation history on claude.ai or chatgpt.com and asks your own AI to assess it. The result is an evidence-backed measure of how skillfully you work with AI: four fluency dimensions — Delegation, Description, Discernment, and Diligence — each banded from the exact quotes that earn it, rolled up into a 1-100 score and a level from Beginner to Expert. Every dimension comes with a concrete, personal "try next" action, and every claim links to the verbatim quotes behind it.
>
> The scoring is deliberately skeptical: an adversarial audit pass re-judges every quote and lowers any band its evidence does not earn, and thin histories are labeled provisional rather than scored confidently.
>
> The privacy model is the point. The analysis runs inside your own logged-in AI session, so the only party that ever processes your raw chats is the provider that already holds them. The full result, quotes included, is stored on your device, where you can audit every claim against its evidence. If you sync or share, only the distilled badge (score, level, bands) crosses the network. Our servers never see a single message of your chats.
>
> Your badge is private by default. Make it public and you get a share page you control — one per provider, since your Claude and ChatGPT fluency are measured separately. Flip it back to private any time.
>
> How it works:
> 1. Open the popup on claude.ai or chatgpt.com and start a run.
> 2. Your own AI analyzes your history in your session; re-runs only look at conversations that changed.
> 3. Review the result locally, with every band linked to its quotes.
> 4. Share the badge if you want; everything else stays on your device.

Category: Productivity (Tools also fits; Productivity gets more traffic).

## Assets still needed

- At least one screenshot, 1280x800 or 640x400 (popup on claude.ai, the results page, a share page)
- Small promo tile, 440x280 (optional but shown in more placements)
- Public URL for the hosted privacy policy

## Pre-submission checklist

- [ ] Developer account registered, $5 fee paid, publisher email verified, 2FA on
- [ ] EU trader declaration completed (declare non-trader if publishing as an individual without monetization)
- [ ] Privacy policy hosted and URL set in the dashboard
- [ ] Permission justifications pasted (all six above)
- [ ] Data-use disclosure checked and certified
- [ ] Store zip uploaded — `cd client && bun run zip` produces `client/.output/*-chrome.zip` from a fresh production build
- [ ] Screenshots uploaded
- [ ] Version in `client/package.json` (the manifest version comes from there) matches what you intend to ship
- [ ] Consider first publishing as unlisted for a shakedown round

Notes for later: server data deletion is self-serve. `DELETE /v1/profile` erases everything held for a key, and the results page exposes it as "Delete my server data"; the policy documents it, with email as a fallback. The `tabs` permission was removed before submission: host permissions on the provider origins are enough for the URL-filtered `chrome.tabs.query` calls, and `tabs.create`/`remove`/`sendMessage` need no permission, so the install prompt no longer shows "Read your browsing history".
