"use client";

import { useActionState, useEffect, useState } from "react";
import type { FormState } from "@/app/actions";
import { remaining } from "@/lib/countdown";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

/** A small form that posts to a server action and shows its result inline. */
export function ActionForm({
  action,
  fields,
  label,
  children,
  className,
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className ?? "inline-form"}>
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : label}
      </button>
      {state.error && (
        <span role="alert" className="error">
          {state.error}
        </span>
      )}
      {state.message && (
        <span role="status" className="muted">
          {state.message}
        </span>
      )}
    </form>
  );
}

export function SelectField({
  name,
  label,
  options,
  value,
}: {
  name: string;
  label: string;
  options: { value: string; label: string }[];
  value?: string;
}) {
  return (
    <label className="inline-field">
      <span className="sr-only">{label}</span>
      <select name={name} defaultValue={value} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Shared project countdown. Remaining time is computed from the stored deadline. */
export function Countdown({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  if (!deadline) {
    return (
      <section className="countdown" aria-label="Project deadline countdown">
        <h2>Project deadline</h2>
        <p className="muted">The deadline has not been set yet.</p>
      </section>
    );
  }
  const r = now === null ? null : remaining(deadline, now);
  const local = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(deadline));
  return (
    <section className="countdown" aria-label="Project deadline countdown">
      <h2>Project deadline</h2>
      {r?.expired ? (
        <p className="expired" role="status">
          The deadline has passed.
        </p>
      ) : (
        <div className="digits" role="timer" aria-live="off">
          {(["days", "hours", "minutes", "seconds"] as const).map((k) => (
            <div key={k}>
              <strong>{r ? String(r[k]).padStart(2, "0") : "--"}</strong>
              <span>{k}</span>
            </div>
          ))}
        </div>
      )}
      <p className="muted">Deadline: {local}</p>
    </section>
  );
}
