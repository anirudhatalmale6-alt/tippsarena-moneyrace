/**
 * The public pages served under tippsarena.com.
 *
 * A route group, so these share nothing with the dashboard except the database:
 * no session cookie is read here, and requireAdmin is deliberately absent.
 */
import "./public.css";
import type { ReactNode } from "react";
import MetaPixel from "./pixel";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lp">
      <MetaPixel />
      {children}
    </div>
  );
}
