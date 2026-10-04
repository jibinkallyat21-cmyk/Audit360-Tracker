import Link from "next/link";
import { login } from "../actions";
import { AuthForm, Field } from "../form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="card">
      <h1>Tracker &amp; Review</h1>
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
  );
}
