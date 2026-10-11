import { NextResponse } from "next/server";
import { Zip, ZipPassThrough } from "fflate";
import { toCsv } from "@/lib/export/csv";
import { zipEntryPath } from "@/lib/files";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Version {
  id: string;
  document_id: string;
  version_number: number;
  original_filename: string;
  storage_path: string;
  uploaded_at: string;
}

/**
 * One ZIP with the current version of every document the signed-in person may see, grouped by
 * process and step. Access is decided by the same row-level rules as the Documents page, so
 * nobody gets a file they could not open one by one. Every file is logged as a download.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse("Sign in first.", { status: 401 });

  const [versions, docs, subs] = await Promise.all([
    supabase
      .from("document_versions")
      .select("id, document_id, version_number, original_filename, storage_path, uploaded_at")
      .eq("is_current", true)
      .returns<Version[]>(),
    supabase
      .from("documents")
      .select("id, subprocess_id")
      .returns<{ id: string; subprocess_id: string }[]>(),
    supabase
      .from("subprocesses")
      .select("id, seq, processes(process_code)")
      .returns<{ id: string; seq: number; processes: { process_code: string } }[]>(),
  ]);
  if (versions.error || docs.error || subs.error) {
    return new NextResponse("The documents could not be loaded.", { status: 500 });
  }
  if (versions.data.length === 0)
    return new NextResponse("No documents to download.", { status: 404 });

  const subOf = new Map(docs.data.map((d) => [d.id, d.subprocess_id]));
  const where = new Map(
    subs.data.map((s) => [s.id, { code: s.processes.process_code, seq: s.seq }]),
  );
  const sorted = [...versions.data].sort((a, b) => {
    const wa = where.get(subOf.get(a.document_id) ?? "");
    const wb = where.get(subOf.get(b.document_id) ?? "");
    return (
      (wa?.code ?? "").localeCompare(wb?.code ?? "", undefined, { numeric: true }) ||
      (wa?.seq ?? 0) - (wb?.seq ?? 0) ||
      a.original_filename.localeCompare(b.original_filename)
    );
  });

  const admin = createAdminClient();
  const taken = new Set<string>();
  const manifest: Record<string, unknown>[] = [];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) return controller.error(err);
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      const add = (path: string, data: Uint8Array) => {
        const entry = new ZipPassThrough(path);
        zip.add(entry);
        entry.push(data, true);
      };
      try {
        for (const v of sorted) {
          const at = where.get(subOf.get(v.document_id) ?? "");
          const path = zipEntryPath(
            at?.code ?? "unknown",
            at?.seq ?? 0,
            v.original_filename,
            taken,
          );
          const { error: logError } = await supabase.rpc("log_document_download", {
            p_version: v.id,
          });
          const file = logError
            ? null
            : await admin.storage.from("documents").download(v.storage_path);
          const bytes = file?.data ? new Uint8Array(await file.data.arrayBuffer()) : null;
          if (bytes) add(path, bytes);
          manifest.push({
            process: at?.code ?? "",
            step: at?.seq ?? "",
            file: v.original_filename,
            version: v.version_number,
            uploaded_at: v.uploaded_at,
            included: bytes ? "yes" : "no (file not found)",
            path: bytes ? path : "",
          });
        }
        add(
          "MANIFEST.csv",
          new TextEncoder().encode(
            toCsv(
              ["process", "step", "file", "version", "uploaded_at", "included", "path"],
              manifest,
            ),
          ),
        );
        zip.end();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="audit360-documents-${stamp}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
