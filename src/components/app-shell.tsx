import Link from "next/link";
import { logout } from "@/app/actions";
import { BRAND } from "@/lib/brand";
import { DocSyncRunner } from "./doc-sync";
import { MaintenanceWatch } from "./maintenance-watch";
import { PushToggle } from "./push-toggle";
import { NavLinks, type NavItem } from "./nav";
import { ThemeToggle } from "./theme-toggle";

/** Left sidebar with the navigation, and the page content beside it. */
export function AppShell({
  items,
  unread,
  userLabel,
  demoRole,
  maintenance,
  docSync,
  children,
}: {
  items: NavItem[];
  unread: number;
  userLabel: string;
  /** Set in prototype demo mode: the sample role being shown. */
  demoRole?: string;
  /** Maintenance mode is on: only allowed administrators see the site, so they are reminded. */
  maintenance?: boolean;
  /** The System Administrator: saves uploaded files to a folder on their computer. */
  docSync?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="shell">
      <MaintenanceWatch />
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
          <PushToggle />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          {maintenance && (
            <Link href="/admin/maintenance" className="maint-note" role="status">
              <span className="maint-track">
                <span>
                  ⚠ MAINTENANCE MODE IS ON. Everyone else sees the maintenance page. Turn it off
                  when your work is done (Admin → Maintenance).
                </span>
                <span aria-hidden="true">
                  ⚠ MAINTENANCE MODE IS ON. Everyone else sees the maintenance page. Turn it off
                  when your work is done (Admin → Maintenance).
                </span>
              </span>
            </Link>
          )}
          {docSync && <DocSyncRunner />}
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
        </header>
        {demoRole && (
          <div className="demo-banner" role="note">
            Prototype demo · viewing as <strong>{demoRole}</strong> · sample data, changes are
            disabled · <Link href="/login">Switch role</Link>
          </div>
        )}
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
