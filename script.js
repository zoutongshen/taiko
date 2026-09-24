// Taiko Metronome Application

// One table driving every per-instrument structure: sequencer rows, pitch and
// volume controls, sample loading. Add an instrument here and it shows up
// everywhere.
const INSTRUMENTS = [
    { id: 'nagado', label: 'Nagado', file: 'split_sounds/Nagado.wav' },
    { id: 'odaiko', label: 'Odaiko', file: 'split_sounds/Odaiko.wav' },
    { id: 'shime',  label: 'Shime',  file: 'split_sounds/Shime.wav' },
    { id: 'click',  label: 'Click',  file: 'split_sounds/Click.wav' },
    { id: 'chappa', label: 'Chappa', file: 'split_sounds/Chappa.wav' },
    { id: 'kane',   label: 'Kane',   file: 'split_sounds/Kane.wav' }
];
const INSTRUMENT_IDS = INSTRUMENTS.map(instrument => instrument.id);
const INSTRUMENT_LABELS = Object.fromEntries(INSTRUMENTS.map(({ id, label }) => [id, label]));

const PITCH_RANGE = { min: -5, max: 5, step: 1 };          // semitones
const VOLUME_RANGE = { min: 0, max: 150, step: 10, default: 100 };  // percent

// A step is a 16th note, so a bar of 4/4 is 16 of them. beatsPerBar is what the
// bar is *counted* in, which is not the same thing: 6/8 is felt in two
// dotted-quarter beats rather than six eighths.
const TIME_SIGNATURES = {
    '4/4': { stepsPerBar: 16, beatsPerBar: 4 },
    '3/4': { stepsPerBar: 12, beatsPerBar: 3 },
    '6/8': { stepsPerBar: 12, beatsPerBar: 2 }
};
const DEFAULT_TIME_SIGNATURE = '4/4';

// A dotted step takes 3/4 of its pair; the step after it gets the rest.
const DOTTED_SPLIT = 0.75;
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 10;

// If the clock falls further behind than this - a backgrounded tab, usually -
// drop the missed steps and pick up the grid again, rather than machine-gunning
// through everything that was skipped.
const RESYNC_THRESHOLD_MS = 250;

const NOTIFICATION_MS = 2000;

// Synthesised stand-ins, used only if the samples fail to load.
const SOUND_PROFILES = {
    nagado: { frequency: 200,  duration: 0.3,  type: 'sine' },
    odaiko: { frequency: 100,  duration: 0.5,  type: 'sine' },
    shime:  { frequency: 400,  duration: 0.15, type: 'sine' },
    click:  { frequency: 600,  duration: 0.2,  type: 'square' },
    chappa: { frequency: 2000, duration: 0.1,  type: 'square' },
    kane:   { frequency: 1500, duration: 0.25, type: 'triangle' }
};

class TaikoMetronome {
    constructor() {
        this.tempo = 120;
        this.isPlaying = false;
        this.isLooping = true;
        this.rhythmType = 'regular';
        this.loopCount = 4;
        this.currentBar = 0;
        this.currentStep = 0;
        this.intervalId = null;
        this.audioContext = null;

        this.timeSignature = DEFAULT_TIME_SIGNATURE;
        this.stepsPerBar = TIME_SIGNATURES[DEFAULT_TIME_SIGNATURE].stepsPerBar;
        this.beatsPerBar = TIME_SIGNATURES[DEFAULT_TIME_SIGNATURE].beatsPerBar;

        // Samples are held twice over: HTML5 Audio routes to the iOS media
        // channel, Web Audio is the fallback when an element has not loaded.
        this.audioElements = this.perInstrument(null);
        this.audioBuffers = this.perInstrument(null);

        this.patterns = this.emptyStepArrays();

        // Dotted-note markers, parallel to patterns. A dot on a step makes that
        // instrument's hit on the following step land late, so the pair splits
        // 3:1 instead of evenly. The grid realigns straight after the pair.
        this.dottedSteps = this.emptyStepArrays();

        // Timeouts for hits a dot has pushed late, so stop() can cancel them.
        this.pendingHits = [];

        // When the current step falls due, kept in absolute time so a long
        // practice session cannot accumulate drift.
        this.nextStepAt = 0;

        this.pitchOffsets = this.perInstrument(0);
        this.volumeLevels = this.perInstrument(VOLUME_RANGE.default);

        // The status line underneath the transport, and the pending restore for
        // whatever notification is currently covering it.
        this.statusText = 'Ready';
        this.notificationTimer = null;

        this.savedPatterns = this.loadSavedPatterns();

        this.initializeAudio();
        this.setupEventListeners();
        this.updateUI();
        this.loadDefaultSounds();
    }

