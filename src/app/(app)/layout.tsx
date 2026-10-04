import Link from "next/link";
import { NavLinks, type NavItem } from "@/components/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireApprovedViewer } from "@/lib/access";
import { BRAND } from "@/lib/brand";
import { getCapabilities, getUnreadCount } from "@/lib/data";
import { logout } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireApprovedViewer();
  const [unread, caps] = await Promise.all([getUnreadCount(), getCapabilities()]);
  const items: NavItem[] = [
    { href: "/", label: "Dashboard" },
    { href: "/workflow", label: "Workflow" },
    { href: "/documents", label: "Documents" },
    { href: "/activity", label: "Activity" },
    { href: "/team", label: "Team" },
  ];
  if (caps.roles.has("system_admin")) items.push({ href: "/admin", label: "Admin" });
  if (caps.roles.has("system_admin") || caps.roles.has("project_head")) {
    items.push({ href: "/export", label: "Export" });
  }
  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <strong>
            {BRAND.company} <em>{BRAND.product}</em>
          </strong>
          <small>{BRAND.tagline}</small>
        </Link>
        <NavLinks items={items} />
        <span className="spacer" />
        <Link href="/notifications" className="bell" aria-label={`Notifications, ${unread} unread`}>
          <span aria-hidden="true">🔔</span>
          {unread > 0 && <span className="count">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <ThemeToggle />
        <span className="who">{viewer.fullName ?? viewer.email}</span>
        <form action={logout}>
          <button type="submit" className="secondary">
            Sign out
          </button>
        </form>
      </header>
      <div className="content">{children}</div>
    </div>
  );
}
