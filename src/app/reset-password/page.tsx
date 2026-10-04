import { resetPassword } from "../actions";
import { AuthForm, Field } from "../form";

export default function ResetPasswordPage() {
  return (
    <main className="card">
      <h1>Choose a new password</h1>
      <AuthForm action={resetPassword} submitLabel="Update password">
        <Field
          label="New password (10+ characters)"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
      </AuthForm>
    </main>
  );
}
