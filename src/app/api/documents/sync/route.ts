import { NextResponse } from "next/server";
import { syncEntryPath } from "@/lib/sync-paths";
import { withoutLineId } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Doc {
  id: string;
  subprocess_id: string;
  line_id?: string | null;
  removed_at?: string | null;
}

/**
 * Every stored version with the folder path it belongs in, for the administrator's "save to my
 * computer" sync. Only the System Administrator may call it; the folder names are built here so
 * the browser never invents a path.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse("Sign in first.", { status: 401 });
  const { data: admin } = await supabase.rpc("has_role", { p_role: "system_admin" });
  if (admin !== true) return new NextResponse("Not found", { status: 404 });

  const docSelect = "id, subprocess_id, line_id, removed_at";
  let docs = await supabase.from("documents").select(docSelect).returns<Doc[]>();
  if (docs.error)
    docs = await supabase.from("documents").select(withoutLineId(docSelect)).returns<Doc[]>();
  const [versions, subs, lines] = await Promise.all([
    supabase
      .from("document_versions")
      .select("id, document_id, version_number, original_filename, uploaded_at")
      .order("uploaded_at")
      .returns<
        {
          id: string;
          document_id: string;
          version_number: number;
          original_filename: string;
          uploaded_at: string;
        }[]
      >(),
    supabase
      .from("subprocesses")
      .select("id, seq, processes(process_code, title)")
      .returns<{ id: string; seq: number; processes: { process_code: string; title: string } }[]>(),
    supabase
      .from("subprocess_lines")
      .select("id, subprocess_id, title")
      .returns<{ id: string; subprocess_id: string; title: string }[]>(),
  ]);
  if (docs.error || versions.error || subs.error) {
    return new NextResponse("The documents could not be loaded.", { status: 500 });
  }
  const lineList = lines.error ? [] : lines.data;
  const docOf = new Map(docs.data.filter((d) => !d.removed_at).map((d) => [d.id, d]));
  const subOf = new Map(subs.data.map((s) => [s.id, s]));
  const lineTitle = new Map(lineList.map((l) => [l.id, l.title]));
  const hasLines = new Set(lineList.map((l) => l.subprocess_id));

  const taken = new Set<string>();
  const files = versions.data.flatMap((v) => {
    const d = docOf.get(v.document_id);
    const s = d ? subOf.get(d.subprocess_id) : undefined;
    if (!d || !s) return [];
    return [
      {
        id: v.id,
        uploadedAt: v.uploaded_at,
        path: syncEntryPath(
          {
            code: s.processes.process_code,
            title: s.processes.title,
            seq: s.seq,
            line: d.line_id ? (lineTitle.get(d.line_id) ?? null) : null,
            hasLines: hasLines.has(s.id),
            filename: v.original_filename,
            version: v.version_number,
          },
          taken,
        ),
      },
    ];
  });
  return NextResponse.json({ files }, { headers: { "Cache-Control": "no-store" } });
}
