/**
 * Maintenance mode. While it is on, everyone sees the "under maintenance" page except the
 * administrators listed below, who can still sign in and work.
 *
 * Switch: the System Administrator turns it on and off at Admin → Maintenance. The state lives in
 * the database (site_settings). If the database cannot be reached, MAINTENANCE_MODE (1 on, 0 off)
 * in Vercel is used, and with no value the default below applies.
 */
const DEFAULT_ON = false;

const fallback = () => {
  const v = process.env.MAINTENANCE_MODE;
  return v === undefined || v === "" ? DEFAULT_ON : v === "1";
};

// Every request asks; a few seconds of memory keeps that to one cheap lookup per instance.
const CACHE_MS = 3_000;
let cached: { at: number; on: boolean } | undefined;

export const maintenanceOn = async (): Promise<boolean> => {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.on;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let on = fallback();
  if (url && key) {
    try {
      const r = await fetch(`${url}/rest/v1/site_settings?id=eq.1&select=maintenance_on`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (r.ok) {
        const rows = (await r.json()) as { maintenance_on: boolean }[];
        if (rows[0]) on = rows[0].maintenance_on;
      }
    } catch {
      // database unreachable: keep the fallback
    }
  }
  cached = { at: Date.now(), on };
  return on;
};

/** Called right after an administrator flips the switch so this instance reflects it at once. */
export const forgetMaintenanceState = () => {
  cached = undefined;
};

/** Comma-separated emails in MAINTENANCE_ALLOWED_EMAILS; defaults to the project administrator. */
export const maintenanceAllowed = (email: string | undefined) => {
  if (!email) return false;
  const list = (process.env.MAINTENANCE_ALLOWED_EMAILS ?? "jibin@analytix.org")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
};

/** Pages anyone may open while in maintenance (the notice itself and the administrator sign-in). */
export const maintenancePublic = (pathname: string) =>
  pathname === "/maintenance" || pathname === "/login" || pathname.startsWith("/maintenance/");
