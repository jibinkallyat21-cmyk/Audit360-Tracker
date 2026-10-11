import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav";
import { getPersona } from "@/lib/demo";
import { requireApprovedViewer } from "@/lib/access";
import { getCapabilities, getChatUnread, getUnreadCount, listSubprocesses } from "@/lib/data";
import { buildQueue, queueCount } from "@/lib/queue";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireApprovedViewer();
  const persona = await getPersona();
  const [unread, caps, chatUnread, rows] = await Promise.all([
    getUnreadCount(),
    getCapabilities(),
    getChatUnread(),
    listSubprocesses(),
  ]);
  const waiting = queueCount(buildQueue(rows, caps));
  const items: NavItem[] = [
    { href: "/", label: "Dashboard" },
    { href: "/queue", label: "My queue", badge: waiting },
    { href: "/workflow", label: "Workflow" },
    { href: "/documents", label: "Documents" },
    { href: "/chat", label: "Chat", badge: chatUnread },
    { href: "/activity", label: "Activity" },
    { href: "/team", label: "Team" },
  ];
  if (caps.roles.has("system_admin")) items.push({ href: "/admin", label: "Admin" });
  if (caps.roles.has("system_admin") || caps.roles.has("project_head")) {
    items.push({ href: "/export", label: "Export" });
  }
  return (
    <AppShell
      items={items}
      unread={unread}
      userLabel={viewer.fullName ?? viewer.email}
      demoRole={persona?.role}
    >
      {children}
    </AppShell>
  );
}
