"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPersona } from "@/lib/demo";
import { getCapabilities } from "@/lib/data";
import { siteUrl } from "@/lib/env";
import { friendly } from "@/lib/rpc";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { InviteResult, InviteState } from "@/components/invite-form";

const email = z.string().trim().toLowerCase().email();
const id = z.string().uuid();

/**
 * Invites each person: creates the account, links it to the chosen person and approves it,
 * so they can sign in as soon as they have set a password. Administrators only.
 */
export async function sendInvites(_: InviteState, form: FormData): Promise<InviteState> {
  if (await getPersona()) return { error: "Demo mode is read-only. Nothing was sent." };
  const caps = await getCapabilities();
  if (!caps.roles.has("system_admin")) return { error: "You are not allowed to do that." };

  const emails = form.getAll("email").map(String);
  const people = form.getAll("person").map(String);
  const mode = form.get("mode") === "link" ? "link" : "email";
  if (emails.length === 0 || emails.length !== people.length) return { error: "Nothing to send." };
  if (new Set(people).size !== people.length) {
    return { error: "Two emails are set to the same person. Each person can have one account." };
  }

  const admin = createAdminClient();
  const supabase = await createClient();
  const results: InviteResult[] = [];

  for (let i = 0; i < emails.length; i++) {
    const e = email.safeParse(emails[i]);
    const p = id.safeParse(people[i]);
    const label = emails[i];
    if (!e.success || !p.success) {
      results.push({ email: label, ok: false, detail: "Choose the person for this email." });
      continue;
    }
    // Refuse before sending anything if the person or the email already has an account.
    const [byEmail, byPerson, person] = await Promise.all([
      admin.from("profiles").select("id, person_id").eq("email", e.data).limit(1),
      admin.from("profiles").select("id").eq("person_id", p.data).limit(1),
      admin.from("people").select("display_name").eq("id", p.data).single(),
    ]);
    const name = person.data?.display_name;
    const existing = byEmail.data?.[0];
    if (existing) {
      // An account that exists but was never used may get a fresh link (the first one expired).
      // Anyone who has signed in is left alone: an administrator must not be able to reset them.
      const { data: u } = await admin.auth.admin.getUserById(existing.id);
      if (mode === "link" && existing.person_id === p.data && u.user && !u.user.last_sign_in_at) {
        const { data, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: e.data,
        });
        results.push(
          error
            ? { email: e.data, name, ok: false, detail: "The link could not be made." }
            : {
                email: e.data,
                name,
                ok: true,
                detail: "Fresh link for an account that has not been used yet.",
                link: `${siteUrl()}/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery&next=/reset-password`,
              },
        );
      } else {
        results.push({
          email: e.data,
          name,
          ok: false,
          detail: u.user?.last_sign_in_at
            ? "This person has already signed in."
            : 'This email already has an account. Choose "show me each link" for a fresh one.',
        });
      }
      continue;
    }
    if ((byPerson.data?.length ?? 0) > 0) {
      results.push({
        email: e.data,
        name,
        ok: false,
        detail: "That person is already linked to another account.",
      });
      continue;
    }

    let userId: string | undefined;
    let link: string | undefined;
    if (mode === "email") {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(e.data, {
        data: { full_name: name },
      });
      if (error) {
        results.push({
          email: e.data,
          name,
          ok: false,
          detail: "The invite email could not be sent.",
        });
        continue;
      }
      userId = data.user.id;
    } else {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "invite",
        email: e.data,
        options: { data: { full_name: name } },
      });
      if (error) {
        results.push({
          email: e.data,
          name,
          ok: false,
          detail: "The invite link could not be made.",
        });
        continue;
      }
      userId = data.user.id;
      link = `${siteUrl()}/auth/confirm?token_hash=${data.properties.hashed_token}&type=invite&next=/reset-password`;
    }

    // The database function re-checks that the caller is an administrator.
    const { error } = await supabase.rpc("admin_approve_user", {
      p_user: userId,
      p_person: p.data,
    });
    results.push({
      email: e.data,
      name,
      ok: !error,
      link,
      detail: error
        ? `Invited, but not approved: ${friendly(error.message)} Approve them on the Users page.`
        : mode === "email"
          ? "Invite sent. They set a password from the email, then can sign in."
          : "Link ready. Send it to them; it lets them set a password.",
    });
  }
  revalidatePath("/admin");
  return { results };
}
