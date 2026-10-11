import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** The file's bytes for the administrator's sync (the browser saves them to the chosen folder). */
export async function GET(_: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const id = z
    .string()
    .uuid()
    .safeParse((await params).versionId);
  const notFound = () => new NextResponse("Not found", { status: 404 });
  if (!id.success) return notFound();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse("Sign in first.", { status: 401 });
  const { data: admin } = await supabase.rpc("has_role", { p_role: "system_admin" });
  if (admin !== true) return notFound();

  const { data: version } = await supabase
    .from("document_versions")
    .select("storage_path")
    .eq("id", id.data)
    .maybeSingle();
  if (!version) return notFound();
  const { error: logError } = await supabase.rpc("log_document_download", { p_version: id.data });
  if (logError) return notFound();
  const file = await createAdminClient().storage.from("documents").download(version.storage_path);
  if (file.error || !file.data)
    return new NextResponse("The file is unavailable.", { status: 500 });
  return new Response(file.data, {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" },
  });
}
