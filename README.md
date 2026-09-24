# Taiko Metronome

A web-based pattern sequencer and metronome for Taiko practice, built around
recorded samples of real drums.

No build step, no dependencies, no server required — open `index.html` and it runs.

## Features

### Pattern Sequencer
The heart of the app is a grid: one row per instrument, one column per 16th-note
step. Tap a square to place a hit and build a rhythm. The counted beats of the
bar are outlined in red so you can see where you are.

**Dotted notes** — long-press a square (or right-click on desktop) to dot it.
A dot makes that instrument's hit on the *following* step land late, splitting
the pair 3:1 instead of evenly; the grid realigns straight after the pair. The
dot is drawn on the square, with a tail reaching toward the step it borrows
from.

Dots are per instrument, so one part can lurch while the others stay straight.
A dot with no hit after it makes no sound — there is nothing for it to move —
and the status line will say so.

### Tempo
40–240 BPM, by slider or number entry. Changes take effect immediately, including
mid-playback.

### Instruments
Six sampled Taiko sounds, recorded and sliced from real drums:

| Instrument | Character |
|---|---|
| Nagado | Medium-pitched taiko drum |
| Odaiko | Large, deep bass drum |
| Shime  | High-pitched, sharp attack |
| Click  | Dry click for counting |
| Chappa | Hand cymbals |
| Kane   | Bell |

Each has independent **pitch** (±5 semitones) and **volume** (0–150%) controls.

### Time Signatures
| Signature | Steps per bar | Counted in |
|---|---|---|
| 4/4 | 16 | 4 beats |
| 3/4 | 12 | 3 beats |
| 6/8 | 12 | 2 dotted-quarter beats |

Changing signature keeps as much of your pattern as still fits, and tells you if
anything fell past the new bar end.

### Rhythm
- **Regular** — even steps
- **Swing** — a 3:2 lilt across each pair of steps

Swing and dotted notes compose: a dot on a swung step still lands at the 3:1
point of the real pair.

### Loop Control
Play continuously, or set a number of bars (1–32) to stop after.

### Save & Load
Name a pattern and store it in the browser's localStorage, along with its time
signature and dots. Saved patterns survive a reload and work offline.

## Getting Started

Open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

A local server is worth using — some browsers block `fetch` of the WAV files
from a `file://` page, which drops the app onto its synthesised fallback tones.

## Sound Pipeline

The samples came from recordings in `Sound/`, sliced into one-shots by two
helper scripts (both install their own dependencies on first run):

```bash
python3 split_audio.py    # onset-detect a recording and split it into hits
python3 edit_audio.py     # pitch-shift / brighten a sample
```

Output lands in `split_sounds/`, which is what the app loads.

## Technical Notes

### Audio
Samples play through HTML5 `Audio` elements rather than Web Audio. This is
deliberate: on iOS, Web Audio routes to the *ringer* channel, so it obeys the
silent switch and will not play through the phone speaker. HTML5 `Audio` routes
to the media channel instead. Web Audio is kept as a fallback, with oscillator
synthesis behind that if the samples fail to load entirely.

### Timing
The sequencer aims at an absolute target time for each step rather than sleeping
a fixed span, so a step that fires late steals from its own delay instead of
pushing everything after it back. This keeps a long practice session from
drifting. If the clock falls far behind — a backgrounded tab — the missed steps
are dropped rather than fired off all at once.

The remaining limit is `setTimeout` jitter of a few milliseconds per step. Fixing
that properly needs Web Audio's lookahead scheduling, which is blocked on the iOS
routing problem above. See `ROADMAP.md`.

### Browser Support
Modern Chrome, Firefox, Safari and Edge. Mobile-friendly; the sequencer grid
scrolls sideways on narrow screens.

## File Structure
```
taiko/
├── index.html        # Markup; per-instrument controls are generated, not written out
├── styles.css        # Styling and layout
├── script.js         # Sequencer, audio engine, persistence
├── split_sounds/     # The one-shot samples the app loads
├── Sound/            # Source recordings
├── split_audio.py    # Recording -> individual hits
├── edit_audio.py     # Pitch-shift / brighten a sample
└── ROADMAP.md        # PWA, native app, and BPM-detection plans
```

Instruments are defined once, in the `INSTRUMENTS` table at the top of
`script.js`. Adding one there gives it a sequencer row, pitch and volume
controls, and sample loading.

## Roadmap
See `ROADMAP.md` for the PWA conversion, Capacitor packaging for the App Store
and Play Store, and planned tap-tempo / BPM detection.

## License
Open source, for educational and personal use.

## Credits
Made by Zoutong, as a practice tool for Taiko drummers.
