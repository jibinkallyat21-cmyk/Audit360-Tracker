import Link from "next/link";
import { demoLogin, login } from "../actions";
import { AuthForm, Field } from "../form";
import { DEMO_PERSONAS, demoEnabled } from "@/lib/demo";
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
        {error === "demo" && (
          <p role="alert" className="error">
            Demo accounts are not set up on this deployment yet.
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
          <h2>Demo sign-in</h2>
          <p className="muted">
            Try the app as each role. Demo accounts work on the real database, so what you do here
            is recorded. For Dashboard Lead and Administrator, use the real login.
          </p>
          <ul className="demo-list">
            {DEMO_PERSONAS.map((p) => (
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
