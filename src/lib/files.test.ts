import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, sanitizeFilename, validateUpload } from "./files";

const enc = (s: string) => new TextEncoder().encode(s);
const zip = (...names: string[]) =>
  Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...enc(names.join("\0"))]);
const ole = () => Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3]);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("validateUpload", () => {
  it("accepts well-formed docx, xlsx, doc and xls", () => {
    expect(validateUpload("a.docx", DOCX, zip("[Content_Types].xml", "word/document.xml")).ok).toBe(
      true,
    );
    expect(validateUpload("a.XLSX", "", zip("[Content_Types].xml", "xl/workbook.xml")).ok).toBe(
      true,
    );
    expect(validateUpload("a.doc", "application/msword", ole()).ok).toBe(true);
    expect(validateUpload("a.xls", "application/octet-stream", ole()).ok).toBe(true);
  });

  it("stores the type decided by the server, not the one claimed", () => {
    const r = validateUpload(
      "a.docx",
      "application/octet-stream",
      zip("[Content_Types].xml", "word/x"),
    );
    expect(r).toMatchObject({ ok: true, mime: DOCX });
  });

  it("rejects other extensions and mismatched declared types", () => {
    for (const n of ["a.pdf", "a.exe", "a.docm", "a.xlsm", "a", "a.docx.exe"]) {
      expect(validateUpload(n, "", ole()).ok, n).toBe(false);
    }
    expect(
      validateUpload("a.docx", "application/pdf", zip("[Content_Types].xml", "word/")).ok,
    ).toBe(false);
  });

  it("rejects wrong or missing signatures even with a good name", () => {
    expect(validateUpload("a.docx", DOCX, enc("MZ this is an exe")).ok).toBe(false);
    expect(validateUpload("a.doc", "", zip("[Content_Types].xml", "word/")).ok).toBe(false);
    expect(validateUpload("a.xlsx", "", zip("[Content_Types].xml", "word/")).ok).toBe(false); // a docx renamed
    expect(validateUpload("a.docx", "", zip("word/")).ok).toBe(false); // zip without content types
  });

  it("rejects macro content, empty files and files over 2 MB", () => {
    expect(
      validateUpload("a.docx", "", zip("[Content_Types].xml", "word/", "word/vbaProject.bin")).ok,
    ).toBe(false);
    expect(validateUpload("a.docx", "", new Uint8Array()).ok).toBe(false);
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(zip("[Content_Types].xml", "word/"));
    expect(validateUpload("a.docx", "", big)).toEqual({
      ok: false,
      error: "The file is larger than 2 MB.",
    });
    const edge = new Uint8Array(MAX_FILE_BYTES);
    edge.set(zip("[Content_Types].xml", "word/"));
    expect(validateUpload("a.docx", "", edge).ok).toBe(true);
  });
});

describe("sanitizeFilename", () => {
  it("removes paths and unsafe characters", () => {
    expect(sanitizeFilename("../../etc/passwd.docx")).toBe("passwd.docx");
    expect(sanitizeFilename("C:\\x\\y z.docx")).toBe("y z.docx");
    expect(sanitizeFilename("a<b>|c.xlsx")).toBe("a_b__c.xlsx");
  });
});
