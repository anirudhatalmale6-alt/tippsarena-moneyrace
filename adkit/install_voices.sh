#!/bin/sh
# Rebuilds the speech environment. Neither the virtualenv nor the two voice
# models are in the repo - together they are ~180 MB of binary that changes
# never, and git is not a model registry.
#
# Run once per machine; narrate.py picks it up from VENV/VOICES.
set -e
DIR="${1:-/tmp/claude-1004/-home-freelancer/9dbe74e0-4297-4b96-ba61-8a7c42919c50/scratchpad}"

python3 -m venv "$DIR/ttsenv"
"$DIR/ttsenv/bin/pip" install --quiet piper-tts

# de_DE-thorsten     TippsArena, German. "high" is worth the extra 50 MB: the
#                    medium voice clips the ends of short words like "eins".
# en_GB-northern...  LuxTipps, English. A neutral English read; the brand is
#                    English end to end, so the voice is too.
"$DIR/ttsenv/bin/python" -m piper.download_voices \
    de_DE-thorsten-high en_GB-northern_english_male-medium \
    --data-dir "$DIR/voices"

echo "voices in $DIR/voices"
