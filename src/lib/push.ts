import "server-only";
import webpush from "web-push";
import { siteUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Desktop push notifications. The signing keys are made once and kept in the database
 * (`push_keys`, reachable only by the server), so no key has to be set up by hand.
 */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

let cached: { publicKey: string; privateKey: string } | null = null;

async function keys() {
  if (cached) return cached;
  const admin = createAdminClient();
  const read = async () =>
    (await admin.from("push_keys").select("public_key, private_key").eq("id", 1).maybeSingle())
      .data;
  let row = await read();
  if (!row) {
    const fresh = webpush.generateVAPIDKeys();
    // If two requests race, one insert wins and both read the winner.
    await admin
      .from("push_keys")
      .upsert(
        { id: 1, public_key: fresh.publicKey, private_key: fresh.privateKey },
        { onConflict: "id", ignoreDuplicates: true },
      );
    row = await read();
  }
  if (!row) throw new Error("Push keys are unavailable.");
  cached = { publicKey: row.public_key, privateKey: row.private_key };
  return cached;
}

export async function publicKey() {
  return (await keys()).publicKey;
}

/** Sends to every device of the given accounts. Dead subscriptions are removed. Never throws. */
export async function pushToUsers(userIds: string[], message: PushMessage) {
  try {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return;
    const admin = createAdminClient();
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", unique)
      .returns<{ id: string; endpoint: string; p256dh: string; auth: string }[]>();
    if (!subs || subs.length === 0) return;
    const k = await keys();
    const details = {
      vapidDetails: { subject: siteUrl(), publicKey: k.publicKey, privateKey: k.privateKey },
    };
    const payload = JSON.stringify(message);
    const dead: string[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { ...details, TTL: 3600 },
          );
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) dead.push(s.id);
        }
      }),
    );
    if (dead.length > 0) await admin.from("push_subscriptions").delete().in("id", dead);
  } catch {
    // A failed notification must never break the action that caused it.
  }
}

/** Pushes workflow notifications created in the last few minutes that have not been sent yet. */
export async function pushPendingNotifications() {
  try {
    const admin = createAdminClient();
    // Claim first, then send, so overlapping calls never send the same notification twice.
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { data } = await admin
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .is("pushed_at", null)
      .gt("created_at", since)
      .select("recipient_user_id, message, subprocesses(processes(process_code))")
      .returns<
        {
          recipient_user_id: string;
          message: string;
          subprocesses: { processes: { process_code: string } } | null;
        }[]
      >();
    for (const n of data ?? []) {
      const code = n.subprocesses?.processes.process_code;
      await pushToUsers([n.recipient_user_id], {
        title: "Audit 360 Tracker",
        body: n.message,
        url: code ? `/processes/${code}` : "/notifications",
        tag: "notification",
      });
    }
  } catch {
    // ignore
  }
}
