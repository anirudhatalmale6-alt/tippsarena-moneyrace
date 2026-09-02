#!/usr/bin/env python3
"""The music bed, synthesized here rather than downloaded.

    python3 music.py out.wav --bars 14 --bpm 150

WHY SYNTHESIZED. Two reasons, and the licensing one is the smaller.

The first is that a reel is boring when the picture ignores the sound. Every
cut, every caption and every rung of the progress bar in bbreel.py is placed on
a beat of THIS grid - not near it, on it - and that is only possible if the
tempo is a number I chose rather than one I have to detect from an mp3 and hope
stays steady. `Bed.beat(n)` is the clock the whole video is cut to.

The second is that a music bed on a monetised account is the single most common
reason a reel gets muted, and a muted reel of this format is a dead reel. This
one is generated from sine waves and noise; there is nothing in it to claim.

It is deliberately a simple arrangement - 808, clap, hats, sub, a minor stab -
because that is the genre, and because every element has to survive a phone
speaker. The pumping is real sidechain ducking off the kick, which is most of
what makes a bed of this kind sound current rather than like a ringtone.
"""
from __future__ import annotations

import argparse
import pathlib
import wave

import numpy as np

SR = 44100

#: A minor pentatonic figure, in semitones from the root. Minor because the
#: whole genre is, and pentatonic because nothing in it can clash with the
#: stabs however they land against the sub.
ROOT = 55.0                       # A1
RIFF = [0, 0, 3, 0, 7, 5, 3, 0]
STAB = [0, 3, 7, 3]


def _env(n: int, attack: float, decay: float, sr: int = SR) -> np.ndarray:
    """Percussive envelope: near-instant in, exponential out."""
    a = max(1, int(attack * sr))
    e = np.exp(-np.linspace(0, decay, n))
    e[:a] *= np.linspace(0, 1, a)
    return e


def kick(dur: float, sr: int = SR) -> np.ndarray:
    """808: a sine whose pitch falls from a click to a sub in 60 ms.

    Saturated, and with a beater click on top. Both are there for the same
    measured reason: the first version of this bed put 97% of its power below
    150 Hz, and a phone speaker reproduces almost none of that. A pure sine at
    45 Hz is inaudible on the device every one of these reels is watched on.
    tanh puts harmonics at 90, 135, 180 Hz that a phone CAN move, which is how
    an 808 is heard on a phone at all - and the click carries the timing.
    """
    n = int(dur * sr)
    t = np.arange(n) / sr
    f = 45 + 115 * np.exp(-t * 42)
    x = np.tanh(np.sin(2 * np.pi * np.cumsum(f) / sr) * 2.2) / np.tanh(2.2)
    x = x * _env(n, 0.001, 7.5)
    rng = np.random.default_rng(17)
    click = _hp(rng.standard_normal(n).astype(np.float32), 2600, sr)
    click *= _env(n, 0.0002, 260)
    return (x + click * 0.55).astype(np.float32)


def clap(dur: float, sr: int = SR) -> np.ndarray:
    """Four noise bursts a few milliseconds apart, which is what makes a clap
    sound like hands rather than a snare."""
    n = int(dur * sr)
    rng = np.random.default_rng(7)
    x = np.zeros(n, dtype=np.float32)
    for i, off in enumerate((0.0, 0.011, 0.021, 0.030)):
        s = int(off * sr)
        m = n - s
        if m <= 0:
            continue
        x[s:] += (rng.standard_normal(m) * _env(m, 0.0005, 34)
                  * (1.0 if i == 3 else 0.55)).astype(np.float32)
    # a bandpass by two one-poles, which is enough shaping at this level
    x = _hp(_lp(x, 4200, sr), 900, sr)
    body = np.sin(2 * np.pi * 190 * np.arange(n) / sr) * _env(n, 0.001, 40)
    return (x * 0.9 + body * 0.35).astype(np.float32)


