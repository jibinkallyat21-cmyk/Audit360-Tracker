import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { friendly } from "@/lib/rpc";
import { pushToUsers } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Who else is in a conversation, so they can be alerted. Looked up with the service role. */
async function recipients(conversation: string, sender: string) {
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("conversations")
    .select("kind, process_id, user_a, user_b")
    .eq("id", conversation)
    .maybeSingle();
  if (!c) return { ids: [] as string[], label: "" };
  let ids: string[] = [];
  let label = "";
  if (c.kind === "direct") {
    ids = [c.user_a, c.user_b].filter((x): x is string => !!x);
  } else if (c.kind === "process") {
    const [{ data: proc }, { data: people }] = await Promise.all([
      admin.from("processes").select("process_code, title").eq("id", c.process_id).maybeSingle(),
      admin.from("process_assignments").select("person_id").eq("process_id", c.process_id),
    ]);
    label = proc ? `${proc.process_code} ${proc.title}` : "";
    const personIds = [...new Set((people ?? []).map((p) => p.person_id))];
    const { data: profiles } = await admin
      .from("profiles")
      .select("id")
      .in("person_id", personIds)
      .eq("approval_state", "approved")
      .eq("is_active", true);
    ids = (profiles ?? []).map((p) => p.id);
    // The administrator, Project Lead and Project Head are in every process group.
    const { data: overseers } = await admin
      .from("person_roles")
      .select("person_id, roles!inner(name)")
      .in("roles.name", ["system_admin", "project_lead", "project_head"]);
    const overseerPeople = [...new Set((overseers ?? []).map((r) => r.person_id))];
    if (overseerPeople.length > 0) {
      const { data: extra } = await admin
        .from("profiles")
        .select("id")
        .in("person_id", overseerPeople)
        .eq("approval_state", "approved")
        .eq("is_active", true);
      ids = [...new Set([...ids, ...(extra ?? []).map((p) => p.id)])];
    }
  } else {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id")
      .eq("approval_state", "approved")
      .eq("is_active", true);
    ids = (profiles ?? []).map((p) => p.id);
    label = "Everyone";
  }
  return { ids: ids.filter((id) => id !== sender), label, kind: c.kind };
}

/** Sends a chat message, then alerts the other people in that conversation on their desktop. */
export async function POST(request: NextRequest) {
  const parsed = z
    .object({ c: z.string().uuid(), body: z.string().trim().min(1, "Write a message.").max(4000) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid message." },
      { status: 400 },
    );
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data: id, error } = await supabase.rpc("chat_send", {
    p_conv: parsed.data.c,
    p_body: parsed.data.body,
  });
  if (error) return NextResponse.json({ error: friendly(error.message) }, { status: 400 });

  const { data: me } = await supabase.rpc("actor_names", { p_ids: [auth.user.id] });
  const sender = (me as { display_name: string }[] | null)?.[0]?.display_name ?? "Someone";
  const preview =
    parsed.data.body.length > 140 ? parsed.data.body.slice(0, 137) + "…" : parsed.data.body;
  after(async () => {
    const r = await recipients(parsed.data.c, auth.user.id);
    await pushToUsers(r.ids, {
      title: r.label ? `${sender} in ${r.label}` : sender,
      body: preview,
      url: `/chat?c=${parsed.data.c}`,
      tag: `chat-${parsed.data.c}`,
    });
  });
  return NextResponse.json({ ok: true, id });
}
