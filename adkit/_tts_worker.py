"""Runs INSIDE the piper virtualenv. Reads a job file, writes one wav per line.

Deliberately separate from everything else: piper needs onnxruntime and its own
interpreter, the renderer needs Pillow on the system one. The two never import
each other - they exchange a JSON job and a directory of wavs, so neither
environment can break the other.

    <venv>/bin/python _tts_worker.py job.json
"""
import json
import pathlib
import sys
import wave

from piper import PiperVoice
from piper.config import SynthesisConfig

job = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
voice = PiperVoice.load(job["model"])
cfg = SynthesisConfig(length_scale=job.get("length_scale", 1.0))

out = pathlib.Path(job["out"])
out.mkdir(parents=True, exist_ok=True)
res = {}
for key, text in job["lines"].items():
    p = out / f"{key}.wav"
    with wave.open(str(p), "wb") as w:
        voice.synthesize_wav(text, w, syn_config=cfg)
    with wave.open(str(p)) as w:
        res[key] = {"file": str(p), "sr": w.getframerate(),
                    "dur": w.getnframes() / w.getframerate()}
sys.stdout.write(json.dumps(res))
