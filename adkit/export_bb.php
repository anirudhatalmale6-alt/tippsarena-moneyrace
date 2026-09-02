<?php
/**
 * Runs on the live site via `wp eval-file`. READ ONLY - it opens no writer and
 * calls nothing that touches the database beyond get_post_meta.
 *
 * The reason the reels read this rather than deriving their own bet builder is
 * that the video and the site have to agree. If the reel says "Ueber 2.5 Tore,
 * 80%" and the page it drives traffic to says something else, the viewer who
 * clicks through is the one who finds out.
 */
$q = new WP_Query(array(
    'post_type'      => 'post',
    'posts_per_page' => -1,
    'meta_key'       => 'ta_markets',
    'fields'         => 'ids',
    'no_found_rows'  => true,
));
$out = array();
foreach ($q->posts as $id) {
    $m = json_decode(get_post_meta($id, 'ta_markets', true), true);
    $i = json_decode(get_post_meta($id, 'ta_matchinfo', true), true);
    if (!is_array($m) || !is_array($i)) {
        continue;
    }
    $out[] = array(
        'id'    => $id,
        'url'   => get_permalink($id),
        'info'  => $i,
        'mk'    => $m,
    );
}
echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
