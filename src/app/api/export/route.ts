import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createExportStream, TABLES, type ExportSource } from "@/lib/export/build";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const PAGE = 1000;

/**
 * Streams the project archive. Allowed only for the administrator, and only for an export the
 * Project Head has approved. The data is read with the service role because the archive must be
 * complete, so the permission checks here come first and are the only gate.
 */
export async function POST(request: NextRequest) {
  const deny = (status: number, msg: string) => new NextResponse(msg, { status });

  // Cross-site form posts are refused.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.nextUrl.host) return deny(403, "Forbidden.");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return deny(401, "Sign in first.");

  const form = await request.formData().catch(() => null);
  const id = z.string().uuid().safeParse(form?.get("request"));
  if (!id.success) return deny(400, "Invalid request.");

  const { data: isAdmin } = await supabase.rpc("has_role", { p_role: "system_admin" });
  if (!isAdmin) return deny(403, "Only the administrator can run an export.");
  const { data: req } = await supabase
    .from("export_requests")
    .select("id, status")
    .eq("id", id.data)
    .maybeSingle();
  if (!req || req.status !== "approved") return deny(403, "This export has not been approved.");

  const admin = createAdminClient();
  const source: ExportSource = {
    requestId: req.id,
    generatedAt: new Date(),
    async fetchTable(name) {
      const table = TABLES.find((t) => t.name === name);
      if (!table) throw new Error("Unknown table.");
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from(name)
          .select(table.columns.join(","))
          .order(table.columns[0])
          .range(from, from + PAGE - 1)
          .returns<Record<string, unknown>[]>();
        if (error) throw new Error(`Could not read ${name}.`);
        rows.push(...data);
        if (data.length < PAGE) return rows;
      }
    },
    async downloadFile(path) {
      const { data, error } = await admin.storage.from("documents").download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async onGathered(files, missing) {
      // Marks the approval as used and logs the export. If this fails the archive is abandoned
      // and the approval stays available for another attempt.
      const { error } = await supabase.rpc("record_export_run", {
        p_id: req.id,
        p_files: files,
        p_missing: missing,
      });
      if (error) throw new Error("Could not record the export.");
    },
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(createExportStream(source), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="tracker-export-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
