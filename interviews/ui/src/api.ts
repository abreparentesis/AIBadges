async function handle(res: Response) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j.error) msg = j.error;
    } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("json") ? res.json() : res.text();
}

export const api = {
  get: (path: string) => fetch(path).then(handle),
  post: (path: string, body?: unknown) =>
    fetch(path, {
      method: "POST",
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(handle),
  upload: (path: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(path, { method: "POST", body: form }).then(handle);
  },
  del: (path: string) => fetch(path, { method: "DELETE" }).then(handle),
};
