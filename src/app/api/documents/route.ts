import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { MAX_FILE_BYTES, validateUpload } from "@/lib/files";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

/** Uploads a Word/Excel file as a new document or a new version of an existing one. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Sign in first.", 401);

  const form = await request.formData().catch(() => null);
  if (!form) return fail("Invalid upload.", 400);
  const fields = z
    .object({
      sub: z.string().uuid(),
      document: z.string().uuid().optional(),
      reviewPoint: z.string().uuid().optional(),
      note: z.string().trim().max(500).optional(),
    })
    .safeParse({
      sub: form.get("sub"),
      document: form.get("document") || undefined,
      reviewPoint: form.get("reviewPoint") || undefined,
      note: form.get("note") || undefined,
    });
  const file = form.get("file");
  if (!fields.success || !(file instanceof File)) return fail("Choose a file to upload.", 400);
  if (file.size > MAX_FILE_BYTES) return fail("The file is larger than 2 MB.", 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = validateUpload(file.name, file.type, bytes);
  if (!checked.ok) return fail(checked.error, 400);

  // Check permission before anything is stored. Missing and forbidden look the same.
  const { data: sub } = await supabase
    .from("subprocesses")
    .select("process_id")
    .eq("id", fields.data.sub)
    .maybeSingle();
  const { data: allowed } = sub
    ? await supabase.rpc("has_assignment", { p_process: sub.process_id })
    : { data: false };
  if (!allowed) return fail("You are not allowed to upload here.", 403);

  const path = `${fields.data.sub}/${randomUUID()}-${checked.safeName}`;
  const admin = createAdminClient();
  const stored = await admin.storage.from("documents").upload(path, bytes, {
    contentType: checked.mime,
    upsert: false,
  });
  if (stored.error) return fail("The file could not be stored.", 500);

  const { error } = await supabase.rpc("register_document_version", {
    p_sub: fields.data.sub,
    p_rp: fields.data.reviewPoint ?? null,
    p_document: fields.data.document ?? null,
    p_filename: checked.safeName,
    p_storage_path: path,
    p_size: bytes.length,
    p_mime: checked.mime,
    p_note: fields.data.note ?? null,
  });
  if (error) {
    // Do not leave an unregistered file behind.
    await admin.storage.from("documents").remove([path]);
    return fail(
      /Not authorized/i.test(error.message)
        ? "You are not allowed to upload here."
        : "The file could not be saved.",
      400,
    );
  }
  return NextResponse.json({ ok: true });
}
