import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DangerButton } from "../components/DangerButton";

export function InterviewPage({ id }: { id: number }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(
    () => api.get(`/api/interviews/${id}`).then(setData).catch((e) => setErr(e.message)),
    [id],
  );
  useEffect(() => {
    reload();
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [reload]);

  function watchJob() {
    if (poll.current) clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const s = (await api.get(`/api/interviews/${id}/coding-status`)) as any;
      if (s.state === "done" || s.state === "error") {
        if (poll.current) clearInterval(poll.current);
        reload();
      }
    }, 1500);
  }

  async function onFile(file: File) {
    setErr("");
    setUploading(true);
    try {
      await api.upload(`/api/interviews/${id}/transcript`, file);
      watchJob();
      await reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  if (err && !data) return <p className="muted">Error: {err}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const job = data.job;
  return (
    <>
      <h1>
        Interview #{id} — {data.participant?.pseudonym} ({data.participant?.profile}){" "}
        <span className="badge status">{data.status}</span>
      </h1>
      <p>
        <a href={`#/guide/${id}`}>Open live guide</a>
        {(data.status === "coded" || data.status === "reviewed") && (
          <> · <a href={`#/review/${id}`}>Review codes ({data.codes.filter((c: any) => c.state === "ai_suggested").length} suggested)</a></>
        )}
        {data.turns.length > 0 && data.status !== "scheduled" && (
          <>
            {" · "}
            <button
              className="subtle"
              onClick={() => api.post(`/api/interviews/${id}/code`).then(() => { watchJob(); reload(); })}
            >
              re-run coding
            </button>
            <span className="muted small"> (replaces pending suggestions; your confirmed codes are kept)</span>
          </>
        )}
        {" · "}
        <DangerButton
          label="delete interview"
          confirmLabel="Delete interview + transcript + codes?"
          onConfirm={() => api.del(`/api/interviews/${id}`).then(() => { location.hash = "#/"; })}
        />
      </p>

      <div
        className={`dropzone ${drag ? "drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
      >
        {uploading ? "Uploading…" : "Drop the call transcript here (.vtt / .txt)"}
        <p>
          <input
            type="file"
            accept=".vtt,.txt,.srt"
            style={{ width: "auto" }}
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </p>
      </div>
      {err && <p style={{ color: "var(--red)" }}>{err}</p>}

      {job?.state === "running" && <p className="muted">Coding transcript with GLM…</p>}
      {job?.state === "error" && (
        <p style={{ color: "var(--red)" }}>
          Coding failed: {job.error}{" "}
          <button onClick={() => api.post(`/api/interviews/${id}/code`).then(watchJob)}>retry</button>
        </p>
      )}
      {job?.state === "done" && job.failedChunks?.length > 0 && (
        <p style={{ color: "var(--amber)" }}>
          {job.failedChunks.length} chunk(s) need manual coding (LLM output invalid).
        </p>
      )}

      {data.turns.length > 0 && (
        <>
          <h2>Transcript ({data.turns.length} turns)</h2>
          <div className="card turns">
            {data.turns.map((t: any) => (
              <div className="turn" key={t.i}>
                <span className="spk">{t.speaker} {t.start ? `· ${t.start}` : ""}</span>
                <div>{t.text}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {data.notes.length > 0 && (
        <>
          <h2>Live notes</h2>
          <div className="card">
            {data.notes.map((n: any, i: number) => (
              <p key={i} className="small" style={{ margin: "4px 0" }}>
                <span className="muted">{n.createdAt}</span> {n.text}
              </p>
            ))}
          </div>
        </>
      )}
    </>
  );
}
