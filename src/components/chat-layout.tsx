import Link from "next/link";
import { ChatRefresh } from "./chat-refresh";
import { ChatView } from "./chat-view";
import { EmptyState, PageHero } from "./ui";

export interface ChatRow {
  conversation_id: string;
  kind: "common" | "direct" | "process";
  process_code: string | null;
  process_title: string | null;
  other_user: string | null;
  other_name: string | null;
  last_body: string | null;
  last_at: string | null;
  unread: number | string;
}

const titleOf = (r: ChatRow) =>
  r.kind === "common"
    ? "Everyone"
    : r.kind === "direct"
      ? (r.other_name ?? "A team member")
      : `${r.process_code} ${r.process_title}`;

const KIND_LABEL = { common: "Everyone", direct: "Direct messages", process: "Process groups" };

/** The chat screen: conversation list on the left, the open conversation on the right. */
export function ChatLayout({
  rows,
  current,
  members,
  people,
  error,
  openDirect,
  live = true,
}: {
  rows: ChatRow[];
  current: ChatRow | undefined;
  members: string;
  people: { profile_id: string; display_name: string }[];
  error?: string;
  openDirect: (form: FormData) => void | Promise<void>;
  live?: boolean;
}) {
  return (
    <main className="stack-lg">
      <PageHero eyebrow="Chat" title="Messages">
        Write to everyone, to one person, or to the people working on a process. Direct messages and
        process groups are visible only to the people in them.
      </PageHero>
      {live && <ChatRefresh />}
      {error && (
        <p role="alert" className="error">
          {error === "person" ? "Choose a person." : error}
        </p>
      )}
      <div className="chat">
        <aside className="chat-list" aria-label="Conversations">
          <form action={openDirect} className="chat-new">
            <label className="field">
              <span>New direct message</span>
              <select name="person" required defaultValue="">
                <option value="" disabled>
                  Choose a person…
                </option>
                {people.map((p) => (
                  <option key={p.profile_id} value={p.profile_id}>
                    {p.display_name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="secondary">
              Open
            </button>
          </form>
          {(["common", "direct", "process"] as const).map((kind) => {
            const list = rows.filter((r) => r.kind === kind);
            if (list.length === 0) return null;
            return (
              <section key={kind}>
                <h2>{KIND_LABEL[kind]}</h2>
                <ul className="chat-items">
                  {list.map((r) => {
                    const unread = Number(r.unread);
                    return (
                      <li key={r.conversation_id}>
                        <Link
                          href={`/chat?c=${r.conversation_id}`}
                          aria-current={
                            r.conversation_id === current?.conversation_id ? "page" : undefined
                          }
                        >
                          <span className="chat-item-title">{titleOf(r)}</span>
                          {unread > 0 && (
                            <span className="count">{unread > 99 ? "99+" : unread}</span>
                          )}
                          {r.last_body && <span className="chat-item-last">{r.last_body}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </aside>
        <section className="chat-pane" aria-label="Conversation">
          {current ? (
            <>
              <header className="chat-head">
                <h2>{titleOf(current)}</h2>
                <p className="muted">
                  {current.kind === "common"
                    ? "Everyone with an account can read this."
                    : current.kind === "direct"
                      ? "Only you and this person can read this."
                      : members || "Only the people assigned to this process can read this."}
                </p>
              </header>
              <ChatView key={current.conversation_id} conversationId={current.conversation_id} />
            </>
          ) : (
            <EmptyState>No conversations yet.</EmptyState>
          )}
        </section>
      </div>
    </main>
  );
}
