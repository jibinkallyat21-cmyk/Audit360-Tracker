import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Authenticated download. Access is decided by the same row-level rules as the records;
 * the browser then gets a signed link that expires in one minute, never a permanent URL.
 */
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

  const { data: version } = await supabase
    .from("document_versions")
    .select("storage_path, original_filename")
    .eq("id", id.data)
    .maybeSingle();
  if (!version) return notFound();

  const { error: logError } = await supabase.rpc("log_document_download", { p_version: id.data });
  if (logError) return notFound();

  const { data: signed } = await createAdminClient()
    .storage.from("documents")
    .createSignedUrl(version.storage_path, 60, { download: version.original_filename });
  if (!signed) return new NextResponse("The file is unavailable.", { status: 500 });
  return NextResponse.redirect(signed.signedUrl, 302);
}
