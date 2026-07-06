import { useState } from "react";
import { api } from "../api";

const TABS = [
  { id: "A", label: "Segment A" },
  { id: "B", label: "Segment B" },
  { id: "C", label: "Segment C" },
  { id: "final", label: "Final report" },
];

export function Reports() {
  const [tab, setTab] = useState("final");
  const [md, setMd] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function load(id: string) {
    setTab(id);
    if (md[id]) return;
    setLoading(true);
    try {
      const path = id === "final" ? "/api/reports/final" : `/api/reports/segment/${id}`;
      const text = (await api.get(path)) as string;
      setMd((m) => ({ ...m, [id]: text }));
    } finally {
      setLoading(false);
    }
  }

  function download() {
    const blob = new Blob([md[tab] ?? ""], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = tab === "final" ? "final-report.md" : `segment-${tab}.md`;
    a.click();
  }

  return (
    <>
      <h1>Reports</h1>
      <p>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "primary" : ""}
            style={{ marginRight: 8 }}
            onClick={() => load(t.id)}
          >
            {t.label}
          </button>
        ))}
        {md[tab] && <button className="subtle" onClick={download}>download .md</button>}
      </p>
      {loading && <p className="muted">Generating (GLM drafts the prose; numbers come from the engine)…</p>}
      {!loading && !md[tab] && <p className="muted">Pick a report — generation takes a few seconds.</p>}
      {md[tab] && <div className="report">{md[tab]}</div>}
    </>
  );
}
