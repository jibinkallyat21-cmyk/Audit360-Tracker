import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tracker & Review",
  description: "Internal process development and review portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
