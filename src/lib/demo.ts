/** Demo sign-in personas. Only usable when ENABLE_DEMO=1 and DEMO_PASSWORD is set. */
export const DEMO_PERSONAS = [
  {
    slug: "project-head",
    role: "Project Head",
    person: "Shon J Iype",
    blurb: "Approves exports; sees everything",
  },
  {
    slug: "project-lead",
    role: "Project Lead",
    person: "Shon Domnic",
    blurb: "Enters items into Production",
  },
  {
    slug: "production-lead-pavithra",
    role: "Production Lead",
    person: "Pavithra",
    blurb: "Leads Team Pavithra",
  },
  {
    slug: "production-lead-rustham",
    role: "Production Lead",
    person: "Rustham",
    blurb: "Leads Team Rustham",
  },
  { slug: "reviewer", role: "Reviewer", person: "Fayis", blurb: "Reviews and approves steps" },
  {
    slug: "supporting",
    role: "Supporting role",
    person: "Mohammed Ali",
    blurb: "Helps on assigned processes",
  },
  { slug: "team-member", role: "Team member", person: "Rijin", blurb: "Sees only their own work" },
] as const;

export const demoEnabled = () => process.env.ENABLE_DEMO === "1" && !!process.env.DEMO_PASSWORD;

export const demoEmail = (slug: string) => `demo+${slug}@audit360.demo`;
