#!/usr/bin/env python3
"""
Audio Editor - Pitch shift and brighten audio files
"""

import sys
import os

try:
    import numpy as np
    import librosa
    import soundfile as sf
except ImportError:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "numpy", "librosa", "soundfile"])
    import numpy as np
    import librosa
    import soundfile as sf

def edit_audio(input_file, output_file=None, pitch_shift=0, brightness=1.0, click_boost=0):
    """
    Edit audio file with pitch shifting, brightness adjustment, and click enhancement
    
    Args:
        input_file: Path to input audio file
        output_file: Path to output file (if None, overwrites input)
        pitch_shift: Semitones to shift pitch (positive = higher, negative = lower)
        brightness: Brightness multiplier (>1 = brighter, <1 = darker)
        click_boost: Attack/transient boost factor (0-10, 0=none, 5=strong)
    """
    
    print(f"Loading: {input_file}")
    audio, sr = librosa.load(input_file, sr=None)
    
    # Apply pitch shift
    if pitch_shift != 0:
        print(f"Pitch shifting by {pitch_shift:+.1f} semitones...")
        audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=pitch_shift)
    
    # Apply click/transient boost
    if click_boost > 0:
        print(f"Boosting attack/click (factor: {click_boost})...")
        # Enhance initial transient (first 50ms)
        transient_samples = int(0.05 * sr)
        if len(audio) > transient_samples:
            # Boost the attack portion
            attack = audio[:transient_samples]
            attack = attack * (1 + click_boost * 0.5)
            audio[:transient_samples] = attack
    
    # Apply brightness (EQ boost to high frequencies)
    if brightness != 1.0:
        print(f"Adjusting brightness (multiplier: {brightness})...")
        # FFT to frequency domain
        fft = np.fft.rfft(audio)
        freqs = np.fft.rfftfreq(len(audio), 1/sr)
        
        # Create brightness curve (boost high frequencies more aggressively)
        # Frequencies above 1.5kHz get boosted progressively
        brightness_curve = np.ones_like(freqs)
        high_freq_mask = freqs > 1500
        brightness_curve[high_freq_mask] = brightness
        # Extra boost for very high frequencies (8kHz+)
        very_high_mask = freqs > 8000
        brightness_curve[very_high_mask] = brightness * 1.5
        
        # Apply brightness curve
        fft = fft * brightness_curve
        audio = np.fft.irfft(fft, n=len(audio))
        
        # Normalize to prevent clipping
        max_val = np.max(np.abs(audio))
        if max_val > 0.99:
            audio = audio * (0.99 / max_val)
    
    # Save
    if output_file is None:
        output_file = input_file
    
    sf.write(output_file, audio, sr)
    print(f"Saved: {output_file}")
    print(f"Duration: {len(audio)/sr:.3f}s")

def main():
    if len(sys.argv) < 2:
        print("Usage: python edit_audio.py <input_file> [pitch_shift] [brightness] [click_boost] [output_file]")
        print("\nExamples:")
        print("  python edit_audio.py drum.wav 2 1.5 3            # +2 semitones, brighter, clickier")
        print("  python edit_audio.py drum.wav 8 3.0 5            # High shime-like sound")
        print("  python edit_audio.py drum.wav 4 2.0 0 bright.wav # Save to new file")
        print("\nParameters:")
        print("  pitch_shift: Semitones to shift (default: 0)")
        print("               +12 = 1 octave higher, -12 = 1 octave lower")
        print("  brightness: High frequency multiplier (default: 1.0)")
        print("              2.0-3.0 = very bright, 0.5-0.8 = darker")
        print("  click_boost: Attack enhancement (default: 0)")
        print("               3-5 = more click/snap, 0 = no enhancement")
        print("  output_file: Output filename (default: overwrites input)")
        sys.exit(1)
    
    input_file = sys.argv[1]
    pitch_shift = float(sys.argv[2]) if len(sys.argv) > 2 else 0
    brightness = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
    click_boost = float(sys.argv[4]) if len(sys.argv) > 4 else 0
    output_file = sys.argv[5] if len(sys.argv) > 5 else None
    
    if not os.path.exists(input_file):
        print(f"Error: File '{input_file}' not found")
        sys.exit(1)
    
    edit_audio(input_file, output_file, pitch_shift, brightness, click_boost)

if __name__ == "__main__":
    main()
