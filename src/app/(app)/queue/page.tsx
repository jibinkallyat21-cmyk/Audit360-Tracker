import Link from "next/link";
import { EmptyState, PageHero } from "@/components/ui";
import { getCapabilities, listSubprocesses } from "@/lib/data";
import { buildQueue } from "@/lib/queue";

const ago = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day" : `${days} days`;
};

/** What needs the signed-in person now, across every process they work on or review. */
export default async function QueuePage() {
  const [rows, caps] = await Promise.all([listSubprocesses(), getCapabilities()]);
  const sections = buildQueue(rows, caps);
  return (
    <main className="stack-lg">
      <PageHero eyebrow="My queue" title="What needs you">
        Everything waiting on you, oldest first. It updates as work moves.
      </PageHero>
      {sections.length === 0 && (
        <section className="panel">
          <EmptyState>Nothing needs you right now.</EmptyState>
        </section>
      )}
      {sections.map((s) => (
        <section key={s.key} className="panel">
          <h2>
            {s.title} ({s.items.length})
          </h2>
          <p className="muted">{s.hint}</p>
          <ul className="items">
            {s.items.map((i) => (
              <li key={i.key}>
                <Link href={`/processes/${i.code}`} className="item-main">
                  <span className="dot" aria-hidden="true" />
                  <strong className="mono">{i.code}</strong>
                  <span className="item-title">
                    {i.processTitle} · step {i.step}
                    {i.line ? ` · ${i.line}` : ""}
                  </span>
                </Link>
                <span className="item-meta muted">
                  {s.key === "quiet" ? `quiet for ${ago(i.since)}` : `waiting ${ago(i.since)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
