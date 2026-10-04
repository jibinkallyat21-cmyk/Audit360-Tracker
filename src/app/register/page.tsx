import Link from "next/link";
import { register } from "../actions";
import { AuthForm, Field } from "../form";

export default function RegisterPage() {
  return (
    <main className="card">
      <h1>Create account</h1>
      <p className="muted">
        Use your work email. You will not see any project data until an administrator approves you.
      </p>
      <AuthForm action={register} submitLabel="Create account">
        <Field label="Full name" name="fullName" autoComplete="name" required />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password (10+ characters)"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </AuthForm>
      <p className="links">
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
