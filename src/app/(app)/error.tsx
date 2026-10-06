"use client";

/** Shown inside the app frame when a page fails to load, so people see a message and can retry. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="panel" role="alert">
      <h1>Something went wrong</h1>
      <p className="muted">
        This page could not be loaded. Try again. If it keeps happening, tell the administrator.
      </p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
