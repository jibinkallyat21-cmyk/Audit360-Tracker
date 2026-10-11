import { ActionForm } from "@/components/client";
import { PageHero } from "@/components/ui";
import { requireApprovedViewer } from "@/lib/access";
import { maintenanceAllowed } from "@/lib/maintenance";
import { createClient } from "@/lib/supabase/server";
import { setMaintenance } from "../actions";

export default async function MaintenancePage() {
  const me = await requireApprovedViewer();
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_maintenance");
  const row = (data as { maintenance_on: boolean; updated_at: string }[] | null)?.[0];
  const on = row?.maintenance_on ?? false;
  const allowed = maintenanceAllowed(me.email);
  const since = row
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(row.updated_at)) + " UTC"
    : null;

  return (
    <main className="stack-lg">
      <PageHero eyebrow="Admin" title="Maintenance mode" />
      <section className="panel">
        <h2>The site is {on ? "under maintenance" : "live"}</h2>
        <p className="muted">
          {on
            ? "Everyone except the allowed administrators sees the maintenance page, including people who already have the site open (their page reloads within about ten seconds)."
            : "Everyone can use the site. Turn maintenance on to show the maintenance page to all other users."}
          {since && <> Last changed {since}.</>}
        </p>
        {allowed ? (
          <div className="actions">
            <ActionForm
              action={setMaintenance}
              fields={{ on: on ? "false" : "true" }}
              label={on ? "Turn maintenance off (go live)" : "Turn maintenance on"}
              quiet={on}
            />
          </div>
        ) : (
          <p className="muted" role="note">
            Your account is not on the maintenance allow-list, so you would be locked out. Ask the
            project owner to add your email to MAINTENANCE_ALLOWED_EMAILS before using this switch.
          </p>
        )}
        <p className="muted">
          Allowed administrators keep full access while maintenance is on. A change shows up for
          other users within a few seconds.
        </p>
      </section>
    </main>
  );
}
