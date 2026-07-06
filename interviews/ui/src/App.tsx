import { useEffect, useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { InterviewPage } from "./pages/Interview";
import { LiveGuide } from "./pages/LiveGuide";
import { Participants } from "./pages/Participants";
import { Reports } from "./pages/Reports";
import { Review } from "./pages/Review";

function useHash(): string {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/");
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const [, route, arg] = hash.slice(1).split("/"); // "#/review/3" → ["", "review", "3"]

  let page = <Dashboard />;
  if (route === "participants") page = <Participants />;
  else if (route === "interview" && arg) page = <InterviewPage id={Number(arg)} />;
  else if (route === "guide" && arg) page = <LiveGuide interviewId={Number(arg)} />;
  else if (route === "review" && arg) page = <Review interviewId={Number(arg)} />;
  else if (route === "reports") page = <Reports />;

  const active = (r: string) => (route === r || (!route && r === "") ? "active" : "");
  return (
    <>
      <nav className="top">
        <span className="brand">AIBadges Interviews</span>
        <a className={active("")} href="#/">Dashboard</a>
        <a className={active("participants")} href="#/participants">Participants</a>
        <a className={active("reports")} href="#/reports">Reports</a>
      </nav>
      <main>{page}</main>
    </>
  );
}
