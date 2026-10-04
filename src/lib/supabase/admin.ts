import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Service-role client. It bypasses row-level security, so it is used only after the
 * caller's own permission has been checked, and only for storage operations.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(publicEnv().url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