    // How many sequencer steps make up one counted beat.
    get stepsPerBeat() {
        return this.stepsPerBar / this.beatsPerBar;
    }

    // A fresh { instrumentId: value } map.
    perInstrument(value) {
        const map = {};
        INSTRUMENT_IDS.forEach(id => { map[id] = value; });
        return map;
    }

    initializeAudio() {
        // Create and unlock AudioContext on first user interaction
        const unlockAudio = async () => {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            // Resume context if suspended (required for iOS/mobile)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            // Play silent buffer to unlock audio on iOS
            const buffer = this.audioContext.createBuffer(1, 1, 22050);
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioContext.destination);
            source.start(0);
            
            console.log('Audio unlocked, state:', this.audioContext.state);
        };
        
        // Try to unlock on various touch events
        ['touchstart', 'touchend', 'click'].forEach(event => {
            document.addEventListener(event, unlockAudio, { once: true });
        });
    }

    setupEventListeners() {
        // Tempo controls
        const tempoSlider = document.getElementById('tempo-slider');
        const tempoInput = document.getElementById('tempo-input');
        
        tempoSlider.addEventListener('input', (e) => {
            this.tempo = parseInt(e.target.value);
            tempoInput.value = this.tempo;
            if (this.isPlaying) {
                this.stop();
                this.play();
            }
        });

        tempoInput.addEventListener('input', (e) => {
            this.tempo = parseInt(e.target.value);
            tempoSlider.value = this.tempo;
            if (this.isPlaying) {
                this.stop();
                this.play();
            }
        });

        // Rhythm controls
        const rhythmRadios = document.querySelectorAll('input[name="rhythm"]');
        rhythmRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.rhythmType = e.target.value;
                console.log('Rhythm type changed to:', this.rhythmType);
                this.showNotification(`Rhythm: ${this.rhythmType}`);
            });
        });

        // Time signature selector
        const timeSigSelect = document.getElementById('time-sig');
        timeSigSelect.addEventListener('change', (e) => {
            this.applyTimeSignature(e.target.value);
            const dropped = this.regeneratePatternGrid();
            this.showNotification(dropped
                ? `Time signature: ${this.timeSignature} - ${dropped} hit${dropped === 1 ? '' : 's'} past the new bar end were dropped`
                : `Time signature: ${this.timeSignature}`);
        });

        // Save/Load pattern buttons
        document.getElementById('save-pattern-btn').addEventListener('click', () => this.savePattern());
        document.getElementById('load-pattern-btn').addEventListener('click', () => this.loadPattern());
        document.getElementById('delete-pattern-btn').addEventListener('click', () => this.deletePattern());
        
        // Enable/disable load and delete buttons based on selection
        const patternSelect = document.getElementById('saved-patterns');
        const loadBtn = document.getElementById('load-pattern-btn');
        const deleteBtn = document.getElementById('delete-pattern-btn');
        
        patternSelect.addEventListener('change', (e) => {
            const hasSelection = e.target.value !== '';
            console.log('Pattern selection changed:', e.target.value, 'hasSelection:', hasSelection);
            loadBtn.disabled = !hasSelection;
            deleteBtn.disabled = !hasSelection;
            console.log('Load button disabled:', loadBtn.disabled, 'Delete button disabled:', deleteBtn.disabled);
        });

        // Loop controls
        const loopCheckbox = document.getElementById('loop-checkbox');
        const loopCountContainer = document.querySelector('.loop-count-container');
        const loopCountInput = document.getElementById('loop-count');

        loopCheckbox.addEventListener('change', (e) => {
            this.isLooping = e.target.checked;
            loopCountContainer.style.display = this.isLooping ? 'none' : 'flex';
        });

        loopCountInput.addEventListener('input', (e) => {
            this.loopCount = parseInt(e.target.value);
        });

        // Playback controls
        document.getElementById('play-btn').addEventListener('click', () => this.play());
        document.getElementById('stop-btn').addEventListener('click', () => this.stop());

        // Initialize pattern grid
        this.initializePatternGrid();
        
        // Initialize button states
        document.getElementById('load-pattern-btn').disabled = true;
        document.getElementById('delete-pattern-btn').disabled = true;

        // Pattern control buttons
        document.getElementById('clear-pattern-btn').addEventListener('click', () => this.clearAllPatterns());
        document.getElementById('fill-pattern-btn').addEventListener('click', () => this.fillAllPatterns());
        
        this.initializePitchControls();
        document.getElementById('reset-all-pitch-btn').addEventListener('click', () => this.resetAllPitch());
        document.getElementById('reset-all-volume-btn').addEventListener('click', () => this.resetAllVolume());
    }

    initializePitchControls() {
        const container = document.getElementById('pitch-controls');
        container.innerHTML = '';

        INSTRUMENTS.forEach(({ id, label }) => {
            const row = document.createElement('div');
            row.className = 'pitch-row';

            const name = document.createElement('span');
            name.className = 'instrument-label';
            name.textContent = `${label}:`;
            row.appendChild(name);

            row.appendChild(this.buildAdjuster('Pitch', `pitch-${id}`, 'pitch-value',
                direction => this.adjustPitch(id, direction)));
            row.appendChild(this.buildAdjuster('Volume', `volume-${id}`, 'volume-value',
                direction => this.adjustVolume(id, direction)));

            container.appendChild(row);
        });

        this.updatePitchDisplay();
        this.updateVolumeDisplay();
    }

    // A [- value +] cluster wired straight to its handler.
    buildAdjuster(labelText, valueId, valueClass, onAdjust) {
        const group = document.createElement('span');
        group.className = 'control-group';

        const label = document.createElement('span');
        label.className = 'control-label';
        label.textContent = labelText;
        group.appendChild(label);

        const buttonClass = labelText.toLowerCase() + '-btn';

        const down = document.createElement('button');
        down.className = buttonClass;
        down.textContent = '\u2212';
        down.addEventListener('click', () => onAdjust('down'));
        group.appendChild(down);

        const value = document.createElement('span');
        value.className = valueClass;
        value.id = valueId;
        group.appendChild(value);

        const up = document.createElement('button');
        up.className = buttonClass;
        up.textContent = '+';
        up.addEventListener('click', () => onAdjust('up'));
        group.appendChild(up);

        return group;
    }

    updatePitchDisplay() {
        INSTRUMENT_IDS.forEach(id => {
            const offset = this.pitchOffsets[id];
            document.getElementById(`pitch-${id}`).textContent = offset > 0 ? `+${offset}` : `${offset}`;
        });
    }

    updateVolumeDisplay() {
        INSTRUMENT_IDS.forEach(id => {
            document.getElementById(`volume-${id}`).textContent = `${this.volumeLevels[id]}%`;
        });
    }

    savePattern() {
        const nameInput = document.getElementById('pattern-name');
        const name = nameInput.value.trim();
        
        if (!name) {
            this.showNotification('Please enter a pattern name', true);
            return;
        }
        
        this.savedPatterns[name] = {
            patterns: JSON.parse(JSON.stringify(this.patterns)),
            dotted: JSON.parse(JSON.stringify(this.dottedSteps)),
            timeSignature: this.timeSignature,
            stepsPerBar: this.stepsPerBar
        };
        localStorage.setItem('taikoPatterns', JSON.stringify(this.savedPatterns));
        
        this.updatePatternSelect();
        nameInput.value = '';
        this.showNotification(`Pattern "${name}" saved (${this.timeSignature})!`);
    }

    loadPattern() {
        const select = document.getElementById('saved-patterns');
        const name = select.value;
        
        if (!name) {
            this.showNotification('Please select a pattern to load', true);
            return;
        }
        
        if (!this.savedPatterns[name]) return;

        const savedData = this.savedPatterns[name];
        // Oldest saves were the bare patterns object, with no metadata at all.
        const isOldFormat = Array.isArray(savedData.nagado);

        if (isOldFormat) {
            this.patterns = this.normalizeStepArrays(savedData);
            this.dottedSteps = this.emptyStepArrays();
        } else {
            this.applyTimeSignature(savedData.timeSignature || DEFAULT_TIME_SIGNATURE);
            document.getElementById('time-sig').value = this.timeSignature;

            this.patterns = this.normalizeStepArrays(savedData.patterns);
            // Saves made before dotted notes existed simply have none.
            this.dottedSteps = this.normalizeStepArrays(savedData.dotted);
            this.rebuildPatternGrid();
        }

        this.refreshPatternDisplay();

        const timeSigInfo = isOldFormat ? '' : ` (${this.timeSignature})`;
        this.showNotification(`Pattern "${name}" loaded${timeSigInfo}!`);
    }

    deletePattern() {
        const select = document.getElementById('saved-patterns');
        const name = select.value;
        
        if (!name) {
            this.showNotification('Please select a pattern to delete', true);
            return;
        }
        
        if (confirm(`Delete pattern "${name}"?`)) {
            delete this.savedPatterns[name];
            localStorage.setItem('taikoPatterns', JSON.stringify(this.savedPatterns));
            this.updatePatternSelect();
            this.showNotification(`Pattern "${name}" deleted`);
        }
    }

    loadSavedPatterns() {
        const saved = localStorage.getItem('taikoPatterns');
        return saved ? JSON.parse(saved) : {};
    }

    updatePatternSelect() {
        const select = document.getElementById('saved-patterns');
        select.innerHTML = '<option value="">-- Select a saved pattern --</option>';
        
        Object.keys(this.savedPatterns).sort().forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            select.appendChild(option);
        });
    }

    // A false-filled array per instrument, matching the current bar length.
    emptyStepArrays(length = this.stepsPerBar) {
        const arrays = {};
        INSTRUMENT_IDS.forEach(id => { arrays[id] = Array(length).fill(false); });
        return arrays;
    }

    // Read saved step arrays into the current bar length, tolerating older
    // saves that predate the field or used a different time signature.
    normalizeStepArrays(saved) {
        const arrays = this.emptyStepArrays();
        if (!saved) return arrays;

        Object.keys(arrays).forEach(instrument => {
            const savedRow = saved[instrument];
            if (!Array.isArray(savedRow)) return;
            for (let i = 0; i < arrays[instrument].length; i++) {
                arrays[instrument][i] = Boolean(savedRow[i]);
            }
        });
        return arrays;
    }

    async play() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Resume AudioContext if suspended (critical for iOS/mobile)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        this.isPlaying = true;
        this.currentBar = 0;
        this.currentStep = 0;
        this.nextStepAt = performance.now();

        document.getElementById('play-btn').disabled = true;
        document.getElementById('stop-btn').disabled = false;
        this.setStatus('Playing...');

        this.scheduleBeat();
    }

    stop() {
        this.isPlaying = false;
        
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }

        this.pendingHits.forEach(id => clearTimeout(id));
        this.pendingHits = [];

        this.currentStep = 0;
        this.removeStepHighlights();

        document.getElementById('play-btn').disabled = false;
        document.getElementById('stop-btn').disabled = true;
        this.setStatus('Stopped');
        document.getElementById('beat-indicator').textContent = '';
    }

    scheduleBeat() {
        if (!this.isPlaying) return;

        // Check if we should stop (non-looping mode)
        if (!this.isLooping && this.currentBar >= this.loopCount) {
            this.stop();
            return;
        }

        this.playInstruments();
        this.updateBeatIndicator();

        const duration = this.stepDuration(this.currentStep);

        // The bar is just the step counter wrapping; deriving it keeps the two
        // from disagreeing, and makes the bar limit count real bars.
        this.currentStep++;
        if (this.currentStep >= this.stepsPerBar) {
            this.currentStep = 0;
            this.currentBar++;
        }

        // Aim at an absolute time rather than sleeping a fixed span, so a step
        // that fires late steals from its own delay instead of pushing back
        // everything after it. Sleeping fixed spans compounds the error.
        this.nextStepAt += duration;
        const now = performance.now();
        if (now - this.nextStepAt > RESYNC_THRESHOLD_MS) {
            // Too far behind to catch up musically (a backgrounded tab);
            // drop the missed steps instead of firing them all at once.
            this.nextStepAt = now;
        }

        this.intervalId = setTimeout(() => this.scheduleBeat(), Math.max(0, this.nextStepAt - now));
    }

    calculateBeatDuration() {
        return this.stepDuration(this.currentStep);
    }

    stepDuration(stepIndex) {
        // 16 steps in a bar, 4 beats per bar = 4 steps per beat
        // So we need to divide the beat duration by 4
        const baseDuration = (60000 / this.tempo) / 4; // milliseconds per 16th note step

        if (this.rhythmType === 'swing') {
            // Apply swing to pairs of 16th notes (every 2 steps)
            // Use a 3:2 ratio for more musical swing (60/40 split)
            // Even steps are longer (downbeat of pair), odd steps shorter.
            return (stepIndex % 2 === 0) ? baseDuration * 1.2 : baseDuration * 0.8;
        }

        return baseDuration;
    }

    // How late the hit after a dotted step should land. The dotted pair keeps
    // its total length and splits 3:1, so the next step is back on the grid.
    // Derived from the real step durations, so this stays correct under swing.
    dottedDelay(dottedStepIndex) {
        const current = this.stepDuration(dottedStepIndex);
        const next = this.stepDuration((dottedStepIndex + 1) % this.stepsPerBar);
        return Math.max(0, (current + next) * DOTTED_SPLIT - current);
    }

    playInstruments() {
        // A dot on the previous step pushes this instrument's hit late.
        // Dots are per instrument, so the shared clock never moves - only the
        // affected hit does, leaving every other part on the grid.
        const previousStep = (this.currentStep - 1 + this.stepsPerBar) % this.stepsPerBar;
        const delay = this.dottedDelay(previousStep);

        Object.keys(this.patterns).forEach(instrument => {
            if (!this.patterns[instrument][this.currentStep]) return;

            if (delay > 0 && this.dottedSteps[instrument][previousStep]) {
                const untilOnset = Math.max(0, this.nextStepAt + delay - performance.now());
                const timeoutId = setTimeout(() => {
                    this.pendingHits = this.pendingHits.filter(id => id !== timeoutId);
                    this.playSound(instrument);
                }, untilOnset);
                this.pendingHits.push(timeoutId);
            } else {
                this.playSound(instrument);
            }
        });
        this.highlightCurrentStep(this.currentStep);
    }

    async playSound(instrument) {
        const pitchOffset = this.pitchOffsets[instrument] || 0;
        const volumeLevel = (this.volumeLevels[instrument] || 100) / 100;
        
        // Always use HTML5 Audio for iOS media channel routing
        if (this.audioElements[instrument]) {
            const audio = this.audioElements[instrument];
            
            // Clone the audio element to allow overlapping plays
            const clone = audio.cloneNode();
            clone.volume = 0.7 * volumeLevel;
            
            // Apply pitch shift via playbackRate (limited but works in media channel)
            if (pitchOffset !== 0) {
                // HTML5 Audio playbackRate for pitch (not as good as Web Audio but routes correctly)
                clone.playbackRate = Math.pow(2, pitchOffset / 12);
            }
            
            // Play and remove when done
            clone.play().catch(err => console.warn('Audio play failed:', err));
            clone.addEventListener('ended', () => clone.remove());
            
            return;
        }
        
        // Fallback to Web Audio API if HTML5 Audio not loaded
        if (!this.audioContext) {
            console.warn('No audio available');
            return;
        }
        
        // Ensure AudioContext is running
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }

        // Use Web Audio buffer as fallback
        if (this.audioBuffers[instrument]) {
            const source = this.audioContext.createBufferSource();
            source.buffer = this.audioBuffers[instrument];
            
            // Apply pitch shifting
            if (pitchOffset !== 0) {
                // Calculate playback rate: 2^(semitones/12)
                source.playbackRate.value = Math.pow(2, pitchOffset / 12);
            }
            
            // Apply volume adjustment
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 0.7 * volumeLevel;
            
            source.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            source.start(this.audioContext.currentTime);
        } else {
            // Use synthesized sound as fallback
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(this.audioContext.destination);

            const profile = SOUND_PROFILES[instrument];
            oscillator.type = profile.type;
            oscillator.frequency.setValueAtTime(profile.frequency, this.audioContext.currentTime);
            
            // Envelope
            gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + profile.duration);

            oscillator.start(this.audioContext.currentTime);
            oscillator.stop(this.audioContext.currentTime + profile.duration);
        }
    }

    adjustPitch(instrument, direction) {
        const change = direction === 'up' ? PITCH_RANGE.step : -PITCH_RANGE.step;
        const newPitch = this.pitchOffsets[instrument] + change;
        if (newPitch < PITCH_RANGE.min || newPitch > PITCH_RANGE.max) return;

        this.pitchOffsets[instrument] = newPitch;
        this.updatePitchDisplay();
        this.showNotification(`${INSTRUMENT_LABELS[instrument]}: ${newPitch > 0 ? '+' : ''}${newPitch} semitones`);
    }

    resetAllPitch() {
        this.pitchOffsets = this.perInstrument(0);
        this.updatePitchDisplay();
        this.showNotification('All pitch adjustments reset to 0');
    }

    adjustVolume(instrument, direction) {
        const change = direction === 'up' ? VOLUME_RANGE.step : -VOLUME_RANGE.step;
        const newVolume = this.volumeLevels[instrument] + change;
        if (newVolume < VOLUME_RANGE.min || newVolume > VOLUME_RANGE.max) return;

        this.volumeLevels[instrument] = newVolume;
        this.updateVolumeDisplay();
        this.showNotification(`${INSTRUMENT_LABELS[instrument]}: ${newVolume}% volume`);
    }

    resetAllVolume() {
        this.volumeLevels = this.perInstrument(VOLUME_RANGE.default);
        this.updateVolumeDisplay();
        this.showNotification(`All volume levels reset to ${VOLUME_RANGE.default}%`);
    }

    updateBeatIndicator() {
        const indicator = document.getElementById('beat-indicator');
        const beatNum = Math.floor(this.currentStep / this.stepsPerBeat) + 1;

        indicator.textContent = `Bar ${this.currentBar + 1} | Beat ${beatNum} | Step ${this.currentStep + 1}`;
    }

    updateUI() {
        document.getElementById('tempo-slider').value = this.tempo;
        document.getElementById('tempo-input').value = this.tempo;
        document.getElementById('loop-checkbox').checked = this.isLooping;
        document.getElementById('loop-count').value = this.loopCount;
        
        const loopCountContainer = document.querySelector('.loop-count-container');
        loopCountContainer.style.display = this.isLooping ? 'none' : 'flex';
        
        this.updatePatternSelect();
    }



    // The transport state underneath any transient message.
    setStatus(text) {
        this.statusText = text;
        clearTimeout(this.notificationTimer);
        this.notificationTimer = null;

        const statusText = document.getElementById('status-text');
        statusText.textContent = text;
        statusText.style.color = '';
    }

    showNotification(message, isError = false) {
        const statusText = document.getElementById('status-text');
        statusText.textContent = message;
        statusText.style.color = isError ? '#999' : '#cc0000';

        // Always restore the transport state, never whatever message happened
        // to be on screen: two notifications inside the window used to leave
        // the first one stranded there for good.
        clearTimeout(this.notificationTimer);
        this.notificationTimer = setTimeout(() => {
            this.notificationTimer = null;
            statusText.textContent = this.statusText;
            statusText.style.color = '';
        }, NOTIFICATION_MS);
    }

    applyTimeSignature(name) {
        const signature = TIME_SIGNATURES[name];
        this.timeSignature = signature ? name : DEFAULT_TIME_SIGNATURE;
        const resolved = signature || TIME_SIGNATURES[DEFAULT_TIME_SIGNATURE];
        this.stepsPerBar = resolved.stepsPerBar;
        this.beatsPerBar = resolved.beatsPerBar;
    }

    // Rebuild the squares for the current bar length, leaving the pattern alone.
    rebuildPatternGrid() {
        const patternGrid = document.getElementById('pattern-grid');
        patternGrid.innerHTML = '';

        const patternTitle = document.getElementById('pattern-title');
        patternTitle.textContent = `Pattern Sequencer (${this.stepsPerBar} steps) - Tap squares to create rhythm, long-press to dot a note`;

        this.initializePatternGrid();
    }

    // Change of bar length: keep as much of the pattern as still fits rather
    // than silently throwing away work.
    regeneratePatternGrid() {
        const dropped = this.resizeStepArrays();
        this.rebuildPatternGrid();
        this.refreshPatternDisplay();
        return dropped;
    }

    // Fit patterns and dots to the current bar length, reporting how many set
    // steps fell off the end.
    resizeStepArrays() {
        const patterns = this.emptyStepArrays();
        const dotted = this.emptyStepArrays();
        let dropped = 0;

        INSTRUMENT_IDS.forEach(id => {
            const oldPattern = this.patterns[id] || [];
            const oldDotted = this.dottedSteps[id] || [];

            oldPattern.forEach((isSet, i) => {
                if (!isSet) return;
                if (i < this.stepsPerBar) {
                    patterns[id][i] = true;
                    dotted[id][i] = Boolean(oldDotted[i]);
                } else {
                    dropped++;
                }
            });
        });

        this.patterns = patterns;
        this.dottedSteps = dotted;
        return dropped;
    }

    refreshPatternDisplay() {
        INSTRUMENT_IDS.forEach(id => {
            for (let i = 0; i < this.stepsPerBar; i++) this.updatePatternDisplay(id, i);
        });
    }

    initializePatternGrid() {
        const patternGrid = document.getElementById('pattern-grid');

        INSTRUMENTS.forEach(({ id: instrument, label: labelText }) => {
            const row = document.createElement('div');
            row.className = 'pattern-row';

            const label = document.createElement('div');
            label.className = 'pattern-label';
            label.textContent = labelText;

            row.appendChild(label);

            const stepsContainer = document.createElement('div');
            stepsContainer.className = 'pattern-steps';

            for (let i = 0; i < this.stepsPerBar; i++) {
                const step = document.createElement('button');
                step.className = 'pattern-step';
                // Accent the counted beats, wherever they fall in this signature.
                if (i % this.stepsPerBeat === 0) step.classList.add('beat-1');
                step.dataset.instrument = instrument;
                step.dataset.step = i;
                
                this.attachStepHandlers(step, instrument, i);

                stepsContainer.appendChild(step);
            }

            row.appendChild(stepsContainer);
            patternGrid.appendChild(row);
        });
    }

    // Tap toggles the note; long-press (or right-click) toggles its dot.
    attachStepHandlers(step, instrument, stepIndex) {
        let pressTimer = null;
        let longPressed = false;
        let startX = 0;
        let startY = 0;

        const cancelPress = () => {
            clearTimeout(pressTimer);
            pressTimer = null;
        };

        step.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return; // leave right-click to contextmenu
            longPressed = false;
            startX = e.clientX;
            startY = e.clientY;
            pressTimer = setTimeout(() => {
                longPressed = true;
                this.toggleDotted(instrument, stepIndex);
            }, LONG_PRESS_MS);
        });

        // Dragging means the grid is being scrolled, not held.
        step.addEventListener('pointermove', (e) => {
            if (!pressTimer) return;
            const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
            if (moved > LONG_PRESS_SLOP_PX) cancelPress();
        });

        ['pointerup', 'pointerleave', 'pointercancel'].forEach(event => {
            step.addEventListener(event, cancelPress);
        });

        step.addEventListener('click', (e) => {
            // The long press already acted; swallow the tap that follows it.
            if (longPressed) {
                longPressed = false;
                e.preventDefault();
                return;
            }
            this.toggleStep(instrument, stepIndex);
        });

        step.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            cancelPress();
            // Some touch browsers raise this *as well as* the long press.
            if (longPressed) {
                longPressed = false;
                return;
            }
            this.toggleDotted(instrument, stepIndex);
        });
    }

    toggleStep(instrument, stepIndex) {
        this.patterns[instrument][stepIndex] = !this.patterns[instrument][stepIndex];
        // A dot belongs to a note, so it goes when the note does.
        if (!this.patterns[instrument][stepIndex]) {
            this.dottedSteps[instrument][stepIndex] = false;
        }
        this.updatePatternDisplay(instrument, stepIndex);
        // Play sound when activating a step
        if (this.patterns[instrument][stepIndex]) {
            this.playSound(instrument);
        }
    }

    toggleDotted(instrument, stepIndex) {
        // Dotting an empty square fills it first - a dot needs a note to sit on.
        this.patterns[instrument][stepIndex] = true;

        const isDotted = !this.dottedSteps[instrument][stepIndex];
        this.dottedSteps[instrument][stepIndex] = isDotted;
        this.updatePatternDisplay(instrument, stepIndex);

        const label = INSTRUMENT_LABELS[instrument];
        if (!isDotted) {
            this.showNotification(`${label} step ${stepIndex + 1}: dot removed`);
            return;
        }

        // The dot only moves the *next* hit, so say so when there is nothing to move.
        const nextStep = (stepIndex + 1) % this.stepsPerBar;
        const hasFollowingHit = this.patterns[instrument][nextStep];
        this.showNotification(hasFollowingHit
            ? `${label} step ${stepIndex + 1} dotted`
            : `${label} step ${stepIndex + 1} dotted - add a hit on step ${nextStep + 1} to hear it`);

        this.playSound(instrument);
    }

    updatePatternDisplay(instrument, stepIndex) {
        const step = document.querySelector(`.pattern-step[data-instrument="${instrument}"][data-step="${stepIndex}"]`);
        if (step) {
            step.classList.toggle('active', this.patterns[instrument][stepIndex]);
            step.classList.toggle('dotted', this.dottedSteps[instrument][stepIndex]);
        }
    }

    highlightCurrentStep(stepIndex) {
        // Remove previous highlights
        this.removeStepHighlights();
        
        // Add highlight to current step
        const steps = document.querySelectorAll(`.pattern-step[data-step="${stepIndex}"]`);
        steps.forEach(step => step.classList.add('playing'));
    }

    removeStepHighlights() {
        const allSteps = document.querySelectorAll('.pattern-step.playing');
        allSteps.forEach(step => step.classList.remove('playing'));
    }

    clearAllPatterns() {
        this.patterns = this.emptyStepArrays();
        this.dottedSteps = this.emptyStepArrays();
        this.refreshPatternDisplay();
        this.showNotification('All patterns cleared');
    }

    fillAllPatterns() {
        this.patterns = this.emptyStepArrays();
        INSTRUMENT_IDS.forEach(id => this.patterns[id].fill(true));
        this.dottedSteps = this.emptyStepArrays();
        this.refreshPatternDisplay();
        this.showNotification('All patterns filled');
    }

    loadDefaultSounds() {
        // Loaded twice over: HTML5 Audio for iOS media-channel routing, Web
        // Audio as the fallback path.
        INSTRUMENTS.forEach(({ id: instrument, file: soundPath }) => {
            // Create HTML5 Audio element for iOS media channel routing
            const audio = new Audio(soundPath);
            audio.preload = 'auto';
            audio.load();
            this.audioElements[instrument] = audio;
            
            // Also load into Web Audio API for pitch control
            fetch(soundPath)
                .then(response => response.arrayBuffer())
                .then(arrayBuffer => {
                    if (!this.audioContext) {
                        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    }
                    return this.audioContext.decodeAudioData(arrayBuffer);
                })
                .then(buffer => {
                    this.audioBuffers[instrument] = buffer;
                    console.log(`Loaded default sound for ${instrument}: ${soundPath}`);
                })
                .catch(error => {
                    // Silently fail if files don't exist
                    console.log(`Default sound not found for ${instrument}: ${soundPath}`);
                });
        });
    }
}

// Initialize the metronome when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const metronome = new TaikoMetronome();
});
