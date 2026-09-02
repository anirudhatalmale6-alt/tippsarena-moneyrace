/**
 * Meta pixel for the public MoneyRace pages.
 *
 * It sits in the (public) route group, NOT in app/layout.tsx. The root layout
 * is shared with the whole admin dashboard - /login, /participants, /analytics
 * - which this same Next process serves on admin.tippsarena.com. A pixel there
 * would spend the ad account's attribution on his own back-office sessions, on
 * a hostname that is deliberately noindex.
 *
 * ONE PageView per document, from the base snippet, and nothing else. That is
 * correct only because every internal link in this route group is a plain
 * <a href> - measured, not assumed: clicking through /moneyrace -> /leaderboard
 * discards the window object and issues a second document request. There is no
 * next/link in this folder.
 *
 * IF THAT CHANGES - if any of these links becomes a next/link, or a router
 * push is added - the second page will render without a document load and Meta
 * will never hear about it. Then this component needs a usePathname effect
 * firing fbq('track','PageView') on change. verify_pixel.py asserts the
 * plain-anchor assumption and will fail loudly if someone converts them, so
 * this comment cannot rot quietly.
 */
import Script from "next/script";

export const PIXEL_ID = "1728062018436249";

export default function MetaPixel() {
  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
