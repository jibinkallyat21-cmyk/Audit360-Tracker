import { describe, expect, it } from "vitest";
import { parseInvites } from "./invite-parse";

describe("parseInvites", () => {
  it("reads email and name from each line", () => {
    const r = parseInvites(
      "mariajoseph@analytix.org\tMaria\nliyasusan@analytix.org   Liya Susan\n",
    );
    expect(r.entries).toEqual([
      { email: "mariajoseph@analytix.org", name: "Maria" },
      { email: "liyasusan@analytix.org", name: "Liya Susan" },
    ]);
    expect(r.invalid).toEqual([]);
  });
  it("accepts plain lists, commas and duplicates", () => {
    const r = parseInvites("a@x.org, b@x.org; A@x.org\nc@x.org");
    expect(r.entries.map((e) => e.email)).toEqual(["a@x.org", "b@x.org", "c@x.org"]);
    expect(r.entries.every((e) => e.name === "")).toBe(true);
  });
  it("reports only broken emails, not names", () => {
    const r = parseInvites("good@x.org Anna\nbroken@x Ben\njust a name");
    expect(r.entries.map((e) => e.email)).toEqual(["good@x.org"]);
    expect(r.invalid).toEqual(["broken@x"]);
  });
});
