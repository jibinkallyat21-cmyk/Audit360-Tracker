import { BRAND } from "@/lib/brand";
import { ThemeToggle } from "./theme-toggle";

/** Frame for the sign-in, registration and access-denied pages. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="hero-bg" aria-hidden="true" />
      <div className="auth-top">
        <span className="brand">
          <strong>
            {BRAND.company} <em>{BRAND.product}</em>
          </strong>
        </span>
        <ThemeToggle />
      </div>
      {children}
    </div>
  );
}