def hat(dur: float, open_: bool = False, sr: int = SR) -> np.ndarray:
    n = int(dur * sr)
    rng = np.random.default_rng(3)
    x = rng.standard_normal(n) * _env(n, 0.0003, 26 if open_ else 90)
    return _hp(x, 7000, sr).astype(np.float32)


def _lp(x: np.ndarray, hz: float, sr: int = SR) -> np.ndarray:
    """One-pole lowpass. Not a filter design - a tone control, which is all any
    of this needs and which cannot go unstable at any cutoff."""
    a = np.exp(-2 * np.pi * hz / sr)
    out = np.empty_like(x, dtype=np.float32)
    z = 0.0
    for i, v in enumerate(x):
        z = v * (1 - a) + z * a
        out[i] = z
    return out


def _hp(x: np.ndarray, hz: float, sr: int = SR) -> np.ndarray:
    return (x - _lp(x, hz, sr)).astype(np.float32)


def _saw(freq: np.ndarray, sr: int = SR) -> np.ndarray:
    ph = np.cumsum(freq) / sr
    return (2 * (ph - np.floor(ph + 0.5))).astype(np.float32)


def sub(note: float, dur: float, sr: int = SR) -> np.ndarray:
    """The bass line. Saturated for the same reason as the kick - a clean sine
    down here is power the listener's speaker throws away."""
    n = int(dur * sr)
    t = np.arange(n) / sr
    x = np.sin(2 * np.pi * note * t) + 0.25 * np.sin(4 * np.pi * note * t)
    x = np.tanh(x * 1.9) / np.tanh(1.9)
    e = np.ones(n, dtype=np.float32)
    e[:int(0.006 * sr)] = np.linspace(0, 1, int(0.006 * sr))
    e[-int(0.02 * sr):] = np.linspace(1, 0, int(0.02 * sr))
    return (x * e).astype(np.float32)


def stab(note: float, dur: float, sr: int = SR) -> np.ndarray:
    """Detuned saws through a falling filter - the one melodic element."""
    n = int(dur * sr)
    f = np.full(n, note, dtype=np.float32)
    x = (_saw(f) + _saw(f * 1.006) + _saw(f * 0.994)) / 3
    x = _lp(x, 4200, sr) * _env(n, 0.004, 9)
    return x.astype(np.float32)


def riser(dur: float, sr: int = SR) -> np.ndarray:
    """Noise sweeping up under a rising sine. Goes before a reveal."""
    n = int(dur * sr)
    t = np.linspace(0, 1, n)
    rng = np.random.default_rng(11)
    nz = _hp(rng.standard_normal(n).astype(np.float32) * t ** 2, 1200, sr)
    tone = np.sin(2 * np.pi * np.cumsum(220 + 900 * t ** 2) / sr) * t ** 3
    return (nz * 0.5 + tone * 0.30).astype(np.float32)


def impact(dur: float = 1.1, sr: int = SR) -> np.ndarray:
    """The hit when a rung lights: a sub boom plus a bright crack."""
    n = int(dur * sr)
    t = np.arange(n) / sr
    boom = np.sin(2 * np.pi * np.cumsum(38 + 90 * np.exp(-t * 26)) / sr)
    boom *= _env(n, 0.001, 6)
    rng = np.random.default_rng(5)
    crack = _hp(rng.standard_normal(n).astype(np.float32), 2500, sr)
    crack *= _env(n, 0.0004, 46)
    return (boom * 0.9 + crack * 0.45).astype(np.float32)


def whoosh(dur: float = 0.42, sr: int = SR) -> np.ndarray:
    """A cut transition: noise swept through a filter that opens then shuts."""
    n = int(dur * sr)
    t = np.linspace(0, 1, n)
    rng = np.random.default_rng(13)
    x = rng.standard_normal(n).astype(np.float32)
    x = _hp(x, 700, sr) * np.sin(np.pi * t) ** 2
    return (x * 0.6).astype(np.float32)


