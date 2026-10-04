import Link from "next/link";
import { logout } from "@/app/actions";
import { BRAND } from "@/lib/brand";
import { NavLinks, type NavItem } from "./nav";
import { ThemeToggle } from "./theme-toggle";

/** Left sidebar with the navigation, and the page content beside it. */
export function AppShell({
  items,
  unread,
  userLabel,
  children,
}: {
  items: NavItem[];
  unread: number;
  userLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <strong>
            {BRAND.company} <em>{BRAND.product}</em>
          </strong>
          <small>{BRAND.tagline}</small>
        </Link>
        <NavLinks items={items} />
        <div className="side-foot">
          <span className="who">{userLabel}</span>
          <div className="side-actions">
            <Link
              href="/notifications"
              className="bell"
              aria-label={`Notifications, ${unread} unread`}
            >
              <span aria-hidden="true">🔔</span>
              {unread > 0 && <span className="count">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <ThemeToggle />
            <form action={logout}>
              <button type="submit" className="secondary">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
