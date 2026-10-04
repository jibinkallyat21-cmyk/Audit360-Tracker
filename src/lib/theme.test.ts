import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toneForLead } from "./brand";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function tokens(selector: RegExp): Record<string, string> {
  const block = selector.exec(css)?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2]]),
  );
}
const THEMES = {
  dark: tokens(/:root,\s*\[data-theme="dark"\]\s*\{([^}]*)\}/),
  light: tokens(/\[data-theme="light"\]\s*\{([^}]*)\}/),
};

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each(Object.entries(THEMES))("%s theme colours", (_name, t) => {
  it("defines every token the components rely on", () => {
    for (const k of [
      "bg",
      "card",
      "text",
      "muted",
      "digit",
      "accent",
      "accent-strong",
      "danger",
      "sky",
      "violet",
      "amber",
    ]) {
      expect(t[k], k).toBeDefined();
    }
  });
  it("keeps body and secondary text readable (4.5:1)", () => {
    for (const [fg, bg] of [
      ["text", "bg"],
      ["text", "card"],
      ["muted", "bg"],
      ["muted", "card"],
      ["text", "chip"],
      ["muted", "inset"],
    ]) {
      expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("keeps numbers, error text and button text readable (4.5:1)", () => {
    expect(contrast(t.digit, t.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.danger, t.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["accent-ink"], t["accent-strong"])).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps team colours, stage colours and the focus ring visible against cards (3:1)", () => {
    for (const k of [
      "sky",
      "violet",
      "amber",
      "slate",
      "accent",
      "stage-1",
      "stage-2",
      "stage-3",
      "stage-4",
      "stage-5",
    ]) {
      expect(contrast(t[k], t.card), k).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("team tones", () => {
  it("tints the known leads and leaves everyone else neutral", () => {
    expect(toneForLead("Pavithra")).toBe("sky");
    expect(toneForLead("Rustham")).toBe("violet");
    expect(toneForLead("Someone Else")).toBe("slate");
    expect(toneForLead(undefined)).toBe("slate");
  });
});
