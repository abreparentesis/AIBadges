export interface ModelCaller {
  complete(prompt: string, opts?: { system?: string; model?: string; timeoutMs?: number }): Promise<string>;
}
