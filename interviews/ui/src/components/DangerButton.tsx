import { useEffect, useState } from "react";

/**
 * Two-step inline confirm: first click arms it ("Delete → Sure?"), second
 * click within 4s executes. No modal; disarms on timeout.
 */
export function DangerButton({
  label,
  confirmLabel = "Sure? This deletes everything under it",
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      className={armed ? "danger armed" : "danger"}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
