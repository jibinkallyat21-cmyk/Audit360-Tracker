"use client";

import { useActionState } from "react";

export interface InviteResult {
  email: string;
  name?: string;
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
  /** The account already exists (never signed in); a fresh link will be made. */
  existing?: boolean;
  suggestedId: string;
  note: string;
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** Email, Name, InviteLink: ready for a Word mail merge sent from Outlook. */
function downloadCsv(results: InviteResult[]) {
  const lines = [
    "Email,Name,InviteLink",
    ...results
      .filter((r) => r.link)
      .map((r) => [r.email, r.name ?? "", r.link!].map(csvCell).join(",")),
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "invite-links.csv";
  a.click();
  URL.revokeObjectURL(url);
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
        {state.results.some((r) => r.link) && (
          <div>
            <button type="button" onClick={() => downloadCsv(state.results!)}>
              Download links as CSV
            </button>
            <p className="muted">
              For an Outlook mail merge. The links expire (see the setup note), so send them soon
              after downloading. Keep the file private and delete it afterwards.
            </p>
          </div>
        )}
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
