import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { confirmLink } from "./actions";

export const metadata: Metadata = { title: "Continue", robots: { index: false } };

const LABEL: Record<string, { title: string; text: string; button: string }> = {
  invite: {
    title: "Welcome to the Audit 360 Tracker",
    text: "Press the button to set your password and sign in.",
    button: "Set my password",
  },
  recovery: {
    title: "Reset your password",
    text: "Press the button to choose a new password.",
    button: "Choose a new password",
  },
  email: {
    title: "Confirm your email",
    text: "Press the button to confirm your email and sign in.",
    button: "Confirm my email",
  },
};

export default async function ContinuePage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const copy = LABEL[sp.type ?? ""] ?? LABEL.email;
  const usable = Boolean(sp.token_hash && sp.type);
  return (
    <AuthShell>
      <main className="card">
        <h1>{copy.title}</h1>
        {sp.error && (
          <p role="alert" className="error">
            This link has expired or was already used. Ask the administrator for a new one.
          </p>
        )}
        {usable ? (
          <>
            <p className="muted">{copy.text}</p>
            <form action={confirmLink} className="stack">
              <input type="hidden" name="token_hash" value={sp.token_hash} />
              <input type="hidden" name="type" value={sp.type} />
              <input type="hidden" name="next" value={sp.next ?? "/"} />
              <button type="submit">{copy.button}</button>
            </form>
          </>
        ) : (
          <p role="alert" className="error">
            This link is incomplete. Ask the administrator for a new one.
          </p>
        )}
      </main>
    </AuthShell>
  );
}
