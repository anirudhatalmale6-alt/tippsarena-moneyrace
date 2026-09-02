<?php
/**
 * Plugin Name: TippsArena Meta Pixel
 * Description: Meta (Facebook) pixel 1728062018436249 on the public WordPress pages.
 * Version:     1.0
 *
 * An mu-plugin, not header.php. The theme header is edited most weeks; a
 * tracking tag living inside an edited file is one careless paste away from
 * disappearing, and nothing anywhere would report an error - the site would
 * simply stop counting.
 *
 * wp_head does not fire in wp-admin, so the dashboard is excluded by the hook
 * itself rather than by a condition that can rot.
 *
 * The MoneyRace pages (/moneyrace, /dach, /leaderboard) are NOT WordPress -
 * they are proxied to the Next app on :3200 and never touch this file. Their
 * copy of the pixel lives in app/(public)/pixel.tsx.
 */

defined('ABSPATH') || exit;

const TIPPSARENA_PIXEL_ID = '1728062018436249';

/**
 * Fires for logged-in editors too, on purpose: excluded traffic is invisible
 * traffic, and the first thing anyone does is open the site in their own
 * browser with Pixel Helper to check it works.
 */
add_action('wp_head', function () {
    $id = TIPPSARENA_PIXEL_ID;
    echo <<<HTML
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '{$id}');
fbq('track', 'PageView');
</script>
<!-- End Meta Pixel Code -->

HTML;
}, 5);

add_action('wp_body_open', function () {
    $id = TIPPSARENA_PIXEL_ID;
    echo '<noscript><img height="1" width="1" style="display:none" '
       . 'src="https://www.facebook.com/tr?id=' . $id . '&ev=PageView&noscript=1" '
       . 'alt=""></noscript>' . "\n";
});
