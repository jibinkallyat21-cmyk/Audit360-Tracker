import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";

export const metadata: Metadata = {
  title: "Under maintenance",
  robots: { index: false },
};

export default function MaintenancePage() {
  return (
    <AuthShell>
      <main className="card" role="status">
        <h1>Under maintenance</h1>
        <p className="muted">
          We are making improvements to the Audit 360 Tracker. It will be back soon. Thank you for
          your patience.
        </p>
        <p className="links">
          <Link href="/login">Administrator sign in</Link>
        </p>
      </main>
    </AuthShell>
  );
}
