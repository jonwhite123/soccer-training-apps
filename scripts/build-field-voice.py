#!/usr/bin/env python3
"""Regenerate the app's offline cue profiles with Flite 2.2, NumPy and SciPy."""

import argparse
import base64
from math import gcd
from pathlib import Path
import subprocess
import tempfile
from textwrap import wrap

import numpy as np
from scipy import signal
from scipy.io import wavfile


SAMPLE_RATE = 12000
HOP = 120
ORDER = 14
PREEMPHASIS = 0.94
COLORS = ['red', 'orange', 'yellow', 'green', 'blue']
CUES = [
    'left', 'right', 'turn', 'man on', 'time',
    *(f'touch {direction}' for direction in ['left', 'right', 'back', 'forward']),
    *(f'pass {color}' for color in COLORS),
    *(f'turn {turn} dribble {color}' for turn in ['full', 'left', 'right'] for color in COLORS),
]


def filter_frame(segment):
    """Fit a stable all-pole filter and measure the excitation left over."""
    windowed = segment * np.hamming(len(segment))
    start = len(segment) - 1
    corr = np.correlate(windowed, windowed, mode='full')[start : start + ORDER + 1]
    corr *= np.exp(-0.5 * (2 * np.pi * 45 * np.arange(ORDER + 1) / SAMPLE_RATE) ** 2)
    corr[0] += 1e-5
    coefficients = np.zeros(ORDER + 1)
    coefficients[0] = 1
    error = corr[0]
    reflection = []
    for i in range(1, ORDER + 1):
        k = -np.dot(coefficients[:i], corr[i:0:-1]) / error
        k = np.clip(k, -0.995, 0.995)
        reflection.append(k)
        coefficients[1:i] += k * coefficients[i - 1 : 0 : -1].copy()
        coefficients[i] = k
        error *= 1 - k * k
    residual = signal.lfilter(coefficients, [1], segment)
    middle = len(segment) // 2
    level = np.sqrt(np.mean(residual[middle - HOP // 2 : middle + HOP // 2] ** 2))
    return reflection, level


def pitch_frame(segment):
    """Estimate pitch and voicing from short-lag correlation."""
    center = segment[200:500]
    lower = int(SAMPLE_RATE / 320)
    upper = int(SAMPLE_RATE / 90)
    scores = []
    for lag in range(lower, upper + 1):
        previous = segment[200 - lag : 500 - lag]
        scale = np.linalg.norm(center) * np.linalg.norm(previous)
        scores.append(np.dot(center, previous) / max(1e-8, scale))
    peaks = signal.find_peaks(scores)[0]
    best = max((scores[index] for index in peaks), default=0)
    if best <= 0.26:
        return 160, 0
    nearest = next(index for index in peaks if scores[index] > 0.93 * best)
    pitch = SAMPLE_RATE / (lower + nearest)
    return pitch, np.clip((scores[nearest] - 0.26) / 0.52, 0, 1)


def analyze(path):
    source_rate, audio = wavfile.read(path)
    divisor = gcd(SAMPLE_RATE, source_rate)
    audio = signal.resample_poly(audio / 32768.0, SAMPLE_RATE // divisor, source_rate // divisor)
    energy = np.sqrt(signal.convolve(audio ** 2, np.ones(60) / 60, mode='same'))
    active = np.flatnonzero(energy > np.max(energy) * 0.012)
    audio = audio[max(0, active[0] - 160) : active[-1] + 200]
    low_pass = signal.butter(3, 700, fs=SAMPLE_RATE, output='sos')
    pitched = np.pad(signal.sosfilt(low_pass, audio), 360)
    emphasized = np.pad(signal.lfilter([1, -PREEMPHASIS], [1], audio), 288)

    encoded = bytearray()
    for offset in range(0, len(audio), HOP):
        pitch, voiced = pitch_frame(pitched[offset : offset + 720])
        reflection, level = filter_frame(emphasized[offset : offset + 576])
        encoded.extend([
            round(pitch) - 80,
            round(voiced * 127),
            round(35 * np.log10(max(level, 1e-5))) + 175,
            *(round(value * 127) + 127 for value in reflection),
        ])
    return base64.b64encode(encoded).decode('ascii')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--flite', default='flite', help='path to a Flite 2.2 executable')
    args = parser.parse_args()
    lines = []
    with tempfile.TemporaryDirectory() as directory:
        wave = Path(directory) / 'cue.wav'
        for cue in sorted(CUES):
            subprocess.run([args.flite, '-voice', 'slt', '-t', cue, '-o', wave], check=True)
            lines.append(f"    ['{cue}', [")
            lines.extend(f"      '{chunk}'," for chunk in wrap(analyze(wave), 88))
            lines.append("    ].join('')],")

    target = Path(__file__).resolve().parents[1] / 'shared' / 'field-voice.js'
    start = '    // BEGIN GENERATED PROFILES\n'
    end = '    // END GENERATED PROFILES\n'
    before, generated = target.read_text().split(start)
    _, after = generated.split(end)
    target.write_text(before + start + '\n'.join(lines) + '\n' + end + after)


if __name__ == '__main__':
    main()
