import "server-only";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { FormState } from "@/app/actions";
import { getPersona } from "@/lib/demo";
import { pushPendingNotifications } from "@/lib/push";
import { createClient } from "@/lib/supabase/server";

/** Turns a database rejection into a short message without exposing internals. */
export function friendly(message: string | undefined, code?: string): string {
  if (!message) return "Something went wrong.";
  if (/Not authorized/i.test(message)) return "You are not allowed to do that.";
  // A feature whose database update (migration) has not been run yet.
  if (/schema cache|could not find the function|does not exist/i.test(message)) {
    return "This feature needs a database update that has not been run yet. Tell the administrator.";
  }
  // Workflow rules are written as plain sentences in the database functions.
  if (/^[A-Z][^{}()]{3,160}$/.test(message)) return message;
  // The error code is safe to show and lets the administrator find the cause.
  return code ? `The change could not be saved (error ${code}).` : "The change could not be saved.";
}

export async function rpc(name: string, args: Record<string, unknown>): Promise<FormState> {
  if (await getPersona()) return { error: "Demo mode is read-only. Nothing was changed." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(name, args);
  if (error) return { error: friendly(error.message, error.code) };
  revalidatePath("/", "layout");
  // Workflow notifications the change just created go out as desktop alerts, after the reply.
  after(() => pushPendingNotifications());
  return { message: "Saved." };
}
