"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { friendly } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";

/** Opens (or creates) the private conversation with one person, then shows it. */
export async function openDirect(form: FormData) {
  const p = z.object({ person: z.string().uuid() }).safeParse(Object.fromEntries(form));
  if (!p.success) redirect("/chat?error=person");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("chat_open_direct", { p_other: p.data.person });
  if (error || !data) redirect(`/chat?error=${encodeURIComponent(friendly(error?.message))}`);
  redirect(`/chat?c=${data}`);
}
