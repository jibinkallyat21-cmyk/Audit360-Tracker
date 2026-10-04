import { describe, expect, it } from "vitest";
import { suggestPersons, type PersonLite } from "./matching";

const p = (displayName: string, linked = false): PersonLite => ({
  id: displayName,
  displayName,
  firstName: displayName.split(" ")[0],
  linked,
});
const people = [
  "Rijin",
  "Anna",
  "Ananthakrishan",
  "Jibin K K",
  "Shon J Iype",
  "Shon Domnic",
  "Jismy",
  "Devika T G",
  "Mohammed Ali",
  "Pavithra",
  "Syam",
].map((n) => p(n));

const names = (r: ReturnType<typeof suggestPersons>) =>
  r.candidates.map((c) => c.person.displayName);

describe("suggestPersons", () => {
  it("matches a first name in the email", () => {
    const r = suggestPersons("rijin.k@company.com", null, people);
    expect(r.status).toBe("single");
    expect(r.suggested?.displayName).toBe("Rijin");
  });

  it("accepts near matches: joined initials, digits, a typo", () => {
    expect(suggestPersons("jibinkk@company.com", null, people).suggested?.displayName).toBe(
      "Jibin K K",
    );
    expect(suggestPersons("pavithra2024@company.com", null, people).suggested?.displayName).toBe(
      "Pavithra",
    );
    expect(suggestPersons("pavithra@company.com", null, people).suggested?.displayName).toBe(
      "Pavithra",
    ); // typo
    expect(suggestPersons("syaam@company.com", null, people).suggested?.displayName).toBe("Syam");
  });

  it("uses only the first token of a multi-part name", () => {
    expect(suggestPersons("devika.tg@company.com", null, people).suggested?.displayName).toBe(
      "Devika T G",
    );
    expect(suggestPersons("mohammed_ali@company.com", null, people).suggested?.displayName).toBe(
      "Mohammed Ali",
    );
  });

  it("flags two people with the same first name instead of choosing", () => {
    const r = suggestPersons("shon@company.com", null, people);
    expect(r.status).toBe("ambiguous");
    expect(r.suggested).toBeNull();
    expect(names(r).sort()).toEqual(["Shon Domnic", "Shon J Iype"]);
  });

  it("lets the full name typed at signup settle an ambiguous first name", () => {
    const r = suggestPersons("shon@company.com", "Shon Domnic", people);
    expect(r.status).toBe("single");
    expect(r.suggested?.displayName).toBe("Shon Domnic");
  });

  it("flags short prefixes that fit several people", () => {
    const r = suggestPersons("ana@company.com", null, people);
    expect(r.status).toBe("ambiguous");
    expect(names(r)).toEqual(expect.arrayContaining(["Anna", "Ananthakrishan"]));
  });

  it("ranks exact matches before close ones", () => {
    const r = suggestPersons("anna@company.com", null, people);
    expect(r.candidates[0]).toMatchObject({ confidence: "exact" });
    expect(r.candidates[0].person.displayName).toBe("Anna");
  });

  it("returns none when nothing is close", () => {
    expect(suggestPersons("zzz.q@company.com", null, people).status).toBe("none");
    expect(suggestPersons("a1@company.com", null, people).status).toBe("none");
  });

  it("never offers someone who is already linked to an account", () => {
    const linked = people.map((x) => (x.displayName === "Rijin" ? { ...x, linked: true } : x));
    expect(suggestPersons("rijin@company.com", null, linked).status).toBe("none");
  });
});
