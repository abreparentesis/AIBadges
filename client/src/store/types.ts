export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}
