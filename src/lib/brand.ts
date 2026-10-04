/** Name shown in the header. Change here to rebrand the whole app. */
export const BRAND = {
  company: "Audit 360",
  product: "Tracker",
  tagline: "Process review portal",
} as const;

/** Colour tone of a team, used for chips, borders and dots across the app. */
export type Tone = "sky" | "violet" | "amber" | "slate";

const LEAD_TONES: Record<string, Tone> = { Pavithra: "sky", Rustham: "violet" };

/** Teams are tinted by their Production Lead; anyone unrecognised stays neutral. */
export const toneForLead = (leadName: string | undefined | null): Tone =>
  (leadName && LEAD_TONES[leadName]) || "slate";
