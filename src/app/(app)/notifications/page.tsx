import Link from "next/link";
import { ActionForm } from "@/components/client";
import { EmptyState } from "@/components/ui";
import { listNotifications } from "@/lib/data";
import { markAllNotificationsRead, markNotificationRead } from "../actions";

const stamp = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso)) + " UTC";

export default async function NotificationsPage() {
  const items = await listNotifications();
  const unread = items.filter((n) => !n.isRead).length;
  return (
    <main className="stack-lg">
      <h1>Notifications</h1>
      <p className="muted">
        Updates about processes you can access. Notifications are information only; they never
        approve work or change a status.
      </p>
      {unread > 0 && (
        <ActionForm
          action={markAllNotificationsRead}
          fields={{}}
          label={`Mark all ${unread} as read`}
        />
      )}
      {items.length === 0 ? (
        <EmptyState>You have no notifications.</EmptyState>
      ) : (
        <ul className="list">
          {items.map((n) => (
            <li key={n.id} className={n.isRead ? "note" : "note unread"}>
              <p>
                {!n.isRead && <span className="badge current">New</span>} {n.message}
              </p>
              <p className="meta">
                {stamp(n.createdAt)}
                {n.processCode && (
                  <>
                    {" · "}
                    <Link href={`/processes/${n.processCode}`}>Open process {n.processCode}</Link>
                  </>
                )}
              </p>
              {!n.isRead && (
                <ActionForm
                  action={markNotificationRead}
                  fields={{ id: n.id }}
                  label="Mark as read"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
