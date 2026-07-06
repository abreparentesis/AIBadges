import { useEffect, useState } from "react";
import { api } from "../api";
import { WorkflowStrip } from "../components/WorkflowStrip";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "call pending",
  done: "call done",
  transcribed: "coding",
  coded: "review pending",
  reviewed: "reviewed ✓",
};

function NextAction({ i }: { i: any }) {
  switch (i.status) {
    case "scheduled":
      return (
        <>
          <a className="btn" href={`#/guide/${i.id}`}>Open live guide</a>{" "}
          <a href={`#/interview/${i.id}`}>upload transcript</a>
        </>
      );
    case "transcribed":
      return <a className="btn" href={`#/interview/${i.id}`}>Check coding</a>;
    case "coded":
      return <a className="btn" href={`#/review/${i.id}`}>Review codes</a>;
    default:
      return <a href={`#/interview/${i.id}`}>view</a>;
  }
}

export function Dashboard() {
  const [seg, setSeg] = useState<any>(null);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/api/segments").then(setSeg).catch((e) => setErr(e.message));
    api.get("/api/interviews").then(setInterviews).catch(() => {});
    api.get("/api/participants").then(setParticipants).catch(() => {});
  }, []);

  if (err) return <p className="muted">Error: {err}</p>;
  if (!seg) return <p className="muted">Loading…</p>;

  const hasTranscript = interviews.some((i) => i.status !== "scheduled");
  const hasCoded = interviews.some((i) => ["coded", "reviewed"].includes(i.status));
  const activeStep =
    participants.length === 0 ? 1
    : interviews.length === 0 ? 2
    : !hasTranscript ? 3
    : !hasCoded ? 4
    : 5;
  const learning = interviews.filter((i) => i.status === "reviewed").length < 3;

  return (
    <>
      <h1>Study dashboard</h1>
      {learning && <WorkflowStrip activeStep={activeStep} />}

      {seg.crossSegmentKill && (
        <div className="banner kill">
          Cross-segment kill (H5): no segment has a consistent single buyer with budget
          authority. Kill or rescope the B2B angle regardless of pain and spend scores.
        </div>
      )}

      <div className="grid cols-3">
        {(["A", "B", "C"] as const).map((p) => {
          const s = seg.perProfile[p];
          const n = s.metrics.n;
          return (
            <div className="card" key={p}>
              <h2 style={{ marginTop: 0 }}>
                {p} — {s.label}{" "}
                {n > 0 && <span className={`badge ${s.verdict}`}>{s.verdict}</span>}
              </h2>
              <p className="muted small">
                {Object.entries(s.counts)
                  .map(([k, v]) => `${v} ${STATUS_LABEL[k] ?? k}`)
                  .join(" · ") || "no interviews yet"}
              </p>
              {n === 0 ? (
                <p className="muted small">
                  Verdict appears once interviews are reviewed (rules run from 5).
                </p>
              ) : (
                <>
                  <p className="small">
                    pain ≥2: <b>{s.metrics.painRealPct.toFixed(0)}%</b> · spend:{" "}
                    <b>{s.metrics.spendPct.toFixed(0)}%</b> · COMMIT-2+:{" "}
                    <b>{s.metrics.commit2PlusPct.toFixed(0)}%</b>
                    {s.metrics.hasCommit3 ? " (incl. C3)" : ""} · PRIV-RED:{" "}
                    <b>{s.metrics.privRedPct.toFixed(0)}%</b>
                  </p>
                  <p className="small">
                    buyer: <b>{s.metrics.buyerConsistent ? s.metrics.buyerRole : "not consistent"}</b>
                  </p>
                  {s.reasons.length > 0 && <p className="muted small">{s.reasons.join("; ")}</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
      {seg.ranking.length > 0 && (
        <p><b>Build order:</b> {seg.ranking.join(" → ")}</p>
      )}

      <h2>Interviews</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Participant</th><th>Profile</th><th>Status</th><th>Next action</th></tr>
        </thead>
        <tbody>
          {interviews.map((i) => (
            <tr key={i.id}>
              <td>{i.id}</td>
              <td>{i.participant?.pseudonym}</td>
              <td>{i.participant?.profile}</td>
              <td><span className="badge status">{STATUS_LABEL[i.status] ?? i.status}</span></td>
              <td><NextAction i={i} /></td>
            </tr>
          ))}
          {interviews.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No interviews yet. <a href="#/participants">Add your first participant</a> to begin.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
