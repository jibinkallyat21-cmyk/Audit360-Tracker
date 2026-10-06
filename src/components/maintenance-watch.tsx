"use client";

import { useEffect } from "react";

/**
 * Checks every few seconds whether the site has gone into maintenance. If it has (the answer is
 * HTTP 503 for everyone but the administrators), the page reloads and shows the notice, so people
 * who already have the site open are not left working on it.
 */
export function MaintenanceWatch() {
  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch("/api/maintenance", { cache: "no-store" });
        if (r.status === 503) window.location.reload();
      } catch {
        // offline or a brief network problem: try again on the next tick
      } finally {
        busy = false;
      }
    };
    const id = window.setInterval(check, 10_000);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
