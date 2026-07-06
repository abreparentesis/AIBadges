import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";

function useNow(runningSince: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (runningSince === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [runningSince]);
  return now;
}

export function LiveGuide({ interviewId }: { interviewId: number }) {
  const [kit, setKit] = useState<any>(null);
  const [interview, setInterview] = useState<any>(null);
  const [started, setStarted] = useState<number | null>(null);
  const [stageIdx, setStageIdx] = useState(0);
  const [stageStarted, setStageStarted] = useState<number | null>(null);
  const [asked, setAsked] = useState<Map<string, number>>(new Map()); // qid → note id
  const [notes, setNotes] = useState("");
  const savedNotes = useRef("");
  const now = useNow(started);

  const refreshAsked = useCallback(async () => {
    const d = (await api.get(`/api/interviews/${interviewId}`)) as any;
    setInterview(d);
    const map = new Map<string, number>();
    for (const n of d.notes) {
      if (n.text.startsWith("asked:")) map.set(n.text.slice(6), n.id);
    }
    setAsked(map);
  }, [interviewId]);

  useEffect(() => {
    api.get("/api/kit").then(setKit);
    void refreshAsked();
  }, [refreshAsked]);

  // debounced note autosave
  useEffect(() => {
    const t = setTimeout(() => {
      const fresh = notes.trim();
      if (fresh && fresh !== savedNotes.current) {
        savedNotes.current = fresh;
        void api.post(`/api/interviews/${interviewId}/notes`, { text: fresh });
        setNotes("");
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [notes, interviewId]);

  const stageElapsedMin = useMemo(
    () => (stageStarted === null ? 0 : (now - stageStarted) / 60000),
    [now, stageStarted],
  );

  if (!kit || !interview) return <p className="muted">Loading…</p>;
  const profile = interview.participant.profile as "A" | "B" | "C";
  const questions = [...kit.opener, ...kit.questionBank[profile]];

  async function toggleAsked(qid: string) {
    const noteId = asked.get(qid);
    if (noteId !== undefined) {
      await api.del(`/api/notes/${noteId}`);
    } else {
      await api.post(`/api/interviews/${interviewId}/notes`, { text: `asked:${qid}` });
    }
    await refreshAsked();
  }

  function start() {
    setStarted(Date.now());
    setStageStarted(Date.now());
    setStageIdx(0);
  }
  function nextStage() {
    setStageIdx((i) => Math.min(i + 1, kit.stages.length - 1));
    setStageStarted(Date.now());
  }

  return (
    <>
      <h1>
        Live guide — {interview.participant.pseudonym} ({kit.profileLabels[profile]})
      </h1>
      {started === null ? (
        <p><button className="primary" onClick={start}>Start session clock</button></p>
      ) : (
        <div className="stages">
          {kit.stages.map((s: any, i: number) => {
            const current = i === stageIdx;
            const over = current && stageElapsedMin > s.maxMinutes;
            return (
              <div key={s.id} className={`stage ${current ? "current" : ""} ${over ? "over" : ""}`}>
                <div className="small muted">{s.title}</div>
                <div className="t">
                  {current ? `${Math.floor(stageElapsedMin)}′` : ""} / {s.minMinutes === s.maxMinutes ? s.maxMinutes : `${s.minMinutes}-${s.maxMinutes}`}′
                </div>
                {current && i < kit.stages.length - 1 && (
                  <button className="subtle" onClick={nextStage}>next stage →</button>
                )}
              </div>
            );
          })}
          <div className="stage">
            <div className="small muted">Total</div>
            <div className="t">{Math.floor((now - started) / 60000)}′</div>
          </div>
        </div>
      )}

      <div className="guide">
        <section>
          <p className="muted small">{kit.bankNote}</p>
          {questions.map((q: any) => (
            <div key={q.id}>
              <div
                className={`q ${asked.has(q.id) ? "asked" : ""}`}
                onClick={() => toggleAsked(q.id)}
                title={asked.has(q.id) ? "tap to un-mark" : "tap to mark asked"}
              >
                {q.text}
              </div>
              {q.listenFor && !asked.has(q.id) && (
                <p className="muted small listen">Listen for: {q.listenFor}</p>
              )}
            </div>
          ))}

          <h2>Concept block (final 10-15 min only — never earlier)</h2>
          <div className="script">
            <span className="label">Pitch (value only)</span>
            <p>{kit.conceptBlock.pitch}</p>
            <p className="muted small">{kit.conceptBlock.note}</p>
          </div>
          {kit.conceptBlock.steps.map((s: any) => (
            <div className="script" key={s.id}>
              <span className="label">
                {s.label}
                {s.codes.map((c: string) => <span className="chip" key={c}>{c}</span>)}
              </span>
              <p>{s.script}</p>
            </div>
          ))}
        </section>

        <section>
          <div className="card" style={{ position: "sticky", top: 70 }}>
            <h2 style={{ marginTop: 0 }}>Notes (autosaves)</h2>
            <textarea
              style={{ minHeight: 300, fontSize: 17 }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Type a note and pause — it saves and clears. Timestamped server-side."
            />
            <p className="muted small">
              Nothing here is required. If you never touch this screen, the transcript carries the data.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
