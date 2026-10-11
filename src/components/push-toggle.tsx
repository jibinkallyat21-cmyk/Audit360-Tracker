"use client";

import { useEffect, useState } from "react";

type State = "checking" | "unsupported" | "blocked" | "off" | "on";

const toKey = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const supported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** Turns desktop notifications on or off for this browser. */
export function PushToggle() {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: State = "unsupported";
      if (supported()) {
        if (Notification.permission === "denied") next = "blocked";
        else {
          const reg = await navigator.serviceWorker.getRegistration("/sw.js");
          const sub = await reg?.pushManager.getSubscription();
          next = sub && Notification.permission === "granted" ? "on" : "off";
        }
      }
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const keyRes = await fetch("/api/push/key", { cache: "no-store" });
      const { key } = (await keyRes.json()) as { key?: string };
      if (!keyRes.ok || !key) throw new Error("key");
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toKey(key),
        }));
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (!res.ok) throw new Error("save");
      setState("on");
    } catch {
      setError("Could not turn notifications on.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setError("Could not turn notifications off.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") return null;
  return (
    <div className="push-toggle">
      <span className="muted">
        Desktop alerts:{" "}
        <strong>
          {state === "on"
            ? "on"
            : state === "blocked"
              ? "blocked in your browser"
              : state === "unsupported"
                ? "not supported here"
                : "off"}
        </strong>
      </span>
      {(state === "off" || state === "on") && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={state === "on" ? turnOff : turnOn}
        >
          {busy ? "Please wait…" : state === "on" ? "Turn off" : "Turn on"}
        </button>
      )}
      {state === "blocked" && (
        <span className="muted">Allow notifications for this site in your browser settings.</span>
      )}
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </div>
  );
}
