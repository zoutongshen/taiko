#!/usr/bin/env python3
"""
Audio Beat Splitter
Detects beats in an audio file and splits it into individual hits
"""

import sys
import os

def install_dependencies():
    """Install required packages"""
    import subprocess
    print("Installing required packages (numpy, librosa, soundfile)...")
    print("This may take a minute...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "numpy", "librosa", "soundfile"])
    print("Dependencies installed!")

try:
    import numpy as np
    import librosa
    import soundfile as sf
except ImportError:
    print("Required packages not found. Installing...")
    install_dependencies()
    import numpy as np
    import librosa
    import soundfile as sf

def split_audio_by_beats(input_file, output_dir="split_sounds", threshold=0.3, min_silence=0.1):
    """
    Split audio file by detecting beats/hits
    
    Args:
        input_file: Path to input audio file
        output_dir: Directory to save split files
        threshold: Amplitude threshold for beat detection (0.0-1.0)
        min_silence: Minimum silence duration between beats (seconds)
    """
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"Loading audio file: {input_file}")
    audio, sr = librosa.load(input_file, sr=None)
    
    # Get onset strength (where beats/transients occur)
    onset_env = librosa.onset.onset_strength(y=audio, sr=sr)
    
    # Detect onset frames
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env,
        sr=sr,
        backtrack=True,
        units='frames'
    )
    
    # Convert frames to time
    onset_times = librosa.frames_to_time(onset_frames, sr=sr)
    
    print(f"Found {len(onset_times)} beats/hits")
    
    # Split audio at each onset
    base_name = os.path.splitext(os.path.basename(input_file))[0]
    min_silence_samples = int(min_silence * sr)
    
    for i, start_time in enumerate(onset_times):
        # Determine end time (next onset or end of file)
        if i < len(onset_times) - 1:
            end_time = onset_times[i + 1]
        else:
            end_time = len(audio) / sr
        
        # Convert to sample indices
        start_sample = int(start_time * sr)
        end_sample = int(end_time * sr)
        
        # Extract segment
        segment = audio[start_sample:end_sample]
        
        # Trim silence from the end
        # Find last sample above threshold
        abs_segment = np.abs(segment)
        above_threshold = np.where(abs_segment > threshold * np.max(abs_segment))[0]
        
        if len(above_threshold) > 0:
            last_sound = above_threshold[-1]
            # Add a tail (500ms) after last sound to let it ring out
            tail_samples = int(0.5 * sr)
            end_trim = min(last_sound + tail_samples, len(segment))
            segment = segment[:end_trim]
        
        # Skip very short segments (likely noise)
        if len(segment) < 0.05 * sr:  # Skip segments shorter than 50ms
            continue
        
        # Save segment
        output_file = os.path.join(output_dir, f"{base_name}_hit_{i+1:03d}.wav")
        sf.write(output_file, segment, sr)
        print(f"  Saved: {output_file} ({len(segment)/sr:.3f}s)")
    
    print(f"\nDone! Split into {len(onset_times)} files in '{output_dir}' directory")

def main():
    if len(sys.argv) < 2:
        print("Usage: python split_audio.py <audio_file> [output_dir] [threshold] [min_silence]")
        print("\nExample:")
        print("  python split_audio.py drums.wav")
        print("  python split_audio.py drums.mp3 my_sounds 0.2 0.15")
        print("\nParameters:")
        print("  output_dir: Directory for split files (default: 'split_sounds')")
        print("  threshold: Beat detection sensitivity 0.0-1.0 (default: 0.3, lower=more sensitive)")
        print("  min_silence: Min silence between beats in seconds (default: 0.1)")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "split_sounds"
    threshold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.3
    min_silence = float(sys.argv[4]) if len(sys.argv) > 4 else 0.1
    
    if not os.path.exists(input_file):
        print(f"Error: File '{input_file}' not found")
        sys.exit(1)
    
    split_audio_by_beats(input_file, output_dir, threshold, min_silence)

if __name__ == "__main__":
    main()
