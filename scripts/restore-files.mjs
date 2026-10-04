// Puts document files back into storage from an extracted export archive.
//   node scripts/restore-files.mjs <path-to-extracted-export-folder>
// Uses MANIFEST.csv: each included document row has the original storage_path to restore to.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!dir || !url || !key) {
  console.error(
    "Usage: node scripts/restore-files.mjs <export-folder>  (with Supabase env vars set)",
  );
  process.exit(2);
}

// Minimal RFC 4180 reader (the manifest is written by the export, with quoted fields where needed).
function parseCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1);
}

const [header, ...rows] = parseCsv(
  readFileSync(join(dir, "MANIFEST.csv"), "utf8").replace(/^﻿/, ""),
);
const col = (r, n) => r[header.indexOf(n)];
const supabase = createClient(url, key, { auth: { persistSession: false } });

let restored = 0,
  skipped = 0,
  failed = 0;
for (const r of rows) {
  if (col(r, "kind") !== "document" || col(r, "included") !== "yes") {
    skipped++;
    continue;
  }
  const body = readFileSync(join(dir, col(r, "path")));
  const { error } = await supabase.storage
    .from("documents")
    .upload(col(r, "storage_path"), body, { upsert: false });
  if (error && !/already exists|Duplicate/i.test(error.message)) {
    failed++;
    console.error("FAILED", col(r, "path"), error.message);
  } else restored++;
}
console.log(`${restored} restored, ${skipped} skipped, ${failed} failed.`);
process.exit(failed ? 1 : 0);
