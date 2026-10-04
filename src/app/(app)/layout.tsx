import Link from "next/link";
import { requireApprovedViewer } from "@/lib/access";
import { getCapabilities, getUnreadCount } from "@/lib/data";
import { logout } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireApprovedViewer();
  const [unread, caps] = await Promise.all([getUnreadCount(), getCapabilities()]);
  return (
    <div className="shell">
      <header className="topbar">
        <strong>Tracker &amp; Review</strong>
        <nav aria-label="Main" className="nav">
          <Link href="/">Dashboard</Link>
          <Link href="/workflow">Workflow</Link>
          <Link href="/documents">Documents</Link>
          <Link href="/activity">Activity</Link>
          <Link href="/team">Team</Link>
          {caps.roles.has("system_admin") && <Link href="/admin">Admin</Link>}
        </nav>
        <span className="spacer" />
        <Link href="/notifications" className="bell" aria-label={`Notifications, ${unread} unread`}>
          <span aria-hidden="true">🔔</span>
          {unread > 0 && <span className="count">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <span className="muted">{viewer.fullName ?? viewer.email}</span>
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
