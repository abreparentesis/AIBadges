import { useEffect, useState } from "react";
import { api } from "../api";
import { DangerButton } from "../components/DangerButton";

export function Participants() {
  const [list, setList] = useState<any[]>([]);
  const [kit, setKit] = useState<any>(null);
  const [profile, setProfile] = useState("A");
  const [source, setSource] = useState("respondent");
  const [screener, setScreener] = useState("");
  const [verified, setVerified] = useState(false);
  const [err, setErr] = useState("");

  const reload = () => api.get("/api/participants").then(setList).catch((e) => setErr(e.message));
  useEffect(() => {
    reload();
    api.get("/api/kit").then(setKit).catch(() => {});
  }, []);

  async function create() {
    setErr("");
    const screenerObj: Record<string, string> = {};
    for (const line of screener.split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) screenerObj[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    try {
      await api.post("/api/participants", {
        profile,
        source,
        screener: screenerObj,
        linkedinVerified: verified,
      });
      setScreener("");
      setVerified(false);
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function newInterview(pid: number) {
    const i = (await api.post(`/api/participants/${pid}/interviews`, {})) as any;
    location.hash = `#/interview/${i.id}`;
  }

  const screenerHints: string[] = kit?.screeners?.[profile] ?? [];

  return (
    <>
      <h1>Participants</h1>
      <div className="grid cols-2">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>New participant</h2>
          <label>Profile</label>
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="A">A — Talent / L&D</option>
            <option value="B">B — Finance</option>
            <option value="C">C — Technical</option>
          </select>
          <label>Source platform</label>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option>respondent</option>
            <option>userinterviews</option>
            <option>cleverx</option>
            <option>warm-intro</option>
          </select>
          <label>Screener answers (one per line, "field: answer")</label>
          <textarea
            value={screener}
            onChange={(e) => setScreener(e.target.value)}
            placeholder={"title: VP Engineering\ncompany size: 400\nai tools: Copilot 300 seats"}
          />
          {screenerHints.length > 0 && (
            <p className="muted small">Screener for {profile}: {screenerHints.join(" · ")}</p>
          )}
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              style={{ width: "auto" }}
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
            LinkedIn title and company verified (required before accepting platform panelists)
          </label>
          {!verified && <p className="muted small">⚠ unverified — professional panelists exaggerate seniority</p>}
          {err && <p className="small" style={{ color: "var(--red)" }}>{err}</p>}
          <p><button className="primary" onClick={create}>Add participant</button></p>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Roster</h2>
          <table>
            <thead>
              <tr><th>Pseudonym</th><th>Profile</th><th>Source</th><th>Verified</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>{p.pseudonym}</td>
                  <td>{p.profile}</td>
                  <td>{p.source}</td>
                  <td>{p.linkedinVerified ? "✓" : "⚠"}</td>
                  <td>
                    <button className="subtle" onClick={() => newInterview(p.id)}>new interview</button>{" "}
                    <DangerButton
                      label="delete"
                      confirmLabel="Delete participant + interviews?"
                      onConfirm={() => api.del(`/api/participants/${p.id}`).then(reload)}
                    />
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Nobody yet. Add your first recruit on the left; each one gets a pseudonym
                    (P1, P2, …) used everywhere instead of their name.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
