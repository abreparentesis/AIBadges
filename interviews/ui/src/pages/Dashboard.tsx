import { useEffect, useState } from "react";
import { api } from "../api";

export function Dashboard() {
  const [seg, setSeg] = useState<any>(null);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get("/api/segments").then(setSeg).catch((e) => setErr(e.message));
    api.get("/api/interviews").then(setInterviews).catch(() => {});
  }, []);

  if (err) return <p className="muted">Error: {err}</p>;
  if (!seg) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1>Study dashboard</h1>
      {seg.crossSegmentKill && (
        <div className="banner kill">
          Cross-segment kill (H5): no segment has a consistent single buyer with budget
          authority. Kill or rescope the B2B angle regardless of pain and spend scores.
        </div>
      )}
      <div className="grid cols-3">
        {(["A", "B", "C"] as const).map((p) => {
          const s = seg.perProfile[p];
          return (
            <div className="card" key={p}>
              <h2 style={{ marginTop: 0 }}>
                {p} — {s.label} <span className={`badge ${s.verdict}`}>{s.verdict}</span>
              </h2>
              <p className="muted small">
                {Object.entries(s.counts).map(([k, v]) => `${v} ${k}`).join(" · ") || "no interviews yet"}
              </p>
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
            </div>
          );
        })}
      </div>
      {seg.ranking.length > 0 && (
        <p>
          <b>Build order:</b> {seg.ranking.join(" → ")}
        </p>
      )}

      <h2>Interviews</h2>
      <table>
        <thead>
          <tr><th>#</th><th>Participant</th><th>Profile</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {interviews.map((i) => (
            <tr key={i.id}>
              <td>{i.id}</td>
              <td>{i.participant?.pseudonym}</td>
              <td>{i.participant?.profile}</td>
              <td><span className="badge status">{i.status}</span></td>
              <td>
                <a href={`#/guide/${i.id}`}>guide</a> · <a href={`#/interview/${i.id}`}>detail</a>
                {(i.status === "coded" || i.status === "reviewed") && (
                  <> · <a href={`#/review/${i.id}`}>review</a></>
                )}
              </td>
            </tr>
          ))}
          {interviews.length === 0 && (
            <tr><td colSpan={5} className="muted">No interviews yet — add a participant first.</td></tr>
          )}
        </tbody>
      </table>
    </>
  );
}
