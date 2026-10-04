/** Shown at once while the next page loads, so a click never feels dead. */
export default function Loading() {
  return (
    <div className="stack-lg" role="status" aria-live="polite">
      <div className="skeleton" style={{ height: 120 }} />
      <div className="skeleton" style={{ height: 220 }} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
