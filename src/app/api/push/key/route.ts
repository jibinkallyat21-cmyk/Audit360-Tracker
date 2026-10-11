import { NextResponse } from "next/server";
import { publicKey } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The public key a browser needs to subscribe to desktop notifications. Signed-in users only. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    return NextResponse.json(
      { key: await publicKey() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "Notifications are not available." }, { status: 503 });
  }
}
