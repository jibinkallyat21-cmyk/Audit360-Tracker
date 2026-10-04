"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const MAX = 2 * 1024 * 1024;

/**
 * Uploads to the server, which validates size, type and file content again.
 * The checks here only save the user a round trip.
 */
export function UploadForm({
  subId,
  documents,
  reviewPoints,
}: {
  subId: string;
  documents: { id: string; name: string }[];
  reviewPoints: { id: string; label: string }[];
}) {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(false);
    const form = new FormData(e.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a file.");
    if (file.size > MAX) return setError("The file is larger than 2 MB.");
    if (!/\.(docx?|xlsx?)$/i.test(file.name)) {
      return setError("Only Word (.doc, .docx) and Excel (.xls, .xlsx) files are allowed.");
    }
    setBusy(true);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(body.error ?? "The upload failed.");
      ref.current?.reset();
      setDone(true);
      router.refresh();
    } catch {
      setError("The upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={ref} onSubmit={onSubmit} className="stack">
      <input type="hidden" name="sub" value={subId} />
      <label className="field">
        <span>Word or Excel file (max 2 MB)</span>
        <input
          type="file"
          name="file"
          required
          accept=".doc,.docx,.xls,.xlsx,application/msword,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        />
      </label>
      <div className="inline-form">
        <label className="field">
          <span>Upload as</span>
          <select name="document" defaultValue="">
            <option value="">A new document</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                New version of {d.name}
              </option>
            ))}
          </select>
        </label>
        {reviewPoints.length > 0 && (
          <label className="field">
            <span>Evidence for review point</span>
            <select name="reviewPoint" defaultValue="">
              <option value="">None</option>
              {reviewPoints.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Version note (optional)</span>
          <input name="note" maxLength={500} />
        </label>
      </div>
      <div className="inline-form">
        <button type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
        {error && (
          <span role="alert" className="error">
            {error}
          </span>
        )}
        {done && (
          <span role="status" className="muted">
            Uploaded.
          </span>
        )}
      </div>
    </form>
  );
}
