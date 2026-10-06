import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";

export default function NotFound() {
  return (
    <AuthShell>
      <main className="card">
        <h1>Page not found</h1>
        <p className="muted">This page does not exist, or you do not have access to it.</p>
        <p className="links">
          <Link href="/">Back to the dashboard</Link>
        </p>
      </main>
    </AuthShell>
  );
}
