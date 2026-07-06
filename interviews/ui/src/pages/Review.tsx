import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const TYPE_VALUES: Record<string, string[]> = {
  PAIN: ["0", "1", "2", "3"],
  SPEND: ["true"],
  ALT: ["current"],
  BUYER: [],
  PRIV_PRE: ["GREEN", "AMBER", "RED"],
  PRIV_POST: ["GREEN", "AMBER", "RED"],
  PARTIC: ["low", "mixed", "high"],
  COMMIT: ["0", "1", "2", "3"],
};

export function Review({ interviewId }: { interviewId: number }) {
  const [data, setData] = useState<any>(null);
  const [hl, setHl] = useState<number | null>(null);
  const [verdictDelta, setVerdictDelta] = useState<any>(null);
  const [manual, setManual] = useState({ type: "PAIN", value: "2", quote: "", turnRef: 0 });
  const [err, setErr] = useState("");

  const reload = () =>
    api.get(`/api/interviews/${interviewId}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { reload(); }, [interviewId]);

  const pending = useMemo(
    () => (data?.codes ?? []).filter((c: any) => c.state === "ai_suggested"),
    [data],
  );
  const decided = useMemo(
    () => (data?.codes ?? []).filter((c: any) => c.state !== "ai_suggested"),
    [data],
  );

  async function setState(codeId: number, state: string, value?: string) {
    await api.post(`/api/codes/${codeId}`, { state, value });
    reload();
  }

  async function addManual() {
    setErr("");
    try {
      await api.post(`/api/interviews/${interviewId}/codes`, manual);
      setManual({ ...manual, quote: "" });
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function markReviewed() {
    const res = (await api.post(`/api/interviews/${interviewId}/review-done`)) as any;
    setVerdictDelta(res.segments);
    reload();
  }

  function scrollToTurn(i: number) {
    setHl(i);
    document.getElementById(`turn-${i}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  if (!data) return <p className="muted">{err || "Loading…"}</p>;
  const profile = data.participant.profile;

  return (
    <>
      <h1>
        Review — {data.participant.pseudonym} ({profile}){" "}
        <span className="badge status">{data.status}</span>
      </h1>
      <div className="review">
        <section className="card turns">
          {data.turns.map((t: any) => (
            <div className={`turn ${hl === t.i ? "hl" : ""}`} id={`turn-${t.i}`} key={t.i}>
              <span className="spk">[{t.i}] {t.speaker}</span>
              <div>{t.text}</div>
            </div>
          ))}
        </section>

        <section>
          <h2 style={{ marginTop: 0 }}>Suggested codes ({pending.length})</h2>
          {pending.map((c: any) => (
            <div className="codecard" key={c.id}>
              <b>{c.type}</b>{" "}
              {TYPE_VALUES[c.type]?.length ? (
                <select
                  style={{ width: "auto" }}
                  defaultValue={c.value}
                  onChange={(e) => setState(c.id, "edited", e.target.value)}
                >
                  {TYPE_VALUES[c.type].map((v) => <option key={v}>{v}</option>)}
                </select>
              ) : (
                <code>{c.value}</code>
              )}
              {c.confidence != null && <span className="muted small"> conf {(c.confidence * 100).toFixed(0)}%</span>}
              <blockquote onClick={() => scrollToTurn(c.turnRef)} title="show in transcript">
                "{c.quote}" — turn {c.turnRef}
              </blockquote>
              <button className="primary" onClick={() => setState(c.id, "confirmed")}>confirm</button>{" "}
              <button onClick={() => setState(c.id, "rejected")}>reject</button>
            </div>
          ))}
          {pending.length === 0 && <p className="muted">Nothing pending.</p>}

          <h2>Add manual code</h2>
          <div className="codecard">
            <select
              style={{ width: "auto" }}
              value={manual.type}
              onChange={(e) => {
                const type = e.target.value;
                setManual({ ...manual, type, value: TYPE_VALUES[type][0] ?? "" });
              }}
            >
              {Object.keys(TYPE_VALUES).map((t) => <option key={t}>{t}</option>)}
            </select>{" "}
            {TYPE_VALUES[manual.type].length ? (
              <select
                style={{ width: "auto" }}
                value={manual.value}
                onChange={(e) => setManual({ ...manual, value: e.target.value })}
              >
                {TYPE_VALUES[manual.type].map((v) => <option key={v}>{v}</option>)}
              </select>
            ) : (
              <input
                style={{ width: 200, display: "inline-block" }}
                placeholder="role, or TRIANGLE"
                value={manual.value}
                onChange={(e) => setManual({ ...manual, value: e.target.value })}
              />
            )}
            <label>Quote (verbatim) + turn</label>
            <input
              placeholder="verbatim quote"
              value={manual.quote}
              onChange={(e) => setManual({ ...manual, quote: e.target.value })}
            />
            <input
              type="number"
              style={{ width: 100, marginTop: 6 }}
              value={manual.turnRef}
              onChange={(e) => setManual({ ...manual, turnRef: Number(e.target.value) })}
            />
            <p><button onClick={addManual}>add</button> {err && <span style={{ color: "var(--red)" }}>{err}</span>}</p>
          </div>

          {decided.length > 0 && (
            <>
              <h2>Decided <span className="muted small">(every decision can be undone)</span></h2>
              {decided.map((c: any) => (
                <div className={`codecard ${c.state}`} key={c.id}>
                  <b>{c.type}</b> <code>{c.value}</code>{" "}
                  <span className="muted small">{c.state}</span>
                  {c.state === "manual" ? (
                    <button className="undo" onClick={() => api.del(`/api/codes/${c.id}`).then(reload)}>
                      delete
                    </button>
                  ) : (
                    <button className="undo" onClick={() => setState(c.id, "ai_suggested")}>
                      undo → back to pending
                    </button>
                  )}
                  {c.quote && (
                    <blockquote onClick={() => scrollToTurn(c.turnRef)}>"{c.quote}"</blockquote>
                  )}
                </div>
              ))}
            </>
          )}

          <p style={{ marginTop: 20 }}>
            {data.status === "reviewed" ? (
              <button
                onClick={() =>
                  api.post(`/api/interviews/${interviewId}/reopen`).then(() => { setVerdictDelta(null); reload(); })
                }
              >
                Reopen review (undo "mark reviewed")
              </button>
            ) : (
              <button className="primary" onClick={markReviewed} disabled={pending.length > 0}>
                Mark reviewed{pending.length > 0 ? ` (${pending.length} to decide first)` : ""}
              </button>
            )}
          </p>
          {verdictDelta && (
            <div className="card">
              Segment {profile} now:{" "}
              <span className={`badge ${verdictDelta.perProfile[profile].verdict}`}>
                {verdictDelta.perProfile[profile].verdict}
              </span>{" "}
              <span className="muted small">
                {verdictDelta.perProfile[profile].reasons.join("; ")}
              </span>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
