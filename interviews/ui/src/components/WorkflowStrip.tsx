const STEPS = [
  { n: 1, title: "Add a participant", detail: "Paste their screener answers, verify LinkedIn.", href: "#/participants" },
  { n: 2, title: "Create the interview", detail: "From the roster, when the call is booked." },
  { n: 3, title: "Run the call", detail: "Open the live guide for timers, questions, and scripts." },
  { n: 4, title: "Drop the transcript", detail: "VTT or TXT from Zoom/Meet. GLM codes it for you." },
  { n: 5, title: "Review the codes", detail: "Confirm or reject each suggestion. Verdicts update live." },
];

/**
 * The pipeline, taught on screen. `activeStep` highlights where the study
 * currently is; numbers are real sequence, not decoration.
 */
export function WorkflowStrip({ activeStep }: { activeStep: number }) {
  return (
    <ol className="workflow">
      {STEPS.map((s) => (
        <li key={s.n} className={s.n === activeStep ? "now" : s.n < activeStep ? "done" : ""}>
          <span className="n">{s.n < activeStep ? "✓" : s.n}</span>
          <div>
            {s.href && s.n === activeStep ? <a href={s.href}>{s.title}</a> : <b>{s.title}</b>}
            <div className="muted small">{s.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
