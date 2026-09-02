#!/bin/sh
# Background footage for reel.py.
#
# Deliberately NOT broadcast clips. His references (billhpicks) run World Cup
# and La Liga footage; that is the part of the format that gets a brand account
# struck rather than merely throttled, and it is not worth it on an account
# that has a paying product behind it. These are Coverr and Mixkit clips, both
# free for commercial use with no attribution required.
#
# Drop his own licensed clips into the same folder and add the filename (no
# extension) to CLIPS in reel.py - nothing else needs to change.
set -e
DIR="${1:-/tmp/claude-1004/-home-freelancer/9dbe74e0-4297-4b96-ba61-8a7c42919c50/scratchpad}/broll"
mkdir -p "$DIR"

# Coverr: crowd for the bookends, warm-up for a pick bed.
for s in cheering-soccer-fans-5833 soccer-warm-up-4701 \
         goalkeeper-during-a-soccer-match-30 soccer-match-with-a-view-4337; do
    [ -s "$DIR/$s.mp4" ] || curl -sL -o "$DIR/$s.mp4" \
        "https://cdn.coverr.co/videos/coverr-$s/1080p.mp4"
done

# Mixkit: the pitch-level ones. 43495 is the floodlit keeper, which is the only
# clip in the set that looks like an evening fixture.
for i in 43483 43484 43495 43499; do
    [ -s "$DIR/mixkit-$i.mp4" ] || curl -sL -o "$DIR/mixkit-$i.mp4" \
        "https://assets.mixkit.co/videos/$i/$i-1080.mp4"
done

ls -la "$DIR"
