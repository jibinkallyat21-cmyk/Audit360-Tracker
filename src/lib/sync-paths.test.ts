import { describe, expect, it } from "vitest";
import { syncEntryPath } from "./sync-paths";

const base = { code: "3.5", title: "Substantive Procedures & KSA", seq: 1, hasLines: true };

describe("syncEntryPath", () => {
  it("files a document under process, step and line", () => {
    expect(
      syncEntryPath({ ...base, line: "EOSB", filename: "eosb.xlsx", version: 1 }, new Set()),
    ).toEqual(["3.5 Substantive Procedures _ KSA", "Step 1", "EOSB", "eosb.xlsx"]);
  });
  it("uses General for an unfiled document on a step with lines, and no third folder otherwise", () => {
    expect(
      syncEntryPath({ ...base, line: null, filename: "a.docx", version: 1 }, new Set()).slice(-2),
    ).toEqual(["General", "a.docx"]);
    expect(
      syncEntryPath(
        { ...base, hasLines: false, line: null, filename: "a.docx", version: 1 },
        new Set(),
      ),
    ).toHaveLength(3);
  });
  it("keeps every version as its own file and numbers repeated names", () => {
    const taken = new Set<string>();
    const v1 = syncEntryPath({ ...base, line: "GOSI", filename: "g.xlsx", version: 1 }, taken);
    const v2 = syncEntryPath({ ...base, line: "GOSI", filename: "g.xlsx", version: 2 }, taken);
    const other = syncEntryPath({ ...base, line: "GOSI", filename: "G.xlsx", version: 1 }, taken);
    expect(v1.at(-1)).toBe("g.xlsx");
    expect(v2.at(-1)).toBe("g (v2).xlsx");
    expect(other.at(-1)).toBe("G (2).xlsx");
  });
  it("never lets a name climb out of its folder", () => {
    expect(
      syncEntryPath({ ...base, line: null, filename: "../../x.docx", version: 1 }, new Set()).at(
        -1,
      ),
    ).toBe("x.docx");
  });
});