class Bed:
    """A finished bed, and the grid everything else is placed on."""

    def __init__(self, bpm: float, bars: int, sr: int = SR):
        self.bpm, self.bars, self.sr = bpm, bars, sr
        self.spb = 60.0 / bpm                 # seconds per beat
        self.dur = bars * 4 * self.spb
        self.mix = np.zeros(int(self.dur * sr) + sr, dtype=np.float32)
        self.duck = np.ones_like(self.mix)    # sidechain envelope

    # --- the grid -------------------------------------------------------
    def beat(self, n: float) -> float:
        """Seconds at beat `n`, counted from zero. Fractions are legal - 0.5
        is the offbeat, which is where a caption lands if the downbeat is
        already carrying a cut."""
        return n * self.spb

    def bar(self, n: float) -> float:
        return self.beat(n * 4)

    def snap(self, t: float, div: float = 2.0) -> float:
        """The nearest grid point at `div` per beat. Used so nothing is ever
        placed BETWEEN beats by accident - a caption two frames off the hit is
        exactly the sloppiness this whole approach exists to remove."""
        step = self.spb / div
        return round(t / step) * step

    # --- writing into it ------------------------------------------------
    def put(self, x: np.ndarray, at: float, gain: float = 1.0,
            duck: bool = False) -> None:
        i = int(at * self.sr)
        if i < 0:
            x, i = x[-i:], 0
        n = min(len(x), len(self.mix) - i)
        if n <= 0:
            return
        self.mix[i:i + n] += x[:n] * gain
        if duck:
            # A kick does not just play, it makes room. 120 ms of hole,
            # recovering over 300 - which is the pump.
            d = np.ones(int(0.42 * self.sr), dtype=np.float32)
            hold = int(0.12 * self.sr)
            d[:hold] = 0.25
            d[hold:] = np.linspace(0.25, 1.0, len(d) - hold)
            m = min(len(d), len(self.duck) - i)
            if m > 0:
                self.duck[i:i + m] = np.minimum(self.duck[i:i + m], d[:m])


#: Element levels. These are not taste - they were set by measuring the mix
#: through a 500 Hz highpass, which is roughly what a phone speaker gives you.
#: The first arrangement scored -18.5 dB through that filter, meaning the bed
#: essentially vanished on the only device that matters. See balance().
GAIN = {"kick": 0.42, "kick_ghost": 0.33, "clap": 1.15, "hat": 0.68,
        "hat_accent": 0.99, "hat_open": 0.85, "sub": 0.115, "stab": 0.88}


def build(bpm: float = 150, bars: int = 14, seed: int = 0) -> Bed:
    """Kick / clap / hats / sub / stabs, arranged over `bars`.

    The arrangement is not random. Bar 0 is drums only so the hook lands in
    space; the sub enters at bar 1 with the fixture; the stab enters at bar 2
    where the first leg does; and the last bar drops everything but the 808 so
    the call to action is not fighting the music.
    """
    b = Bed(bpm, bars)
    spb = b.spb
    rng = np.random.default_rng(seed)
    K, C = kick(1.0), clap(0.5)
    Hc, Ho = hat(0.11), hat(0.30, open_=True)

    for bar in range(bars):
        t0 = b.bar(bar)
        # 808 on 1 and on the "and" of 3 - the standard trap two, which is what
        # stops a bar of this tempo from marching.
        for pos in (0.0, 2.5):
            b.put(K, t0 + pos * spb, GAIN["kick"], duck=True)
        if bar % 4 == 3:
            b.put(K, t0 + 3.5 * spb, GAIN["kick_ghost"], duck=True)
        # clap on 2 and 4
        for pos in (1.0, 3.0):
            b.put(C, t0 + pos * spb, GAIN["clap"])
        # 16th hats, with a roll every fourth bar so it is not a metronome
        for s in range(16):
            at = t0 + s * spb / 4
            if bar % 4 == 3 and s >= 12:
                for r in range(3):            # triplet roll into the next bar
                    b.put(Hc, at + r * spb / 12, GAIN["hat"] * (0.7 + 0.15 * r))
                continue
            b.put(Ho if s % 8 == 6 else Hc, at,
                  GAIN["hat_open"] if s % 8 == 6 else
                  (GAIN["hat_accent"] if s % 4 == 0
                   else GAIN["hat"] * (0.8 + 0.3 * rng.random())))
        if bar >= 1:
            for i, semi in enumerate(RIFF):
                b.put(sub(ROOT * 2 ** (semi / 12), spb / 2 * 0.92),
                      t0 + i * spb / 2, GAIN["sub"])
        if 2 <= bar < bars - 1:
            for i, semi in enumerate(STAB):
                if (bar + i) % 3 == 0:
                    continue                  # holes, so the riff breathes
                b.put(stab(ROOT * 4 * 2 ** (semi / 12), spb * 0.9),
                      t0 + i * spb, GAIN["stab"])

    # sidechain, then a soft clip for level. tanh rather than a limiter: this
    # is a bed under a voice and captions, not a master.
    b.mix *= b.duck
    b.mix = np.tanh(b.mix * 1.35).astype(np.float32)
    return b


