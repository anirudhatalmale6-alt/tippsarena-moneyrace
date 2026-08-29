"use client";
/**
 * The bar that follows the thumb — but only once the hero button is gone.
 *
 * Without the scroll check it sits on top of the page from the first frame,
 * two identical green buttons within a thumb's width of each other. That reads
 * as a mistake, and a page that looks like a mistake does not get the click.
 *
 * It renders hidden and appears; the page is still complete without JavaScript
 * because every section already carries its own button.
 */
import { useEffect, useState } from "react";

export function StickyCta({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 420);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="lp-stick" style={show ? undefined : { display: "none" }}>
      <a className="lp-cta" href={href} rel="noopener">
        {label}
      </a>
    </div>
  );
}
