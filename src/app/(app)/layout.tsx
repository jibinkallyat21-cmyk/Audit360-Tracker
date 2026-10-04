import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav";
import { requireApprovedViewer } from "@/lib/access";
import { getCapabilities, getUnreadCount } from "@/lib/data";

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
    <AppShell items={items} unread={unread} userLabel={viewer.fullName ?? viewer.email}>
      {children}
    </AppShell>
  );
}
