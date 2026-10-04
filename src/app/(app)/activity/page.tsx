import Link from "next/link";
import { EmptyState } from "@/components/ui";
import { actionLabel, describeChange, safeSearch } from "@/lib/activity";
import { listSubprocesses } from "@/lib/data";
import { ACTIVITY_SELECT } from "@/lib/queries";
import { resolveNames } from "@/lib/records";
import { createClient } from "@/lib/supabase/server";

const PAGE = 50;

interface Log {
  id: number;
  actor_id: string | null;
  action_type: string;
  entity_type: string;
  previous_value: unknown;
  new_value: unknown;
  process_id: string | null;
  created_at: string;
}

const stamp = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(iso)) + " UTC";

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; process?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = safeSearch(sp.q ?? "");
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const rows = await listSubprocesses();
  const processes = new Map(rows.map((r) => [r.processId, r]));
  const filterProcess = [...processes.values()].find((r) => r.processCode === sp.process);

  const supabase = await createClient();
  let query = supabase
    .from("activity_logs")
    .select(ACTIVITY_SELECT)
    .order("id", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE); // one extra row tells us whether there is a next page
  if (q) query = query.or(`action_type.ilike.%${q}%,entity_type.ilike.%${q}%`);
  if (filterProcess) query = query.eq("process_id", filterProcess.processId);
  const { data, error } = await query.returns<Log[]>();
  if (error) throw new Error("Could not load activity.");
  const logs = data.slice(0, PAGE);
  const hasNext = data.length > PAGE;
  const names = await resolveNames(logs.map((l) => l.actor_id));
  const params = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (sp.process) u.set("process", sp.process);
    u.set("page", String(p));
    return `/activity?${u}`;
  };

  return (
    <main className="stack-lg">
      <h1>Activity history</h1>
      <p className="muted">
        A permanent record of changes in the processes you can access. Entries cannot be edited or
        deleted.
      </p>
      <form method="get" className="filters" role="search">
        <label>
          <span>Search action</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="e.g. status, review, document"
          />
        </label>
        <label>
          <span>Process</span>
          <select name="process" defaultValue={sp.process ?? ""}>
            <option value="">All processes</option>
            {[...new Map([...processes.values()].map((r) => [r.processCode, r.processTitle]))].map(
              ([code, title]) => (
                <option key={code} value={code}>
                  {code} {title}
                </option>
              ),
            )}
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>
      {logs.length === 0 ? (
        <EmptyState>No activity matches.</EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Process</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => {
              const proc = l.process_id ? processes.get(l.process_id) : undefined;
              return (
                <tr key={l.id}>
                  <td>{stamp(l.created_at)}</td>
                  <td>{l.actor_id ? (names.get(l.actor_id) ?? "A team member") : "System"}</td>
                  <td>{actionLabel(l.action_type)}</td>
                  <td>
                    {proc ? (
                      <Link href={`/processes/${proc.processCode}`}>{proc.processCode}</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{describeChange(l.previous_value, l.new_value)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <nav aria-label="Pages" className="inline-form">
        {page > 1 && <Link href={params(page - 1)}>← Newer</Link>}
        {hasNext && <Link href={params(page + 1)}>Older →</Link>}
      </nav>
    </main>
  );
}
