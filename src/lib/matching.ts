export interface PersonLite {
  id: string;
  displayName: string;
  firstName: string;
  /** Already linked to an account, so not available. */
  linked: boolean;
}

export interface Candidate {
  person: PersonLite;
  confidence: "exact" | "close";
}

export interface MatchResult {
  candidates: Candidate[];
  /** single: one likely person; ambiguous: several similar, the administrator must choose; none: no match. */
  status: "single" | "ambiguous" | "none";
  suggested: PersonLite | null;
}

const letters = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * Suggests which seeded person an email belongs to, from the first name in the email's
 * local part (and the name typed at signup). Close matches count; several similar people
 * are never resolved automatically. The administrator always makes the final choice.
 */
export function suggestPersons(
  email: string,
  fullName: string | null,
  people: PersonLite[],
): MatchResult {
  const local = email.split("@")[0] ?? "";
  const tokens = local
    .split(/[^A-Za-z]+/)
    .map(letters)
    .filter((t) => t.length >= 2);
  const joined = letters(local);
  const typed = letters(fullName ?? "");

  const candidates: Candidate[] = [];
  for (const person of people) {
    if (person.linked) continue;
    const first = letters(person.firstName);
    const display = letters(person.displayName);
    if (first.length < 2) continue;

    const exact =
      tokens.includes(first) || joined === display || (typed !== "" && typed === display);
    if (exact) {
      candidates.push({ person, confidence: "exact" });
      continue;
    }
    const pool = [...tokens, joined, ...(typed ? [typed.slice(0, first.length)] : [])];
    const close = pool.some((t) => {
      if (t.length < 3) return false;
      if (t.startsWith(first) || (first.startsWith(t) && t.length >= 3)) return true;
      return distance(t, first) <= (first.length >= 7 ? 2 : 1);
    });
    if (close) candidates.push({ person, confidence: "close" });
  }
  candidates.sort((a, b) =>
    a.confidence === b.confidence ? 0 : a.confidence === "exact" ? -1 : 1,
  );

  // Typing the person's full display name settles an otherwise ambiguous first name.
  const byFullName = candidates.filter(
    (c) => typed !== "" && typed === letters(c.person.displayName),
  );
  if (byFullName.length === 1) {
    return { candidates, status: "single", suggested: byFullName[0].person };
  }
  if (candidates.length === 0) return { candidates, status: "none", suggested: null };
  if (candidates.length === 1)
    return { candidates, status: "single", suggested: candidates[0].person };
  return { candidates, status: "ambiguous", suggested: null };
}
