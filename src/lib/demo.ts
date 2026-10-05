import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { RoleName } from "./domain";

/**
 * Prototype demo mode. Switched on with ENABLE_DEMO=1, it lets a visitor "sign in" as a sample
 * role and browse made-up data. It never touches Supabase, and every action is refused.
 */
export { DEMO_COOKIE } from "./demo-constants";
import { DEMO_COOKIE } from "./demo-constants";

export interface Persona {
  slug: string;
  role: string;
  person: string;
  personId: string;
  blurb: string;
  roles: RoleName[];
}

export const PERSONAS: Persona[] = [
  {
    slug: "admin",
    role: "Administrator & Dashboard Lead",
    person: "Aditya",
    personId: "p-aditya",
    blurb: "Manages users, roles and teams; sets the deadline; tracks the website build",
    roles: ["system_admin", "dashboard_lead"],
  },
  {
    slug: "project-head",
    role: "Project Head",
    person: "Meera",
    personId: "p-meera",
    blurb: "Sees all progress; approves the end-of-project export",
    roles: ["project_head"],
  },
  {
    slug: "project-lead",
    role: "Project Lead",
    person: "Karthik",
    personId: "p-karthik",
    blurb: "Reviews finished work and enters it into Production",
    roles: ["project_lead"],
  },
  {
    slug: "production-lead-pavithra",
    role: "Production Lead",
    person: "Pavithra",
    personId: "p-pavithra",
    blurb: "Leads Team Pavithra's processes",
    roles: ["production_lead"],
  },
  {
    slug: "production-lead-rustham",
    role: "Production Lead",
    person: "Rustham",
    personId: "p-rustham",
    blurb: "Leads Team Rustham's processes",
    roles: ["production_lead"],
  },
  {
    slug: "reviewer",
    role: "Reviewer",
    person: "Fayis",
    personId: "p-fayis",
    blurb: "Reviews steps and raises review points",
    roles: ["reviewer"],
  },
  {
    slug: "supporting",
    role: "Supporting role",
    person: "Mohammed Ali",
    personId: "p-ali",
    blurb: "Helps on the processes he is assigned to",
    roles: ["supporting_role"],
  },
  {
    slug: "team-member",
    role: "Team member",
    person: "Anna",
    personId: "p-anna",
    blurb: "Sees only her own processes",
    roles: ["team_member"],
  },
];

/** The prototype demo is switched off for good: no setting turns it back on. */
export const demoEnabled = () => false;

/** The sample role this visitor picked, or null outside demo mode. */
export const getPersona = cache(async (): Promise<Persona | null> => {
  if (!demoEnabled()) return null;
  const slug = (await cookies()).get(DEMO_COOKIE)?.value;
  return PERSONAS.find((p) => p.slug === slug) ?? null;
});
