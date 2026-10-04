import "server-only";
import { revalidatePath } from "next/cache";
import type { FormState } from "@/app/actions";
import { createClient } from "@/lib/supabase/server";

/** Turns a database rejection into a short message without exposing internals. */
export function friendly(message: string | undefined): string {
  if (!message) return "Something went wrong.";
  if (/Not authorized/i.test(message)) return "You are not allowed to do that.";
  // Workflow rules are written as plain sentences in the database functions.
  if (/^[A-Z][^{}()]{3,160}$/.test(message)) return message;
  return "The change could not be saved.";
}

export async function rpc(name: string, args: Record<string, unknown>): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(name, args);
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { message: "Saved." };
}
