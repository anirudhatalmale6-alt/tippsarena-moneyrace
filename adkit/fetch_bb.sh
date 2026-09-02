#!/bin/sh
# Refresh data/bb-raw.json from tippsarena.com.
#
# The bet builder legs shown in a reel are the ones the site is publishing for
# that fixture, not a second opinion computed here - see bbtips.py. This copies
# the read-only exporter up, runs it through wp-cli and brings the JSON back.
#
#   HOST=root@185.103.164.237 ./fetch_bb.sh
set -e
HOST="${HOST:-root@185.103.164.237}"
SITE="${SITE:-/var/www/tippsarena.com}"
DIR="$(cd "$(dirname "$0")" && pwd)"

scp -o StrictHostKeyChecking=no "$DIR/export_bb.php" "$HOST:/tmp/export_bb.php"
ssh -o StrictHostKeyChecking=no "$HOST" \
    "cd $SITE && wp eval-file /tmp/export_bb.php --allow-root" \
    > "$DIR/data/bb-raw.json"

python3 - "$DIR/data/bb-raw.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(f"{len(d)} fixtures written to {sys.argv[1]}")
PY
