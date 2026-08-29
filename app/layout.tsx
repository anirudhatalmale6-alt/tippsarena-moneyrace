import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "TippsArena Admin",
  description: "TippsArena MoneyRace - Verwaltung",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
