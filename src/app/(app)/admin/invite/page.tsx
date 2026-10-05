import { InviteForm, type InviteRow } from "@/components/invite-form";
import { PageHero } from "@/components/ui";
import { getOrg } from "@/lib/data";
import { getPersona } from "@/lib/demo";
import { demoProfiles } from "@/lib/demo-data";
import { parseInvites } from "@/lib/invite-parse";
import { suggestPersons } from "@/lib/matching";
import { createClient } from "@/lib/supabase/server";
import { sendInvites } from "./actions";

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ emails?: string }>;
}) {
  const raw = (await searchParams).emails ?? "";
  const { entries, invalid } = parseInvites(raw);
  const nameOf = new Map(entries.map((x) => [x.email, x.name]));
  const valid = entries.map((x) => x.email);

  const demo = await getPersona();
  const [org, profiles] = await Promise.all([
    getOrg(),
    demo
      ? Promise.resolve(demoProfiles())
      : (async () =>
          (await (await createClient()).from("profiles").select("email, person_id")).data ?? [])(),
  ]);
  const linked = new Set(profiles.map((p) => p.person_id).filter(Boolean));
  const existing = new Set(profiles.map((p) => p.email.toLowerCase()));
  const lite = org.people.map((p) => ({ ...p, linked: linked.has(p.id) }));
  const personOf = new Map(profiles.map((p) => [p.email.toLowerCase(), p.person_id]));
  const rows: InviteRow[] = valid.map((e) => {
    if (existing.has(e)) {
      return {
        email: e,
        existing: true,
        suggestedId: personOf.get(e) ?? "",
        note: "Already has an account. If they have never signed in, a fresh link is made (link mode).",
      };
    }
    const m = suggestPersons(e, nameOf.get(e) || null, lite);
    const note =
      m.status === "single" && m.suggested
        ? `Suggested: ${m.suggested.displayName} (${m.candidates[0].confidence} match). Please confirm.`
        : m.status === "ambiguous"
          ? `Similar names: ${m.candidates.map((c) => c.person.displayName).join(", ")}. Choose one.`
          : "No match found. Choose the person.";
    return { email: e, suggestedId: m.status === "single" ? (m.suggested?.id ?? "") : "", note };
  });
  const people = org.people.map((p) => ({
    id: p.id,
    label: p.displayName + (linked.has(p.id) ? " (linked)" : ""),
  }));

  return (
    <main className="stack-lg">
      <PageHero eyebrow="Admin" title="Invite people">
        Paste the employee emails, check who each one is, and send. Each person gets a link to set
        their own password; their account is approved and linked to their name straight away.
      </PageHero>

      <section className="panel">
        <h2>1. Paste emails</h2>
        <form method="get" className="stack">
          <label className="field">
            <span>One per line, or separated by commas</span>
            <textarea name="emails" rows={6} defaultValue={raw} placeholder="name@company.com" />
          </label>
          <div>
            <button type="submit">Review</button>
          </div>
        </form>
        {invalid.length > 0 && (
          <p role="alert" className="error">
            Not a valid email, skipped: {invalid.join(", ")}
          </p>
        )}
      </section>

      {rows.length > 0 && (
        <section className="panel">
          <h2>2. Confirm and send ({rows.length})</h2>
          <InviteForm action={sendInvites} rows={rows} people={people} />
        </section>
      )}
    </main>
  );
}