def balance(x: np.ndarray, sr: int = SR) -> dict:
    """What survives a phone speaker, and where the power sits.

    This exists because the balance of a bed like this cannot be judged by
    listening on anything with real bass response. The first arrangement felt
    fine and measured 97% of its power below 150 Hz - meaning that on the
    device these are actually watched on, almost the entire bed was gone. The
    number to watch is `phone_db`: how much quieter the mix gets when
    everything a small speaker cannot move is removed.
    """
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / sr)
    tot = float((np.abs(X) ** 2).sum()) or 1.0
    bands = {}
    for lo, hi, name in ((0, 150, "low"), (150, 2000, "mid"),
                         (2000, 20000, "high")):
        m = (f >= lo) & (f < hi)
        bands[name] = 100 * float((np.abs(X[m]) ** 2).sum()) / tot
    y = np.fft.irfft(np.where(f >= 500, X, 0), len(x))
    full = float(np.sqrt((x ** 2).mean())) or 1e-9
    bands["phone_db"] = 20 * np.log10(float(np.sqrt((y ** 2).mean())) / full)
    bands["peak"] = float(np.abs(x).max())
    return bands


#: A bed that loses more than this through a 500 Hz highpass is one the viewer
#: will not hear. -8 dB is a working figure, not a standard: it is where the
#: rebalanced arrangement landed with the low end still clearly present.
PHONE_FLOOR = -8.0


def write(x: np.ndarray, path: pathlib.Path, sr: int = SR) -> pathlib.Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    a = np.clip(x, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((a * 32767).astype(np.int16).tobytes())
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--bpm", type=float, default=150)
    ap.add_argument("--bars", type=int, default=14)
    a = ap.parse_args()
    bed = build(a.bpm, a.bars)
    write(bed.mix, pathlib.Path(a.out))
    bal = balance(bed.mix)
    print(f"{a.out}  {bed.dur:.2f}s  {a.bars} bars @ {a.bpm} bpm  "
          f"beat = {bed.spb * 1000:.0f} ms")
    print(f"  power  low {bal['low']:.0f}%  mid {bal['mid']:.0f}%  "
          f"high {bal['high']:.0f}%   peak {bal['peak']:.2f}")
    print(f"  through a phone speaker: {bal['phone_db']:+.1f} dB "
          + ("ok" if bal["phone_db"] >= PHONE_FLOOR
             else f"<-- BELOW {PHONE_FLOOR} dB, the bed will not be heard"))
    raise SystemExit(0 if bal["phone_db"] >= PHONE_FLOOR else 1)


if __name__ == "__main__":
    main()
