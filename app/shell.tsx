/**
 * The frame every dashboard page sits in, and the guard in front of it.
 *
 * Spec §25: the navigation is German and it is the same on every page. §35:
 * nothing renders until the session cookie has been verified against a real,
 * active admin row - the check is here, once, rather than in each page.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { findAdmin, readSessionToken, SESSION_COOKIE, type AdminUser } from "@/lib/auth.ts";

export const NAV: Array<[string, string]> = [
  ["/", "🏠 Dashboard"],
  ["/wettbewerbe", "🏁 Wettbewerbe"],
  ["/spiele", "⚽ Spiele"],
  ["/teilnehmer", "👥 Teilnehmer"],
  ["/leaderboards", "🏆 Leaderboards"],
  ["/gewinner", "🏅 Gewinner"],
  ["/referrals", "🔗 Referrals"],
  ["/analytics", "📊 Analytics"],
  ["/telegram", "📢 Telegram"],
  ["/einstellungen", "⚙️ Einstellungen"],
];

/** The current admin, or a redirect to the login page. Never returns null. */
export async function requireAdmin(): Promise<AdminUser> {
  const jar = await cookies();
  const id = await readSessionToken(jar.get(SESSION_COOKIE)?.value);
  const admin = id ? await findAdmin(id) : null;
  if (!admin) redirect("/login");
  return admin;
}

export function Shell({
  title,
  active,
  children,
  actions,
}: {
  title: string;
  active: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          TippsArena
          <small>MoneyRace Verwaltung</small>
        </div>
        <nav className="nav">
          {NAV.map(([href, label]) => (
            <a key={href} href={href} className={href === active ? "active" : ""}>
              {label}
            </a>
          ))}
        </nav>
      </aside>
      <main className="main">
        <div className="topbar">
          <h1>{title}</h1>
          <div className="actions">{actions}</div>
        </div>
        {children}
      </main>
    </div>
  );
}

/** Status word -> colour, in his words (spec §27). */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    draft: ["Entwurf", ""],
    open: ["Geöffnet", "green"],
    locked: ["Gesperrt", "amber"],
    evaluating: ["Auswertung", "amber"],
    finished: ["Beendet", "blue"],
    cancelled: ["Abgebrochen", "red"],
  };
  const [label, colour] = map[status] ?? [status, ""];
  return <span className={`badge ${colour}`}>{label}</span>;
}

export function Notice({
  kind = "ok",
  children,
}: {
  kind?: "ok" | "bad" | "warn";
  children: ReactNode;
}) {
  return <div className={`notice ${kind}`}>{children}</div>;
}
