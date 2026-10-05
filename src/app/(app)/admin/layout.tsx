import { SubNav } from "@/components/nav";
import { notFound } from "next/navigation";
import { getCapabilities } from "@/lib/data";

/** Administration is for System Administrators only; everyone else sees a plain "not found". */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const caps = await getCapabilities();
  if (!caps.roles.has("system_admin")) notFound();
  return (
    <div className="stack-lg">
      <SubNav
        label="Administration"
        items={[
          { href: "/admin", label: "Users" },
          { href: "/admin/invite", label: "Invite" },
          { href: "/admin/roles", label: "Roles" },
          { href: "/admin/assignments", label: "Assignments" },
          { href: "/admin/teams", label: "Teams" },
        ]}
      />
      {children}
    </div>
  );
}
