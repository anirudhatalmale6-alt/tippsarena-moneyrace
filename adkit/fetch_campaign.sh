#!/bin/sh
# Refresh data/campaign.json from the live database. Read-only: one SELECT.
# Usage: ./fetch_campaign.sh [competition_id]      (default: the open one)
set -e
ID="${1:-}"
WHERE="c.status = 'open' ORDER BY c.locks_at NULLS LAST LIMIT 1"
[ -n "$ID" ] && WHERE="c.id = $ID"
DIR="$(cd "$(dirname "$0")" && pwd)"
ssh root@185.103.164.237 "sudo -u postgres psql -d tippsarena -t -A -c \"
SELECT json_build_object(
  'id', c.id, 'name', c.name, 'type', c.type, 'status', c.status,
  'prize', c.prize_amount, 'currency', c.currency,
  'winner_count', c.winner_count, 'requires_membership', c.requires_membership,
  'opens_at', c.opens_at, 'locks_at', c.locks_at, 'scoring', c.scoring,
  'bot_username', (SELECT value FROM settings WHERE key='bot_username'),
  'channel_invite_url', (SELECT value FROM settings WHERE key='channel_invite_url'),
  'support_handle', (SELECT value FROM settings WHERE key='support_handle'),
  'fixtures', (SELECT json_agg(json_build_object('home',f.home_team,'away',f.away_team,
                 'kickoff',f.kickoff_at,'league',f.league_name) ORDER BY f.kickoff_at)
               FROM competition_fixtures cf JOIN fixtures f ON f.id=cf.fixture_id
               WHERE cf.competition_id=c.id)
) FROM competitions c WHERE $WHERE;\"" \
  | python3 -c 'import json,sys; print(json.dumps(json.loads(sys.stdin.read().strip()),indent=2,ensure_ascii=False))' \
  > "$DIR/data/campaign.json"
python3 "$DIR/campaign.py"
