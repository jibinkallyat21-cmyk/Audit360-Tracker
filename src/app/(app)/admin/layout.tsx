import Link from "next/link";
import { notFound } from "next/navigation";
import { getCapabilities } from "@/lib/data";

/** Administration is for System Administrators only; everyone else sees a plain "not found". */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const caps = await getCapabilities();
  if (!caps.roles.has("system_admin")) notFound();
  return (
    <div className="stack-lg">
      <nav aria-label="Administration" className="subnav">
        <Link href="/admin">Users</Link>
        <Link href="/admin/roles">Roles</Link>
        <Link href="/admin/assignments">Assignments</Link>
        <Link href="/admin/teams">Teams</Link>
      </nav>
      {children}
    </div>
  );
}
