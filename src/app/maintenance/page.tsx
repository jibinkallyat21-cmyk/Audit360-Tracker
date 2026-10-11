import Link from "next/link";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "./maintenance.module.css";

export const metadata: Metadata = {
  title: "Under maintenance · Audit 360 Tracker",
  robots: { index: false },
};

// Self-hosted, like every other font in the app (no request to Google at runtime).
const figtree = localFont({
  src: "../fonts/Figtree-latin.woff2",
  variable: "--font-figtree",
  weight: "300 900",
  display: "swap",
});
const literata = localFont({
  src: "../fonts/Literata-latin.woff2",
  variable: "--font-literata",
  weight: "200 900",
  display: "swap",
});

/** A laptop with a gear and speed lines, drawn as in the design. The gear turns slowly. */
function LaptopGear() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 300 110"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g className={styles.lines} strokeWidth="3" strokeLinecap="round">
        <path d="M12 39h48M30 28h30M30 50h22" />
        <path d="M240 39h48M240 28h30M248 50h22" />
      </g>
      <rect
        className={styles.laptop}
        x="80"
        y="4"
        width="140"
        height="86"
        rx="5"
        strokeWidth="3.5"
      />
      <path
        className={styles.laptop}
        d="M70 96h160a3 3 0 0 1 3 3v3a3 3 0 0 1-3 3H70a3 3 0 0 1-3-3v-3a3 3 0 0 1 3-3z"
        strokeWidth="3.5"
      />
      <g className={styles.gear}>
        <circle
          cx="150"
          cy="47"
          r="19"
          strokeWidth="7"
          strokeDasharray="7.5 7.5"
          transform="rotate(-10 150 47)"
        />
        <circle className={styles.hubfill} cx="150" cy="47" r="15" strokeWidth="3.5" />
        <circle cx="150" cy="47" r="6" strokeWidth="3.5" />
      </g>
    </svg>
  );
}

export default function MaintenancePage() {
  return (
    <div className={`${styles.page} ${figtree.variable} ${literata.variable}`}>
      <main className={styles.frame} role="status">
        <div className={styles.theme}>
          <ThemeToggle />
        </div>
        <p className={styles.eyebrow}>System Maintenance</p>
        <LaptopGear />
        <h1 className={styles.title}>We’ll be back shortly</h1>
        <p className={styles.body}>
          The Audit 360 Tracker is temporarily unavailable while we carry out scheduled maintenance
          and improvements.
        </p>
        <Link href="/login" className={styles.admin}>
          Administrator sign in
        </Link>
      </main>
    </div>
  );
}
