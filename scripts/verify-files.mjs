// Checks that every document version in the database still has its file in storage.
// Run after a restore or before decommissioning:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/verify-files.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await supabase.from("document_versions").select("id, storage_path");
if (error) throw error;

const missing = [];
for (const v of data) {
  const slash = v.storage_path.lastIndexOf("/");
  const dir = v.storage_path.slice(0, slash);
  const name = v.storage_path.slice(slash + 1);
  const { data: found, error: e } = await supabase.storage
    .from("documents")
    .list(dir, { search: name, limit: 100 });
  if (e || !found?.some((f) => f.name === name)) missing.push(v);
}
console.log(`${data.length} versions checked, ${missing.length} missing.`);
for (const v of missing) console.log(`MISSING ${v.id} ${v.storage_path}`);
process.exit(missing.length ? 1 : 0);
