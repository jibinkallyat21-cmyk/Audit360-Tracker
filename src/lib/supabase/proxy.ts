import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { maintenanceAllowed, maintenanceOn, maintenancePublic } from "@/lib/maintenance";
import { publicEnv } from "@/lib/env";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth/confirm",
  "/auth/continue",
];

// The design style guide is reachable without signing in only when ENABLE_STYLEGUIDE=1 (local checks).
const STYLEGUIDE = process.env.ENABLE_STYLEGUIDE === "1" ? ["/styleguide"] : [];

export function isPublicPath(pathname: string) {
  return [...PUBLIC_PATHS, ...STYLEGUIDE].some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/** Refreshes the session cookie and sends signed-out visitors to /login. */
export async function updateSession(request: NextRequest) {
  const maintenance = maintenanceOn();
  // The notice page itself never needs a session check.
  if (maintenance && request.nextUrl.pathname.startsWith("/maintenance")) {
    return NextResponse.next({ request });
  }
  let response = NextResponse.next({ request });
  const { url, anonKey } = publicEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  // Maintenance: everyone except the listed administrators sees the notice (HTTP 503).
  if (
    maintenance &&
    !maintenanceAllowed(data?.claims?.email as string | undefined) &&
    !maintenancePublic(request.nextUrl.pathname)
  ) {
    return NextResponse.rewrite(new URL("/maintenance", request.url), { status: 503 });
  }

  if (!signedIn && !isPublicPath(request.nextUrl.pathname)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }
  return response;
}
