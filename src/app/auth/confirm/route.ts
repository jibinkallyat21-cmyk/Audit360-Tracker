import { NextResponse, type NextRequest } from "next/server";

/**
 * Entry point of every email link (invite, confirm signup, reset password).
 *
 * It does NOT use up the link. Mail scanners and chat apps (Outlook, Teams) fetch links to make a
 * preview, and a single-use link would be spent before the person clicks it. So this only passes
 * the link on to a page where the person presses a button; that button uses the link.
 */
export function GET(request: NextRequest) {
  const url = new URL("/auth/continue", request.url);
  for (const key of ["token_hash", "type", "next"]) {
    const v = request.nextUrl.searchParams.get(key);
    if (v) url.searchParams.set(key, v);
  }
  return NextResponse.redirect(url);
}
