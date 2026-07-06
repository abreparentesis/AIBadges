import { createHash } from "node:crypto";
import type { Store } from "../store/db";

export interface LlmClient {
  complete(opts: { system: string; user: string; json?: boolean }): Promise<string>;
}

const DEFAULT_BASE = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "z-ai/glm-5.2";
const TIMEOUT_MS = 120_000;

/**
 * OpenAI-compatible chat client for GLM on NVIDIA. The only module that
 * talks to the network. Set GLM_FAKE=1 to get a stub that echoes an empty
 * result (local dev without a key).
 */
export function makeClient(env: Record<string, string | undefined> = process.env, store?: Store): LlmClient {
  if (env.GLM_FAKE === "1") {
    return { complete: async ({ json }) => (json ? '{"codes":[]}' : "(prose unavailable: GLM_FAKE)") };
  }
  const key = env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY is not set (launch via `phase run`)");
  const base = env.NVIDIA_BASE_URL ?? DEFAULT_BASE;
  const model = env.GLM_MODEL ?? DEFAULT_MODEL;

  return {
    async complete({ system, user, json }) {
      const started = Date.now();
      const promptHash = createHash("sha256").update(system + "\n" + user).digest("hex").slice(0, 16);
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            authorization: `Bearer ${key}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            ...(json ? { response_format: { type: "json_object" } } : {}),
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
        }
        const data = (await res.json()) as any;
        const content: string = data.choices?.[0]?.message?.content ?? "";
        store?.logLlmCall({ purpose: json ? "json" : "prose", promptHash, ms: Date.now() - started, ok: true });
        return content;
      } catch (e) {
        store?.logLlmCall({
          purpose: json ? "json" : "prose",
          promptHash,
          ms: Date.now() - started,
          ok: false,
          error: (e as Error).message,
        });
        throw e;
      }
    },
  };
}
