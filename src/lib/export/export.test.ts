import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createExportStream, sha256, TABLES, writeExport, type ExportSource } from "./build";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("quotes commas, quotes and line breaks, and writes nulls as empty", () => {
    const out = toCsv(["a", "b", "c"], [{ a: 'x,"y"', b: "line\nbreak", c: null }]);
    expect(out).toBe('﻿a,b,c\r\n"x,""y""","line\nbreak",\r\n');
  });
  it("writes dates, booleans and JSON values readably", () => {
    const out = toCsv(
      ["d", "b", "j"],
      [{ d: new Date("2030-01-02T03:04:05Z"), b: true, j: { a: 1 } }],
    );
    expect(out).toContain('2030-01-02T03:04:05.000Z,true,"{""a"":1}"');
  });
  it("keeps the header when there are no rows", () => {
    expect(toCsv(["a", "b"], [])).toBe("﻿a,b\r\n");
  });
  it("neutralises formula text but leaves numbers and dates alone", () => {
    const out = toCsv(
      ["v"],
      [
        { v: "=HYPERLINK(1)" },
        { v: "+1+1" },
        { v: "@cmd" },
        { v: "-5" },
        { v: "2030-01-01T00:00:00Z" },
        { v: "-x" },
      ],
    );
    expect(out).toContain("'=HYPERLINK(1)");
    expect(out).toContain("'+1+1");
    expect(out).toContain("'@cmd");
    expect(out).toContain("\r\n-5\r\n");
    expect(out).toContain("2030-01-01T00:00:00Z");
    expect(out).toContain("'-x");
  });
});

const D1 = "11111111-1111-1111-1111-111111111111";
function fakeSource(opts: { missing?: string[] } = {}) {
  const files: Record<string, Uint8Array> = {
    "p/v1": new TextEncoder().encode("first version"),
    "p/v2": new TextEncoder().encode("second version"),
    "p/v3": new TextEncoder().encode("other doc"),
  };
  const tables: Record<string, Record<string, unknown>[]> = {
    processes: [{ id: "P1", process_code: "1.1", title: "Lead, Scoring" }],
    subprocesses: [{ id: "S1", process_id: "P1", seq: 2, title: "Step" }],
    people: [
      { id: "A", display_name: "Rijin" },
      { id: "B", display_name: "Pavithra" },
    ],
    profiles: [{ id: "U1", full_name: "Pavithra K", person_id: "B" }],
    process_assignments: [
      { id: "x", process_id: "P1", person_id: "A", assignment_type: "team_member" },
    ],
    documents: [
      { id: D1, subprocess_id: "S1", original_filename: "plan.docx" },
      { id: "22222222-2", subprocess_id: "S1", original_filename: "b.xlsx" },
    ],
    document_versions: [
      {
        id: "v1",
        document_id: D1,
        version_number: 1,
        original_filename: "plan.docx",
        storage_path: "p/v1",
        is_current: false,
      },
      {
        id: "v2",
        document_id: D1,
        version_number: 2,
        original_filename: "plan.docx",
        storage_path: "p/v2",
        is_current: true,
      },
      {
        id: "v3",
        document_id: "22222222-2",
        version_number: 1,
        original_filename: "../b.xlsx",
        storage_path: "p/v3",
        is_current: true,
      },
    ],
    activity_logs: [
      {
        id: 1,
        actor_id: "U1",
        action_type: "status_changed",
        process_id: "P1",
        subprocess_id: "S1",
        previous_value: { status: "not_started" },
        new_value: { status: "in_progress" },
        created_at: "2030-01-01T00:00:00Z",
      },
      {
        id: 2,
        actor_id: "U1",
        action_type: "deadline_set",
        previous_value: null,
        new_value: "2030-06-01T00:00:00Z",
        created_at: "2030-01-02T00:00:00Z",
      },
      {
        id: 3,
        actor_id: "U1",
        action_type: "comment_added",
        process_id: "P1",
        created_at: "2030-01-03T00:00:00Z",
      },
    ],
  };
  let gathered: [number, number] | null = null;
  const source: ExportSource = {
    requestId: "REQ-1",
    generatedAt: new Date("2030-07-01T00:00:00Z"),
    fetchTable: async (n) => tables[n] ?? [],
    downloadFile: async (p) => (opts.missing?.includes(p) ? null : (files[p] ?? null)),
    onGathered: async (f, m) => {
      gathered = [f, m];
    },
  };
  return { source, files, gathered: () => gathered };
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return unzipSync(out);
}
const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/^﻿/, "");

