// Baked into the build via WXT env (client/.env, gitignored). The default backend is
// permissionless, so the empty invite below is all anyone needs; point WXT_AIBADGES_BACKEND
// at your own deployment to use it instead.
export const BACKEND_URL =
  (import.meta.env.WXT_AIBADGES_BACKEND as string | undefined) ?? 'https://aibadges-api.mindmaterial.io';

// Only needed if you run an invite-gated backend (server with INVITE_TOKEN set). Empty otherwise.
export const INVITE_TOKEN = (import.meta.env.WXT_AIBADGES_INVITE as string | undefined) ?? '';

export const shareUrl = (token: string) => `${BACKEND_URL}/s/${token}`;

// The AI Fluency Index Custom GPT that free ChatGPT users run their own capture through. Overridable via
// build env so the GPT can be reissued without a code change.
export const CHATGPT_GPT_URL =
  (import.meta.env.WXT_AIBADGES_GPT_URL as string | undefined) ??
  'https://chatgpt.com/g/g-6a26b204b0748191af3193558989e4bd-aibadges';
