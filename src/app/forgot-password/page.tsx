import Link from "next/link";
import { requestPasswordReset } from "../actions";
import { AuthForm, Field } from "../form";

export default function ForgotPasswordPage() {
  return (
    <main className="card">
      <h1>Reset password</h1>
      <AuthForm action={requestPasswordReset} submitLabel="Send reset link">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
      </AuthForm>
      <p className="links">
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
