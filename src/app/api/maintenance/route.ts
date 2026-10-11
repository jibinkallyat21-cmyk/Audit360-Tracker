import { NextResponse } from "next/server";
import { maintenanceOn } from "@/lib/maintenance";

export const dynamic = "force-dynamic";

/**
 * Polled by open pages. During maintenance the request filter answers anyone who is not an
 * allowed administrator with HTTP 503 before this runs, which tells their page to reload into
 * the maintenance notice. Allowed administrators get a normal answer.
 */
export async function GET() {
  return NextResponse.json(
    { maintenance: await maintenanceOn() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