describe("export archive", () => {
  it("contains every table, every document version, a manifest, checksums and a README", async () => {
    const { source, gathered } = fakeSource();
    const zip = await collect(createExportStream(source));
    for (const t of TABLES) expect(zip[`data/${t.name}.csv`], t.name).toBeDefined();
    expect(Object.keys(zip)).toEqual(
      expect.arrayContaining([
        "documents/1.1/step-2/11111111_v1_plan.docx",
        "documents/1.1/step-2/11111111_v2_plan.docx",
        "MANIFEST.csv",
        "CHECKSUMS.sha256",
        "README.txt",
      ]),
    );
    // Superseded and current versions are both present and byte-identical to the source files.
    expect(text(zip["documents/1.1/step-2/11111111_v1_plan.docx"])).toBe("first version");
    expect(text(zip["documents/1.1/step-2/11111111_v2_plan.docx"])).toBe("second version");
    expect(gathered()).toEqual([3, 0]);
  });

  it("sanitises file names so nothing can escape the folder", async () => {
    const zip = await collect(createExportStream(fakeSource().source));
    const names = Object.keys(zip).filter((n) => n.startsWith("documents/"));
    expect(names.every((n) => !n.includes(".."))).toBe(true);
    expect(names.some((n) => n.endsWith("_v1_b.xlsx"))).toBe(true);
  });

  it("writes a manifest that maps each file to process, document and version, with matching checksums", async () => {
    const zip = await collect(createExportStream(fakeSource().source));
    const manifest = text(zip["MANIFEST.csv"]).trim().split("\r\n");
    const header = manifest[0].split(",");
    const docRow = manifest.find((l) => l.includes("_v2_plan.docx"))!.split(",");
    const get = (k: string) => docRow[header.indexOf(k)];
    expect(get("process_code")).toBe("1.1");
    expect(get("document_id")).toBe(D1);
    expect(get("version_number")).toBe("2");
    expect(get("version_status")).toBe("current");
    expect(get("storage_path")).toBe("p/v2"); // needed to put the file back after a restore
    expect(get("sha256")).toBe(sha256(zip["documents/1.1/step-2/11111111_v2_plan.docx"]));
    // Every line of CHECKSUMS.sha256 matches the real bytes in the archive.
    for (const line of text(zip["CHECKSUMS.sha256"]).trim().split("\n")) {
      const [hash, path] = [line.slice(0, 64), line.slice(66)];
      if (path === "MANIFEST.csv") expect(hash).toBe(sha256(zip["MANIFEST.csv"]));
      else expect(hash, path).toBe(sha256(zip[path]));
    }
  });

  it("never silently drops a version it cannot retrieve", async () => {
    const { source, gathered } = fakeSource({ missing: ["p/v1"] });
    const zip = await collect(createExportStream(source));
    expect(Object.keys(zip).some((n) => n.includes("_v1_plan.docx"))).toBe(false);
    const manifest = text(zip["MANIFEST.csv"]);
    const row = manifest.split("\r\n").find((l) => l.includes("_v1_plan.docx"))!;
    expect(row.endsWith(",no")).toBe(true); // included = no
    expect(gathered()).toEqual([3, 1]);
    expect(text(zip["README.txt"])).toContain("1 could not be retrieved");
  });

  it("writes readable assignment, status-history and countdown summaries", async () => {
    const zip = await collect(createExportStream(fakeSource().source));
    expect(text(zip["data/assignments_readable.csv"])).toContain(
      '1.1,"Lead, Scoring",Rijin,team_member',
    );
    const hist = text(zip["data/status_stage_history.csv"]);
    expect(hist).toContain("Pavithra");
    expect(hist).toContain("not_started");
    expect(hist).not.toContain("comment_added"); // only status/stage changes
    const cd = text(zip["data/countdown_history.csv"]);
    expect(cd).toContain("2030-06-01T00:00:00Z");
  });

  it("aborts, rather than producing a partial archive, if gathering fails", async () => {
    const { source } = fakeSource();
    source.onGathered = async () => {
      throw new Error("boom");
    };
    await expect(collect(createExportStream(source))).rejects.toThrow("boom");
  });

  it("returns counts from writeExport", async () => {
    const out: string[] = [];
    const r = await writeExport(fakeSource().source, (p) => out.push(p));
    expect(r).toEqual({ files: 3, missing: 0 });
    expect(out.at(-1)).toBe("README.txt");
  });
});
