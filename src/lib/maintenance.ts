/**
 * Maintenance mode. While it is on, everyone sees the "under maintenance" page except the
 * administrators listed below, who can still sign in and work.
 *
 * Switch: set MAINTENANCE_MODE=1 (on) or MAINTENANCE_MODE=0 (off) in Vercel.
 * With no value set, the default below applies.
 */
const DEFAULT_ON = true;

export const maintenanceOn = () => {
  const v = process.env.MAINTENANCE_MODE;
  return v === undefined || v === "" ? DEFAULT_ON : v === "1";
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
