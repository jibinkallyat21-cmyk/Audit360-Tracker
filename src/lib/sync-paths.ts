import { sanitizeFilename } from "./files";

const folder = (s: string) =>
  sanitizeFilename(s)
    .slice(0, 60)
    .replace(/[. ]+$/, "") || "folder";

/**
 * Where a file goes on the administrator's computer, as folder names then the file name:
 * process / step / line (when the step has lines) / file. A later version keeps its own file
 * ("name (v2).docx"), so nothing already saved is ever overwritten. Repeated names are numbered.
 */
export function syncEntryPath(
  e: {
    code: string;
    title: string;
    seq: number;
    /** Line the document belongs to, or null. */
    line: string | null;
    /** True when the step has lines, so unfiled documents go to "General". */
    hasLines: boolean;
    filename: string;
    version: number;
  },
  taken: Set<string>,
): string[] {
  const dirs = [`${folder(e.code)} ${folder(e.title)}`.slice(0, 80), `Step ${e.seq}`];
  if (e.line) dirs.push(folder(e.line));
  else if (e.hasLines) dirs.push("General");
  const name = sanitizeFilename(e.filename);
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const withVersion = e.version > 1 ? `${base} (v${e.version})` : base;
  let file = `${withVersion}${ext}`;
  for (let n = 2; taken.has([...dirs, file].join("/").toLowerCase()); n++) {
    file = `${withVersion} (${n})${ext}`;
  }
  taken.add([...dirs, file].join("/").toLowerCase());
  return [...dirs, file];
}
