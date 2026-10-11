"use client";

import { useCallback, useEffect, useState } from "react";
import {
  chooseFolder,
  forget,
  getHandle,
  getInfo,
  permission,
  runSync,
  skipExisting,
  syncSupported,
  type SyncInfo,
} from "@/lib/doc-sync";

const EVERY_MS = 60_000;

/**
 * Runs the sync quietly while any page is open, for the administrator. If the browser needs the
 * folder permission confirmed again (it forgets it between visits), a small button asks for one
 * click; nothing else is shown.
 */
export function DocSyncRunner() {
  const [needsClick, setNeedsClick] = useState(false);

  const tick = useCallback(async (ask: boolean) => {
    try {
      if (!syncSupported()) return;
      const handle = await getHandle();
      if (!handle) return;
      const p = await permission(handle, ask);
      if (p !== "granted") return setNeedsClick(true);
      setNeedsClick(false);
      await runSync(handle);
    } catch {
      // try again on the next tick
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void tick(false), 3000);
    const id = window.setInterval(() => void tick(false), EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [tick]);

  if (!needsClick) return null;
  return (
    <button type="button" className="secondary" onClick={() => void tick(true)}>
      Resume saving files to my computer
    </button>
  );
}

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

/** Setup page: choose the folder, see what has been saved, stop syncing. */
export function DocSyncSetup() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [granted, setGranted] = useState(true);
  const [info, setInfo] = useState<SyncInfo | null>(null);
  const [existing, setExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!syncSupported()) return setSupported(false);
    setSupported(true);
    const handle = await getHandle();
    setFolder(handle ? handle.name : null);
    if (handle) setGranted((await permission(handle, false)) === "granted");
    setInfo((await getInfo()) ?? null);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  async function start() {
    setMessage(null);
    setBusy(true);
    try {
      const handle = await chooseFolder();
      if ((await permission(handle, true)) !== "granted") {
        setMessage("The browser did not get permission to save into that folder.");
        return;
      }
      if (!existing) await skipExisting();
      const result = await runSync(handle);
      setMessage(
        result
          ? `Saved ${result.lastSaved} file${result.lastSaved === 1 ? "" : "s"}.`
          : "Another check is already running.",
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setMessage(e instanceof Error ? e.message : "Something went wrong.");
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function checkNow() {
    setMessage(null);
    setBusy(true);
    try {
      const handle = await getHandle();
      if (!handle) return;
      if ((await permission(handle, true)) !== "granted") {
        setMessage("Permission to save into the folder was not given.");
        return;
      }
      const result = await runSync(handle);
      setMessage(
        result
          ? `Checked. ${result.lastSaved} new file${result.lastSaved === 1 ? "" : "s"} saved${result.lastFailed ? `, ${result.lastFailed} could not be saved (they will be tried again)` : ""}.`
          : "Another check is already running.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function stop() {
    await forget();
    setMessage("Stopped. Files already saved stay in the folder.");
    await refresh();
  }

  if (supported === null) return null;
  if (!supported) {
    return (
      <p className="muted" role="note">
        This needs Microsoft Edge or Google Chrome on a computer. Open the site there to set it up.
      </p>
    );
  }
  return (
    <div className="stack">
      {folder ? (
        <>
          <p>
            Saving into the folder <strong>{folder}</strong>
            {granted ? "." : ", but the browser wants you to confirm access again."}
          </p>
          {info?.lastRun && (
            <p className="muted">
              Last check {when(info.lastRun)} · {info.total} file{info.total === 1 ? "" : "s"} saved
              in total.
            </p>
          )}
          <div className="actions">
            <button type="button" onClick={checkNow} disabled={busy}>
              {busy ? "Working…" : granted ? "Check now" : "Confirm access and check now"}
            </button>
            <button type="button" className="secondary" onClick={stop} disabled={busy}>
              Stop saving to this folder
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={existing}
              onChange={(e) => setExisting(e.target.checked)}
            />{" "}
            Also save the files that are already uploaded
          </label>
          <div className="actions">
            <button type="button" onClick={start} disabled={busy}>
              {busy ? "Saving…" : "Choose a folder and start"}
            </button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="muted">
          {message}
        </p>
      )}
    </div>
  );
}
