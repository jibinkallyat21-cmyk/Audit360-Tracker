import Link from "next/link";
import { demoLogin, login } from "../actions";
import { AuthForm, Field } from "../form";
import { PERSONAS, demoEnabled } from "@/lib/demo";
import { AuthShell } from "@/components/auth-shell";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <AuthShell>
      <main className="card">
        <h1>Audit 360 Tracker</h1>
        <p className="muted">Sign in to the internal process portal.</p>
        {error === "link" && (
          <p role="alert" className="error">
            That link is invalid or has expired. Request a new one.
          </p>
        )}
        <AuthForm action={login} submitLabel="Sign in">
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </AuthForm>
        <p className="links">
          <Link href="/forgot-password">Forgot password?</Link> ·{" "}
          <Link href="/register">Create account</Link>
        </p>
      </main>
      {demoEnabled() && (
        <section className="card demo">
          <h2>Try the demo</h2>
          <p className="muted">
            A prototype with made-up data. Pick a role to see what that person sees. Nothing here is
            saved, and no account is needed.
          </p>
          <ul className="demo-list">
            {PERSONAS.map((p) => (
              <li key={p.slug}>
                <form action={demoLogin}>
                  <input type="hidden" name="persona" value={p.slug} />
                  <button type="submit" className="secondary">
                    <strong>{p.role}</strong>
                    <span>
                      {p.person} · {p.blurb}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AuthShell>
  );
}
