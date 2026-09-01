"use strict";exports.id=178,exports.ids=[178],exports.modules={213:(a,b,c)=>{c.a(a,async(a,d)=>{try{c.d(b,{KD:()=>g,SL:()=>h});var e=c(7143),f=a([e]);function g(a,b){return"giveaway"!==a||"reminder"!==b&&"locked"!==b}async function h(a,b){return(await (0,e.P)(`UPDATE notifications
        SET skipped_at = now(), skip_reason = $2
      WHERE competition_id = $1
        AND sent_at IS NULL
        AND skipped_at IS NULL
        AND kind <> 'winner'
      RETURNING id`,[a,b])).length}e=(f.then?(await f)():f)[0],d()}catch(a){d(a)}})},2178:(a,b,c)=>{c.a(a,async(a,d)=>{try{c.d(b,{JZ:()=>q,Om:()=>m,Pb:()=>s,QP:()=>r,XD:()=>p,e8:()=>n,i8:()=>u,iB:()=>w,qm:()=>v,sb:()=>k,wp:()=>o,yH:()=>l,zV:()=>t});var e=c(7143),f=c(2191),g=c(3627),h=c(213),i=c(7016),j=a([e,g,h]);async function k(a,b,c,d,f,g,h){await (0,e.P)(`INSERT INTO audit_logs
       (admin_user_id, action, entity, entity_id, summary, before_state, after_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,[a,b,d??null,void 0!==f?String(f):null,c,void 0===g?null:JSON.stringify(g),void 0===h?null:JSON.stringify(h)])}async function l(a,b,c,d,e=null){let f=await (0,i.cd)(a,b,c,d),h=await (0,g.Yh)(f);return await k(e,"fixtures.import",`${f.length} matches imported (league ${a}, ${c} to ${d})`,"league",a),{fetched:f.length,stored:h.length,fixtures:h.map((a,b)=>({id:a,row:f[b]}))}}async function m(a,b=null){let c=(await (0,e.P)(`INSERT INTO competitions
       (name, type, description, prize_amount, currency, winner_count,
        requires_membership, opens_at, locks_at, ends_at, scoring, tiebreakers,
        template_id, jackpot_amount, jackpot_increment, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             COALESCE($11::jsonb, '{"correct_outcome":1,"exact_score":0}'::jsonb),
             COALESCE($12::jsonb, '["points","exact_hits","submitted_at"]'::jsonb),
             $13,$14,$15,$16)
     RETURNING id`,[a.name,a.type??"moneyrace",a.description??null,a.prizeAmount??0,a.currency??"EUR",a.winnerCount??1,a.requiresMembership??!0,a.opensAt??null,a.locksAt??null,a.endsAt??null,a.scoring?JSON.stringify(a.scoring):null,a.tiebreakers?JSON.stringify(a.tiebreakers):null,a.templateId??null,a.jackpotAmount??null,a.jackpotIncrement??null,b]))[0].id;return await k(b,"competition.create",`Competition "${a.name}" created`,"competition",c,void 0,a),f.R.info(`competition ${c} "${a.name}" created`),c}async function n(a,b,c=null){await (0,e.tx)(async c=>{let{rows:d}=await c.query("SELECT status FROM competitions WHERE id = $1 FOR UPDATE",[a]);if(d[0]&&!["draft","open"].includes(d[0].status))throw Error(`Matches can only be changed while the competition is a draft or still open (status: ${d[0].status})`);await c.query("DELETE FROM competition_fixtures WHERE competition_id = $1",[a]);let e=1;for(let d of b)await c.query(`INSERT INTO competition_fixtures (competition_id, fixture_id, position)
         VALUES ($1, $2, $3)`,[a,d,e]),e+=1}),await k(c,"competition.fixtures",`${b.length} matches assigned`,"competition",a)}async function o(a){let b=await (0,e.xH)(`SELECT c.name, c.type, c.status, c.locks_at, c.opens_at, c.prize_amount,
            (SELECT COUNT(*)::int FROM competition_fixtures cf
              WHERE cf.competition_id = c.id) AS matches
       FROM competitions c WHERE c.id = $1`,[a]);if(!b)return{ready:!1,blockers:["Competition not found"],warnings:[],live:!1};let c=[],d=[];return b.locks_at?new Date(b.locks_at).getTime()<=Date.now()&&c.push("The lock time is already in the past, so it would close the moment it opened. Move it forward."):c.push("No lock time. Set one under Basics - it is the moment predictions close."),"giveaway"!==b.type&&0===b.matches&&c.push('No matches. Pick them under "Change matches" further down this page.'),0>=Number(b.prize_amount)&&d.push("The prize money is 0 - the announcement will say so."),b.opens_at&&new Date(b.opens_at).getTime()>Date.now()&&d.push("The start time is in the future, so publishing schedules it - players will see it from that moment, not immediately. Clear the start time to open it now."),{ready:0===c.length,blockers:c,warnings:d,live:"open"===b.status}}function p(a){let b=a.opens_at?new Date(a.opens_at):null;switch(a.status){case"open":return{visible:!0,label:"Live in the bot",detail:"Players can enter now."};case"draft":if(a.published_at&&b&&b.getTime()>Date.now())return{visible:!1,label:"Scheduled",detail:"Published, and it opens by itself at the start time."};if(a.published_at)return{visible:!1,label:"Opening",detail:"Published - it goes live within the next minute."};return{visible:!1,label:"Not visible",detail:"Still a draft - press PUBLISH to put it in the bot."};case"locked":return{visible:!1,label:"Locked",detail:"Predictions are closed."};case"evaluating":return{visible:!1,label:"Being scored",detail:"Waiting for results."};case"finished":return{visible:!1,label:"Finished",detail:"Over and scored."};case"cancelled":return{visible:!1,label:"Cancelled",detail:""};default:return{visible:!1,label:a.status,detail:""}}}async function q(a,b=null){let c=await (0,e.xH)("SELECT id, name, type, status, locks_at FROM competitions WHERE id = $1",[a]);if(!c)throw Error("Competition not found");let d=await o(a);if(!d.ready)throw Error(d.blockers.join(" "));if(await (0,e.P)(`UPDATE competitions
        SET published_at = COALESCE(published_at, now()),
            opens_at = COALESCE(opens_at, now()),
            status = CASE
                       WHEN status = 'draft' AND COALESCE(opens_at, now()) <= now()
                       THEN 'open' ELSE status
                     END,
            updated_at = now()
      WHERE id = $1`,[a]),await (0,e.P)(`INSERT INTO notifications (competition_id, kind, due_at)
     SELECT id, 'opened', GREATEST(COALESCE(opens_at, now()), now())
       FROM competitions WHERE id = $1
     ON CONFLICT (competition_id, kind, audience) DO NOTHING`,[a]),c.locks_at&&(0,h.KD)(c.type,"reminder")){let b=(await (0,e.xH)("SELECT value::text::int AS value FROM settings WHERE key='reminder_hours_before_lock'"))?.value??1,d=new Date(new Date(c.locks_at).getTime()-36e5*b);d.getTime()>Date.now()&&await (0,e.P)(`INSERT INTO notifications (competition_id, kind, due_at)
         VALUES ($1, 'reminder', $2)
         ON CONFLICT (competition_id, kind, audience) DO NOTHING`,[a,d])}await k(b,"competition.publish",`Competition "${c.name}" published`,"competition",a)}async function r(a){let b=await (0,e.xH)(`SELECT c.name, c.status,
            (SELECT COUNT(*)::int FROM participants p WHERE p.competition_id = c.id) AS participants,
            (SELECT COUNT(*)::int FROM predictions pr
               JOIN participants p ON p.id = pr.participant_id
              WHERE p.competition_id = c.id) AS predictions,
            (SELECT COUNT(*)::int FROM prizes z WHERE z.competition_id = c.id) AS prizes,
            (SELECT COUNT(*)::int FROM prizes z
              WHERE z.competition_id = c.id AND z.status <> 'paid') AS prizes_unpaid,
            (SELECT COUNT(*)::int FROM telegram_messages t
              WHERE t.competition_id = c.id AND t.status = 'sent') AS posted
       FROM competitions c WHERE c.id = $1`,[a]);return b?{...b,serious:b.participants>0||b.prizes_unpaid>0}:null}async function s(a,b=null){let c=await r(a);if(!c)throw Error("Competition not found");await k(b,"competition.delete",`Deleted "${c.name}" (${c.status}) with ${c.participants} participant(s), ${c.predictions} prediction(s) and ${c.prizes} prize(s)`,"competition",a,c),await (0,e.P)("DELETE FROM competitions WHERE id = $1",[a]),f.R.info(`competition ${a} "${c.name}" deleted`)}async function t(a,b,c=null){let d=(await (0,e.P)(`INSERT INTO competitions
       (name, type, description, prize_amount, currency, winner_count,
        requires_membership, channel_chat_id, scoring, tiebreakers,
        jackpot_increment, template_id, created_by, status)
     SELECT $2, type, description, prize_amount, currency, winner_count,
            requires_membership, channel_chat_id, scoring, tiebreakers,
            jackpot_increment, template_id, $3, 'draft'
       FROM competitions WHERE id = $1
     RETURNING id`,[a,b,c]))[0].id;return await k(c,"competition.duplicate",`Competition #${a} duplicated to "${b}"`,"competition",d),d}async function u(a,b=null){let c=0,d=0,g=crypto.randomUUID();await (0,e.tx)(async e=>{let{rows:f}=await e.query("SELECT id, type FROM competitions WHERE id = $1 FOR UPDATE",[a]);if(!f[0])throw Error("Competition not found");let{rows:h}=await e.query("SELECT id FROM draws WHERE competition_id = $1",[a]);if(h.length)throw Error("A winner has already been drawn for this giveaway. Drawing again would replace them.");let{rows:i}=await e.query("SELECT user_id FROM participants WHERE competition_id = $1 ORDER BY id",[a]);if(!i.length)throw Error("No participants - there is nobody to draw");d=i.length;let j=crypto.getRandomValues(new Uint32Array(1))[0]%i.length;c=i[j].user_id,await e.query(`INSERT INTO draws
         (competition_id, winner_user_id, pool_size, pool_snapshot, seed, drawn_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,[a,c,i.length,JSON.stringify(i.map(a=>a.user_id)),g,b]),await e.query(`UPDATE participants SET is_winner = TRUE, rank = 1
        WHERE competition_id = $1 AND user_id = $2`,[a,c]),await e.query("UPDATE competitions SET status = 'finished', evaluated_at = now() WHERE id = $1",[a])});let i=await (0,h.SL)(a,"the winner was drawn before this came due");return await k(b,"giveaway.draw",`Winner drawn from ${d} participants (draw ${g})`,"competition",a),i&&f.R.info(`giveaway ${a}: ${i} queued announcement(s) retired`),{winnerUserId:c,poolSize:d,seed:g}}function v(a,b,c){if("cancelled"===a.status)return"Cancelled";if("paid"===c)return"Completed";if(b)return"Winner drawn";if("finished"===a.status)return"Ended";if("open"===a.status)return"Active";if(a.published_at){let b=a.opens_at?new Date(a.opens_at):null;return b&&b.getTime()>Date.now()?"Scheduled":"Opening"}return"Draft"}async function w(a,b=null){await (0,e.P)("UPDATE prizes SET status = 'paid', paid_at = now() WHERE id = $1",[a]),await k(b,"prize.paid",`Prize #${a} marked as paid`,"prize",a)}[e,g,h]=j.then?(await j)():j,d()}catch(a){d(a)}})},3627:(a,b,c)=>{c.a(a,async(a,d)=>{try{c.d(b,{Yh:()=>j,kJ:()=>m,n$:()=>l,yM:()=>k});var e=c(7143),f=c(2191),g=c(7016),h=a([e]);async function i(a){let b=(0,g.$g)(a.status),c=b?a.homeGoals:null,d=b?a.awayGoals:null,f=b?(0,g.sG)(a.homeGoals,a.awayGoals):null;return(await (0,e.P)(`INSERT INTO fixtures
       (provider, external_id, league_id, league_name, season, round,
        home_team, away_team, home_team_id, away_team_id, kickoff_at, status,
        home_goals, away_goals, outcome, finished_at, raw, updated_at)
     VALUES ('api-football',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             CASE WHEN $15 THEN now() ELSE NULL END, $16, now())
     ON CONFLICT (provider, external_id) DO UPDATE SET
        league_name = EXCLUDED.league_name,
        round       = EXCLUDED.round,
        home_team   = EXCLUDED.home_team,
        away_team   = EXCLUDED.away_team,
        kickoff_at  = EXCLUDED.kickoff_at,
        status      = EXCLUDED.status,
        -- A result entered by hand in the dashboard outranks the API. He only
        -- corrects one when the API is wrong, and the next poll must not undo it.
        home_goals  = CASE WHEN fixtures.manual THEN fixtures.home_goals
                           ELSE COALESCE(EXCLUDED.home_goals, fixtures.home_goals) END,
        away_goals  = CASE WHEN fixtures.manual THEN fixtures.away_goals
                           ELSE COALESCE(EXCLUDED.away_goals, fixtures.away_goals) END,
        outcome     = CASE WHEN fixtures.manual THEN fixtures.outcome
                           ELSE COALESCE(EXCLUDED.outcome, fixtures.outcome) END,
        finished_at = COALESCE(fixtures.finished_at, EXCLUDED.finished_at),
        raw         = EXCLUDED.raw,
        updated_at  = now()
     RETURNING id`,[a.externalId,a.leagueId,a.leagueName,a.season,a.round,a.homeTeam,a.awayTeam,a.homeTeamId,a.awayTeamId,a.kickoffAt,a.status,c,d,f,b,JSON.stringify(a.raw)]))[0].id}async function j(a){let b=[];for(let c of a)b.push(await i(c));return b}async function k(a,b,c){await (0,e.P)(`UPDATE fixtures
        SET home_goals = $2, away_goals = $3, outcome = $4,
            status = 'FT', manual = TRUE,
            finished_at = COALESCE(finished_at, now()), updated_at = now()
      WHERE id = $1`,[a,b,c,(0,g.sG)(b,c)]),f.R.info(`manual result set on fixture ${a}: ${b}-${c}`)}e=(h.then?(await h)():h)[0];let n="raw #>> '{fixture,status,short}' IN ('FT','AET','PEN')";async function l(a){await (0,e.P)(`UPDATE fixtures
        SET manual = FALSE,
            home_goals  = CASE WHEN ${n} THEN home_goals  ELSE NULL END,
            away_goals  = CASE WHEN ${n} THEN away_goals  ELSE NULL END,
            outcome     = CASE WHEN ${n} THEN outcome     ELSE NULL END,
            status      = CASE WHEN ${n} THEN status
                               ELSE COALESCE(raw #>> '{fixture,status,short}', 'NS') END,
            finished_at = CASE WHEN ${n} THEN finished_at ELSE NULL END,
            updated_at  = now()
      WHERE id = $1`,[a])}async function m(a){let b=await (0,e.xH)("SELECT kickoff_at > now() AS future FROM fixtures WHERE id = $1",[a]);return!!b?.future}d()}catch(a){d(a)}})},7016:(a,b,c)=>{c.d(b,{$g:()=>f,cd:()=>k,sG:()=>g});var d=c(1011);c(2191);let e=new Set(["FT","AET","PEN"]);function f(a){return e.has(a)}function g(a,b){return null==a||null==b?null:a>b?"H":a<b?"A":"D"}class h extends Error{}async function i(a,b){if(!d.$W.footballKey)throw new h("FOOTBALL_API_KEY is not set");let c=new URL(`https://${d.$W.footballHost}/${a}`);for(let[a,d]of Object.entries(b))c.searchParams.set(a,d);let e=await fetch(c,{headers:{"x-apisports-key":d.$W.footballKey},signal:AbortSignal.timeout(2e4)});if(!e.ok)throw new h(`${a} returned HTTP ${e.status}`);let f=await e.json(),g=f?.errors;if(Array.isArray(g)?g.length>0:g&&Object.keys(g).length>0)throw new h(`${a}: ${JSON.stringify(g)}`);return f}function j(a){return{externalId:a.fixture.id,leagueId:a.league?.id??null,leagueName:a.league?.name??null,season:a.league?.season??null,round:a.league?.round??null,homeTeam:a.teams?.home?.name??"?",awayTeam:a.teams?.away?.name??"?",homeTeamId:a.teams?.home?.id??null,awayTeamId:a.teams?.away?.id??null,kickoffAt:new Date(a.fixture.date),status:a.fixture?.status?.short??"NS",homeGoals:a.goals?.home??null,awayGoals:a.goals?.away??null,raw:a}}async function k(a,b,c,d){return((await i("fixtures",{league:String(a),season:String(b),from:c,to:d})).response??[]).map(j)}}};