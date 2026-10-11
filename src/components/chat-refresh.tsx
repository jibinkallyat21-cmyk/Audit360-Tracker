"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps the conversation list (latest message, unread counts) fresh while the page is open. */
export function ChatRefresh() {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(
      () => document.visibilityState === "visible" && router.refresh(),
      10_000,
    );
    return () => window.clearInterval(id);
  }, [router]);
  return null;
}
