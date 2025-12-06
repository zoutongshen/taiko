# Taiko Metronome

A web-based metronome application featuring traditional Japanese Taiko percussion instruments with advanced rhythm and timing controls.

## Features

### Tempo Control
- **Slider Control**: Adjust tempo from 40 to 240 BPM with a smooth slider
- **Number Input**: Enter precise BPM values directly
- **Real-time Updates**: Changes take effect immediately, even during playback

### Instruments
The metronome includes six traditional Taiko percussion sounds:
- **Nagado** - Medium-pitched taiko drum (200 Hz)
- **Odaiko** - Large, deep bass drum (100 Hz)
- **Shime** - High-pitched drum (400 Hz)
- **Kiai** - Shout/vocal sound (600 Hz)
- **Chappa** - High-frequency cymbals (2000 Hz)
- **Kane** - Bell sound (1500 Hz)

Each instrument can be toggled on/off independently, allowing you to create custom combinations.

### Rhythm Types
- **Regular**: Standard even beats
- **Swing**: Alternating long-short rhythm pattern for a swing feel

### Presets
Quick-load configurations for common practice scenarios:
- **Basic Beat**: Simple nagado pattern
- **Full Ensemble**: All instruments playing together
- **Kiai Focus**: Kiai with nagado support
- **Drums Only**: Nagado, odaiko, and shime combination
- **Clear All**: Deselect all instruments

### Loop Control
- **Continuous Loop**: Play indefinitely until stopped
- **Limited Bars**: Set a specific number of bars (1-32) to play before stopping automatically

### Visual Feedback
- Real-time beat indicator showing current bar and beat number
- Visual pulse effect synchronized with the beat
- Status display showing playback state

## Getting Started

### Prerequisites
- A modern web browser with Web Audio API support (Chrome, Firefox, Safari, Edge)
- No installation or build process required

### Running the Application

1. **Open the application**:
   - Simply open `index.html` in your web browser
   - Or use a local web server:
     ```bash
     python3 -m http.server 8000
     ```
     Then navigate to `http://localhost:8000`

2. **Configure your metronome**:
   - Set your desired tempo using the slider or number input
   - Select which instruments you want to hear
   - Choose between regular or swing rhythm
   - Configure loop settings

3. **Start playing**:
   - Click the "▶ Play" button to start the metronome
   - Click the "⏹ Stop" button to stop playback
   - The beat indicator will show your current position

## Usage Tips

### For Practice Sessions
- Start with a single instrument (e.g., Nagado) to get comfortable with the tempo
- Gradually add more instruments to simulate ensemble playing
- Use the swing rhythm to practice jazz-influenced patterns

### For Performance Preparation
- Load the "Full Ensemble" preset to hear all instruments together
- Set a specific number of bars matching your piece length
- Adjust tempo gradually to build speed over multiple practice sessions

### Sound Characteristics
The application uses synthesized sounds with distinct characteristics:
- **Low drums** (Odaiko, Nagado): Deeper, resonant tones
- **High drums** (Shime): Sharp, bright attack
- **Metallic** (Chappa, Kane): Cutting, sustained tones
- **Kiai**: Distinctive square wave for vocal-like quality

## Technical Details

### Audio Implementation
- Built with Web Audio API for precise timing and synthesis
- Oscillator-based sound generation with custom envelopes
- Each instrument has unique frequency, duration, and waveform characteristics

### Browser Compatibility
- Requires Web Audio API support
- Tested on: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

### Performance
- Lightweight and responsive
- Minimal CPU usage
- No external audio files required

## File Structure
```
taiko/
├── index.html      # Main application structure
├── styles.css      # Styling and layout
├── script.js       # Application logic and audio engine
└── README.md       # This file
```

## Future Enhancements
Potential features for future development:
- Save/load custom presets
- More complex rhythm patterns (triplets, polyrhythms)
- Visual metronome with animated graphics
- MIDI output support
- Recording and playback of practice sessions
- Accent patterns and dynamics control

## License
This project is open source and available for educational and personal use.

## Credits
Created as a practice tool for Taiko drummers and percussion enthusiasts.
