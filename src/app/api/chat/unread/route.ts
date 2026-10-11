import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Number of unread chat messages for the sidebar badge. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data } = await supabase.rpc("chat_unread_total");
  return NextResponse.json(
    { unread: Number(data ?? 0) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
