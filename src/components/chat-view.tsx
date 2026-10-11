"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  id: number;
  sender_id: string | null;
  body: string;
  created_at: string;
}

const POLL_MS = 4000;

const clock = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );

/** One open conversation: the messages, kept fresh every few seconds, and the box to write in. */
export function ChatView({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [me, setMe] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/chat/messages?c=${conversationId}&after=${last.current}`, {
        cache: "no-store",
      });
      if (res.status === 503) return window.location.reload();
      if (!res.ok) return;
      const data = (await res.json()) as {
        me: string;
        names: Record<string, string>;
        messages: Message[];
      };
      setMe(data.me);
      setLoaded(true);
      if (data.messages.length > 0) {
        last.current = data.messages[data.messages.length - 1].id;
        setNames((n) => ({ ...n, ...data.names }));
        setMessages((m) => [...m, ...data.messages.filter((x) => !m.some((y) => y.id === x.id))]);
      }
    } catch {
      // a brief network problem: the next tick tries again
    }
  }, [conversationId]);

  useEffect(() => {
    // Defer the first fetch so the effect itself does not set state synchronously.
    const first = window.setTimeout(load, 0);
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [load]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ c: conversationId, body }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "The message was not sent.");
        return;
      }
      setText("");
      stick.current = true;
      await load();
    } catch {
      setError("The message was not sent. Check your connection.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-view">
      <div
        className="chat-messages"
        ref={box}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {loaded && messages.length === 0 && (
          <p className="muted chat-empty">No messages yet. Say hello.</p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === me;
          return (
            <div key={m.id} className={mine ? "bubble mine" : "bubble"}>
              <p className="bubble-meta">
                <strong>{mine ? "You" : (names[m.sender_id ?? ""] ?? "Former member")}</strong> ·{" "}
                {clock(m.created_at)}
              </p>
              <p className="pre">{m.body}</p>
            </div>
          );
        })}
      </div>
      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Write a message (Enter to send, Shift+Enter for a new line)"
          aria-label="Message"
        />
        <button type="submit" disabled={sending || text.trim().length === 0}>
          {sending ? "Sending…" : "Send"}
        </button>
        {error && (
          <span role="alert" className="error">
            {error}
          </span>
        )}
      </form>
    </div>
  );
}
