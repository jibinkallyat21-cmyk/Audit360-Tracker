"use client";

import { useActionState } from "react";

export interface InviteResult {
  email: string;
  ok: boolean;
  detail: string;
  link?: string;
}
export interface InviteState {
  error?: string;
  results?: InviteResult[];
}
type Action = (state: InviteState, form: FormData) => Promise<InviteState>;

export interface InviteRow {
  email: string;
  suggestedId: string;
  note: string;
}

/** Review step: confirm who each email belongs to, then send the invites. */
export function InviteForm({
  action,
  rows,
  people,
}: {
  action: Action;
  rows: InviteRow[];
  people: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.results) {
    return (
      <div className="stack">
        <ul className="row-list">
          {state.results.map((r) => (
            <li key={r.email}>
              <span>
                <strong>{r.email}</strong>
                <br />
                <span className={r.ok ? "muted" : "error"}>{r.detail}</span>
                {r.link && (
                  <>
                    <br />
                    <input readOnly value={r.link} aria-label={`Invite link for ${r.email}`} />
                  </>
                )}
              </span>
              <span className={r.ok ? "badge current" : "badge superseded"}>
                {r.ok ? "Done" : "Not sent"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <form action={formAction} className="stack">
      <ul className="row-list">
        {rows.map((r) => (
          <li key={r.email}>
            <span>
              <strong>{r.email}</strong>
              <br />
              <span className="muted">{r.note}</span>
              <input type="hidden" name="email" value={r.email} />
            </span>
            <select
              name="person"
              defaultValue={r.suggestedId}
              required
              aria-label={`Person for ${r.email}`}
            >
              <option value="">Choose person…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      <fieldset className="stack">
        <legend>How should they get the invite?</legend>
        <label className="check">
          <input type="radio" name="mode" value="email" defaultChecked />
          <span>Send the invite by email</span>
        </label>
        <label className="check">
          <input type="radio" name="mode" value="link" />
          <span>Don&apos;t email. Show me each link so I can send it myself</span>
        </label>
      </fieldset>
      {state.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <div>
        <button type="submit" disabled={pending}>
          {pending
            ? "Inviting…"
            : `Invite ${rows.length} ${rows.length === 1 ? "person" : "people"}`}
        </button>
      </div>
    </form>
  );
}
