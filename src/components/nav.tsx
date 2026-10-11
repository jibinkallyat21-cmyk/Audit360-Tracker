"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export interface NavItem {
  href: string;
  label: string;
  /** Unread count shown beside the label (chat). */
  badge?: number;
}

/** Unread chat count beside the "Chat" link, kept fresh every few seconds. */
function ChatBadge({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  useEffect(() => {
    const id = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/chat/unread", { cache: "no-store" });
        if (res.ok) setCount(((await res.json()) as { unread: number }).unread);
      } catch {
        // try again on the next tick
      }
    }, 15_000);
    return () => window.clearInterval(id);
  }, []);
  // A fresh server value (after a page change) wins over the polled one.
  useEffect(() => {
    const t = window.setTimeout(() => setCount(initial), 0);
    return () => window.clearTimeout(t);
  }, [initial]);
  if (count <= 0) return null;
  return (
    <span className="nav-count" aria-label={`${count} unread chat messages`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Main navigation with the current section underlined. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const active = (href: string) =>
    href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
  return (
    <nav aria-label="Main" className="nav">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={active(i.href) ? "page" : undefined}>
          {i.label}
          {i.href === "/chat" && <ChatBadge initial={i.badge ?? 0} />}
        </Link>
      ))}
    </nav>
  );
}

/** Second-level navigation (the Admin sections) with the current page marked. */
export function SubNav({ items, label }: { items: NavItem[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="subnav">
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={path === i.href ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
