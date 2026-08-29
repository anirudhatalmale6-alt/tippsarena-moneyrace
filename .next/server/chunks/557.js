"use strict";exports.id=557,exports.ids=[557],exports.modules={1557:(a,b,c)=>{c.a(a,async(a,d)=>{try{c.d(b,{publicResult:()=>m,r_:()=>n});var e=c(7143);c(2191);var f=c(2178),g=c(7854),h=a([e,f,g]);[e,f,g]=h.then?(await h)():h;let n=[["winner","The winner only (recommended)"],["top3","The top 3"],["none","Nothing — announce it by hand or not at all"]];async function i(){let a=await (0,e.PL)("public_result_mode","winner");return["winner","top3","none"].includes(a)?a:"winner"}async function j(a,b){return b<=0?[]:(0,e.P)(`SELECT u.id AS user_id, u.telegram_id, u.username, u.first_name,
            pa.rank, pa.points, pa.correct_count, pa.exact_hits,
            (SELECT pr.home_goals || ':' || pr.away_goals
               FROM predictions pr
              WHERE pr.participant_id = pa.id AND pr.home_goals IS NOT NULL
              ORDER BY pr.id LIMIT 1) AS tip
       FROM participants pa
       JOIN users u ON u.id = pa.user_id
      WHERE pa.competition_id = $1 AND pa.is_winner = TRUE
      ORDER BY pa.rank NULLS LAST, pa.points DESC, pa.submitted_at NULLS LAST, pa.id
      LIMIT $2`,[a,b])}async function k(a,b){return b<=0?[]:(0,e.P)(`SELECT u.id AS user_id, u.telegram_id, u.username, u.first_name,
            pa.rank, pa.points, pa.correct_count, pa.exact_hits,
            (SELECT pr.home_goals || ':' || pr.away_goals
               FROM predictions pr
              WHERE pr.participant_id = pa.id AND pr.home_goals IS NOT NULL
              ORDER BY pr.id LIMIT 1) AS tip
       FROM participants pa
       JOIN users u ON u.id = pa.user_id
      WHERE pa.competition_id = $1
      ORDER BY pa.rank NULLS LAST, pa.points DESC, pa.submitted_at NULLS LAST, pa.id
      LIMIT $2`,[a,b])}function l(a){return a?`@${a}`:null}async function m(a){let b=await (0,e.xH)("SELECT * FROM competitions WHERE id = $1",[a]);if(!b)throw Error("Competition not found");let c=await i();if("none"===c)return{templateKey:null,vars:{},named:0};let d=await (0,e.PL)("support_handle","@thomastippsarena"),f=(0,g.money)(b.prize_amount,b.currency);if("top3"===c){let c=await k(a,3),e=["\uD83E\uDD47","\uD83E\uDD48","\uD83E\uDD49"],g=c.map((a,b)=>{let c=l(a.username);return`${e[b]} ${c??"Teilnehmer ohne \xf6ffentlichen Namen"} — ${a.points} Punkte`}).join("\n");return{templateKey:"channel_top3",vars:{name:b.name,podium:g,support:d,prize:f},named:c.filter(a=>a.username).length}}let[h]=await j(a,1);if(!h)return{templateKey:null,vars:{},named:0};let m=l(h.username);if(!m)return{templateKey:"channel_winner_anonymous",vars:{name:b.name,support:d},named:0};let n=await (0,e.xH)(`SELECT f.home_team, f.away_team, f.home_goals, f.away_goals
       FROM competition_fixtures cf JOIN fixtures f ON f.id = cf.fixture_id
      WHERE cf.competition_id = $1 ORDER BY cf.position LIMIT 1`,[a]),o={name:b.name,winner:m,winner_points:`${h.points} Punkte`,prize:f,support:d,rank:h.rank??1};return"exact_score"===b.type?{templateKey:"channel_exact_winner",vars:{...o,match:n?`${n.home_team} — ${n.away_team}`:"",winner_tip:h.tip??"-"},named:1}:{templateKey:"channel_winner_only",vars:o,named:1}}d()}catch(a){d(a)}})}};