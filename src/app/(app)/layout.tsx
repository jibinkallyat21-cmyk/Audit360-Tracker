import { requireApprovedViewer } from "@/lib/access";
import { logout } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireApprovedViewer();
  return (
    <div className="shell">
      <header className="topbar">
        <strong>Tracker &amp; Review</strong>
        <span className="spacer" />
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
