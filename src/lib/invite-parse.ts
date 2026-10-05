const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedInvites {
  /** Valid emails (lower case, no duplicates) with the name written beside them, if any. */
  entries: { email: string; name: string }[];
  /** Pieces that contain an @ but are not a valid email. */
  invalid: string[];
}

/**
 * Reads pasted text: one email per line (a name beside it is used as a hint), or several
 * emails separated by commas, semicolons or spaces. Words without an @ are ignored.
 */
export function parseInvites(raw: string, max = 100): ParsedInvites {
  const seen = new Map<string, string>();
  const invalid: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const tokens = line
      .split(/[\s,;]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const emails = tokens.filter((t) => EMAIL.test(t));
    const rest = tokens.filter((t) => !EMAIL.test(t));
    invalid.push(...rest.filter((t) => t.includes("@")));
    const name = emails.length === 1 ? rest.filter((t) => !t.includes("@")).join(" ") : "";
    for (const e of emails) {
      const key = e.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return {
    entries: [...seen].slice(0, max).map(([email, name]) => ({ email, name })),
    invalid,
  };
}
