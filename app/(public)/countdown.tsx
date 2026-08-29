"use client";
/**
 * The countdown to the deadline.
 *
 * The only client-side JavaScript on either ad page. It takes an ISO string
 * rendered by the server rather than reading the clock on its own, so the page
 * still says something true with JavaScript switched off - the deadline is
 * printed in words underneath, and this only animates it.
 */
import { useEffect, useState } from "react";

const PAD = (n: number) => String(n).padStart(2, "0");

export function Countdown({
  target,
  labels = ["Tage", "Std", "Min", "Sek"],
  overText = "Tippschluss erreicht",
}: {
  target: string;
  labels?: string[];
  overText?: string;
}) {
  // Starts null and fills in after mount: the server and the browser would
  // otherwise render different seconds and React would complain about it.
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const end = new Date(target).getTime();
    const tick = () => setLeft(Math.max(0, end - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [target]);

  if (left === null) {
    return (
      <div className="lp-clock" suppressHydrationWarning>
        {labels.map((l) => (
          <div key={l}>
            <b>--</b>
            <small>{l}</small>
          </div>
        ))}
      </div>
    );
  }

  if (left <= 0) {
    return (
      <div className="lp-clock lp-over">
        <div style={{ minWidth: "auto", padding: "10px 18px" }}>
          <b style={{ fontSize: 16 }}>{overText}</b>
        </div>
      </div>
    );
  }

  const seconds = Math.floor(left / 1000);
  const parts = [
    Math.floor(seconds / 86400),
    Math.floor((seconds % 86400) / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ];

  return (
    <div className="lp-clock">
      {parts.map((value, i) => (
        <div key={labels[i]}>
          <b>{PAD(value)}</b>
          <small>{labels[i]}</small>
        </div>
      ))}
    </div>
  );
}
