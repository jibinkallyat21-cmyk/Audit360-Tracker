import { getViewer } from "@/lib/access";
import { logout } from "../actions";
import { AuthShell } from "@/components/auth-shell";

const COPY = {
  pending:
    "Your account is waiting for administrator approval. You will be able to sign in to the portal once it is approved.",
  rejected:
    "Your registration was not approved. Contact the administrator if you think this is a mistake.",
  deactivated: "Your account has been deactivated. Contact the administrator.",
} as const;

export default async function AccessDeniedPage() {
  const viewer = await getViewer();
  const state = viewer && !viewer.isActive ? "deactivated" : viewer?.approvalState;
  const text = state && state !== "approved" ? COPY[state] : "You do not have access to this page.";
  return (
    <AuthShell>
      <main className="card">
        <h1>Access denied</h1>
        <p>{text}</p>
        {viewer && (
          <form action={logout}>
            <button type="submit">Sign out</button>
          </form>
        )}
      </main>
    </AuthShell>
  );
}
