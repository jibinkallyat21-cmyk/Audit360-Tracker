import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Messages of one conversation after a given id. Row-level security decides who may read. */
export async function GET(request: NextRequest) {
  const parsed = z
    .object({ c: z.string().uuid(), after: z.coerce.number().int().min(0).default(0) })
    .safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", parsed.data.c)
    .gt("id", parsed.data.after)
    .order("id")
    .limit(200)
    .returns<{ id: number; sender_id: string | null; body: string; created_at: string }[]>();
  if (error) return NextResponse.json({ error: "Could not load messages." }, { status: 500 });
  if (data.length > 0) await supabase.rpc("chat_mark_read", { p_conv: parsed.data.c });

  const ids = [...new Set(data.map((m) => m.sender_id).filter((x): x is string => !!x))];
  const names: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: n } = await supabase.rpc("actor_names", { p_ids: ids });
    (n as { profile_id: string; display_name: string }[] | null)?.forEach((r) => {
      names[r.profile_id] = r.display_name;
    });
  }
  return NextResponse.json(
    { me: auth.user.id, names, messages: data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
