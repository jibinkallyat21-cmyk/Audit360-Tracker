export const MAX_FILE_BYTES = 2 * 1024 * 1024;

const MIME_BY_EXT = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
type Ext = keyof typeof MIME_BY_EXT;

export interface ValidUpload {
  ok: true;
  ext: Ext;
  mime: string;
  safeName: string;
}
export interface InvalidUpload {
  ok: false;
  error: string;
}

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** True if the ASCII text appears anywhere in the bytes (used on ZIP entry names). */
function contains(b: Uint8Array, text: string): boolean {
  const t = Array.from(text, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= b.length - t.length; i++) {
    for (let j = 0; j < t.length; j++) if (b[i + j] !== t[j]) continue outer;
    return true;
  }
  return false;
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/\.{2,}/g, ".")
    .trim();
  return cleaned.slice(-120) || "file";
}

/**
 * Server-side check of an upload: size, extension, declared type and file signature.
 * Client-side checks are only a convenience and are never trusted.
 */
export function validateUpload(
  filename: string,
  declaredType: string,
  bytes: Uint8Array,
): ValidUpload | InvalidUpload {
  if (bytes.length === 0) return { ok: false, error: "The file is empty." };
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: "The file is larger than 2 MB." };

  const ext = (/\.([A-Za-z0-9]+)$/.exec(filename)?.[1] ?? "").toLowerCase();
  if (!(ext in MIME_BY_EXT)) {
    return {
      ok: false,
      error: "Only Word (.doc, .docx) and Excel (.xls, .xlsx) files are allowed.",
    };
  }
  const e = ext as Ext;
  const expected = MIME_BY_EXT[e];
  const declared = declaredType.split(";")[0].trim().toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== expected) {
    return { ok: false, error: "The file type does not match its extension." };
  }

  if (e === "doc" || e === "xls") {
    if (!startsWith(bytes, OLE))
      return { ok: false, error: "The file content is not a valid Office document." };
  } else {
    if (!startsWith(bytes, ZIP) || !contains(bytes, "[Content_Types].xml")) {
      return { ok: false, error: "The file content is not a valid Office document." };
    }
    if (!contains(bytes, e === "docx" ? "word/" : "xl/")) {
      return { ok: false, error: "The file content does not match its extension." };
    }
    // Macro-enabled content is not accepted in files named as plain documents.
    if (contains(bytes, "vbaProject.bin")) {
      return { ok: false, error: "Files containing macros are not allowed." };
    }
  }
  return { ok: true, ext: e, mime: expected, safeName: sanitizeFilename(filename) };
}
