// Taiko Metronome Application

class TaikoMetronome {
    constructor() {
        this.tempo = 120;
        this.isPlaying = false;
        this.isLooping = true;
        this.rhythmType = 'regular';
        this.loopCount = 4;
        this.currentBar = 0;
        this.currentBeat = 0;
        this.beatsPerBar = 4;
        this.intervalId = null;
        this.audioContext = null;
        this.instruments = {
            nagado: false,
            odaiko: false,
            shime: false,
            kiai: false,
            chappa: false,
            kane: false
        };
        this.audioBuffers = {
            nagado: null,
            odaiko: null,
            shime: null,
            kiai: null,
            chappa: null,
            kane: null
        };
        
        this.patterns = {
            nagado: Array(16).fill(false),
            odaiko: Array(16).fill(false),
            shime: Array(16).fill(false),
            click: Array(16).fill(false),
            chappa: Array(16).fill(false),
            kane: Array(16).fill(false)
        };
        
        this.usePatternMode = false;
        this.currentStep = 0;
        this.timeSignature = '4/4';
        this.stepsPerBar = 16;
        
        // Pitch adjustments (in semitones, range -5 to +5)
        this.pitchOffsets = {
            nagado: 0,
            odaiko: 0,
            shime: 0,
            click: 0,
            chappa: 0,
            kane: 0
        };
        
        // Volume adjustments (percentage, range 0 to 150)
        this.volumeLevels = {
            nagado: 100,
            odaiko: 100,
            shime: 100,
            click: 100,
            chappa: 100,
            kane: 100
        };
        
        this.savedPatterns = this.loadSavedPatterns();
        
        this.initializeAudio();
        this.setupEventListeners();
        this.updateUI();
        this.loadDefaultSounds();
    }

    initializeAudio() {
        // Create AudioContext on user interaction
        document.addEventListener('click', () => {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                // Resume context if suspended (required for iOS)
                if (this.audioContext.state === 'suspended') {
                    this.audioContext.resume();
                }
            }
        }, { once: true });
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
            this.timeSignature = e.target.value;
            if (this.timeSignature === '4/4') {
                this.stepsPerBar = 16;
            } else if (this.timeSignature === '3/4' || this.timeSignature === '6/8') {
                this.stepsPerBar = 12;
            }
            this.regeneratePatternGrid();
            this.showNotification(`Time signature: ${this.timeSignature}`);
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
        
        // Pitch adjustment buttons
        document.querySelectorAll('.pitch-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const instrument = e.target.dataset.instrument;
                const direction = e.target.dataset.direction;
                this.adjustPitch(instrument, direction);
            });
        });
        
        // Reset all pitch button
        document.getElementById('reset-all-pitch-btn').addEventListener('click', () => this.resetAllPitch());
        
        // Volume adjustment buttons
        document.querySelectorAll('.volume-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const instrument = e.target.dataset.instrument;
                const direction = e.target.dataset.direction;
                this.adjustVolume(instrument, direction);
            });
        });
        
        // Reset all volume button
        document.getElementById('reset-all-volume-btn').addEventListener('click', () => this.resetAllVolume());
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
        
        if (this.savedPatterns[name]) {
            const savedData = this.savedPatterns[name];
            
            // Check if this is old format (just patterns) or new format (with metadata)
            const isOldFormat = Array.isArray(savedData.nagado);
            
            if (isOldFormat) {
                // Old format: just load patterns
                this.patterns = JSON.parse(JSON.stringify(savedData));
            } else {
                // New format: restore time signature and patterns
                const savedTimeSignature = savedData.timeSignature || '4/4';
                const savedStepsPerBar = savedData.stepsPerBar || 16;
                
                // Switch time signature if different
                if (this.timeSignature !== savedTimeSignature) {
                    this.timeSignature = savedTimeSignature;
                    this.stepsPerBar = savedStepsPerBar;
                    
                    // Update the time signature selector
                    const timeSigSelect = document.getElementById('time-sig');
                    timeSigSelect.value = this.timeSignature;
                    
                    // Regenerate grid
                    this.regeneratePatternGrid();
                }
                
                this.patterns = JSON.parse(JSON.stringify(savedData.patterns));
            }
            
            // Update UI
            Object.keys(this.patterns).forEach(instrument => {
                for (let i = 0; i < this.patterns[instrument].length; i++) {
                    this.updatePatternDisplay(instrument, i);
                }
            });
            
            const timeSigInfo = isOldFormat ? '' : ` (${this.timeSignature})`;
            this.showNotification(`Pattern "${name}" loaded${timeSigInfo}!`);
        }
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

    updateInstrumentUI() {
        // No longer needed since we removed instrument checkboxes
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
        this.currentBeat = 0;
        this.currentStep = 0;
        
        document.getElementById('play-btn').disabled = true;
        document.getElementById('stop-btn').disabled = false;
        document.getElementById('status-text').textContent = 'Playing...';

        this.scheduleBeat();
    }

    stop() {
        this.isPlaying = false;
        
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
        }

        this.currentStep = 0;
        this.removeStepHighlights();

        document.getElementById('play-btn').disabled = false;
        document.getElementById('stop-btn').disabled = true;
        document.getElementById('status-text').textContent = 'Stopped';
        document.getElementById('beat-indicator').textContent = '';
    }

    scheduleBeat() {
        if (!this.isPlaying) return;

        // Check if we should stop (non-looping mode)
        if (!this.isLooping && this.currentBar >= this.loopCount) {
            this.stop();
            return;
        }

        // Calculate CURRENT beat timing BEFORE playing
        const beatDuration = this.calculateBeatDuration();

        // Play selected instruments
        this.playInstruments();

        // Update beat indicator
        this.updateBeatIndicator();
        
        // Move to next beat
        this.currentBeat++;
        this.currentStep++;
        
        if (this.currentStep >= this.stepsPerBar) {
            this.currentStep = 0;
        }
        
        if (this.currentBeat >= this.beatsPerBar) {
            this.currentBeat = 0;
            this.currentBar++;
        }

        // Schedule next beat
        this.intervalId = setTimeout(() => this.scheduleBeat(), beatDuration);
    }

    calculateBeatDuration() {
        // 16 steps in a bar, 4 beats per bar = 4 steps per beat
        // So we need to divide the beat duration by 4
        const baseDuration = (60000 / this.tempo) / 4; // milliseconds per 16th note step
        
        console.log(`Beat calc - rhythmType: ${this.rhythmType}, currentStep: ${this.currentStep}`);
        
        if (this.rhythmType === 'swing') {
            // Apply swing to pairs of 16th notes (every 2 steps)
            // Use a 3:2 ratio for more musical swing (60/40 split)
            // Steps 0,2,4,6,8,10,12,14 are longer (downbeat of pair)
            // Steps 1,3,5,7,9,11,13,15 are shorter (upbeat of pair)
            const duration = (this.currentStep % 2 === 0) ? baseDuration * 1.2 : baseDuration * 0.8;
            console.log(`SWING APPLIED: step ${this.currentStep}, duration ${duration.toFixed(1)}ms (base: ${baseDuration.toFixed(1)}ms)`);
            return duration;
        }
        
        console.log(`Regular timing: ${baseDuration.toFixed(1)}ms`);
        return baseDuration;
    }

    playInstruments() {
        // Play instruments that have a beat set at current step
        Object.keys(this.patterns).forEach(instrument => {
            if (this.patterns[instrument][this.currentStep]) {
                this.playSound(instrument);
            }
        });
        this.highlightCurrentStep(this.currentStep);
    }

    playSound(instrument) {
        if (!this.audioContext) return;

        // If custom audio buffer exists, use it
        if (this.audioBuffers[instrument]) {
            const source = this.audioContext.createBufferSource();
            source.buffer = this.audioBuffers[instrument];
            
            // Apply pitch shifting
            const pitchOffset = this.pitchOffsets[instrument] || 0;
            if (pitchOffset !== 0) {
                // Calculate playback rate: 2^(semitones/12)
                source.playbackRate.value = Math.pow(2, pitchOffset / 12);
            }
            
            // Apply volume adjustment
            const gainNode = this.audioContext.createGain();
            const volumeLevel = (this.volumeLevels[instrument] || 100) / 100;
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

            // Different frequencies and envelopes for different instruments
            const soundProfiles = {
                nagado: { frequency: 200, duration: 0.3, type: 'sine' },
                odaiko: { frequency: 100, duration: 0.5, type: 'sine' },
                shime: { frequency: 400, duration: 0.15, type: 'sine' },
                click: { frequency: 600, duration: 0.2, type: 'square' },
                chappa: { frequency: 2000, duration: 0.1, type: 'square' },
                kane: { frequency: 1500, duration: 0.25, type: 'triangle' }
            };

            const profile = soundProfiles[instrument];
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
        const change = direction === 'up' ? 1 : -1;
        const newPitch = this.pitchOffsets[instrument] + change;
        
        // Limit range to -5 to +5 semitones
        if (newPitch >= -5 && newPitch <= 5) {
            this.pitchOffsets[instrument] = newPitch;
            document.getElementById(`pitch-${instrument}`).textContent = newPitch > 0 ? `+${newPitch}` : newPitch;
            this.showNotification(`${instrument}: ${newPitch > 0 ? '+' : ''}${newPitch} semitones`);
        }
    }

    resetAllPitch() {
        Object.keys(this.pitchOffsets).forEach(instrument => {
            this.pitchOffsets[instrument] = 0;
            document.getElementById(`pitch-${instrument}`).textContent = '0';
        });
        this.showNotification('All pitch adjustments reset to 0');
    }

    adjustVolume(instrument, direction) {
        const change = direction === 'up' ? 10 : -10;
        const newVolume = this.volumeLevels[instrument] + change;
        
        // Limit range to 0 to 150%
        if (newVolume >= 0 && newVolume <= 150) {
            this.volumeLevels[instrument] = newVolume;
            document.getElementById(`volume-${instrument}`).textContent = `${newVolume}%`;
            this.showNotification(`${instrument}: ${newVolume}% volume`);
        }
    }

    resetAllVolume() {
        Object.keys(this.volumeLevels).forEach(instrument => {
            this.volumeLevels[instrument] = 100;
            document.getElementById(`volume-${instrument}`).textContent = '100%';
        });
        this.showNotification('All volume levels reset to 100%');
    }

    updateBeatIndicator() {
        const indicator = document.getElementById('beat-indicator');
        const beatNum = (this.currentBeat % this.beatsPerBar) + 1;
        const barNum = this.currentBar + 1;
        
        indicator.textContent = `Bar ${barNum} | Beat ${beatNum} | Step ${this.currentStep + 1}`;
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



    showNotification(message, isError = false) {
        const statusText = document.getElementById('status-text');
        const originalText = statusText.textContent;
        const originalColor = statusText.style.color;
        
        statusText.textContent = message;
        statusText.style.color = isError ? '#999' : '#cc0000';
        
        setTimeout(() => {
            statusText.textContent = originalText;
            statusText.style.color = originalColor;
        }, 2000);
    }

    regeneratePatternGrid() {
        // Clear and rebuild pattern grid
        const patternGrid = document.getElementById('pattern-grid');
        patternGrid.innerHTML = '';
        
        // Reset patterns to new length
        Object.keys(this.patterns).forEach(instrument => {
            this.patterns[instrument] = Array(this.stepsPerBar).fill(false);
        });
        
        // Update title
        const patternTitle = document.getElementById('pattern-title');
        patternTitle.textContent = `Pattern Sequencer (${this.stepsPerBar} steps) - Click squares to create rhythm`;
        
        this.initializePatternGrid();
    }

    initializePatternGrid() {
        const patternGrid = document.getElementById('pattern-grid');
        const instruments = ['nagado', 'odaiko', 'shime', 'click', 'chappa', 'kane'];

        instruments.forEach(instrument => {
            const row = document.createElement('div');
            row.className = 'pattern-row';
            
            const label = document.createElement('div');
            label.className = 'pattern-label';
            label.textContent = instrument.charAt(0).toUpperCase() + instrument.slice(1);
            
            row.appendChild(label);

            const stepsContainer = document.createElement('div');
            stepsContainer.className = 'pattern-steps';

            for (let i = 0; i < this.stepsPerBar; i++) {
                const step = document.createElement('button');
                step.className = 'pattern-step';
                // Highlight beats based on time signature
                if (this.timeSignature === '4/4') {
                    // Every 4 steps (beat 1, 5, 9, 13)
                    if (i % 4 === 0) step.classList.add('beat-1');
                } else if (this.timeSignature === '3/4') {
                    // Every 3 steps (beat 1, 4, 7, 10)
                    if (i % 3 === 0) step.classList.add('beat-1');
                } else if (this.timeSignature === '6/8') {
                    // Only 1st and 7th steps (two groups of 6 eighth notes)
                    if (i === 0 || i === 6) step.classList.add('beat-1');
                }
                step.dataset.instrument = instrument;
                step.dataset.step = i;
                
                step.addEventListener('click', (e) => {
                    this.toggleStep(instrument, i);
                });

                stepsContainer.appendChild(step);
            }

            row.appendChild(stepsContainer);
            patternGrid.appendChild(row);
        });
    }

    toggleStep(instrument, stepIndex) {
        this.patterns[instrument][stepIndex] = !this.patterns[instrument][stepIndex];
        this.updatePatternDisplay(instrument, stepIndex);
        // Play sound when activating a step
        if (this.patterns[instrument][stepIndex]) {
            this.playSound(instrument);
        }
    }

    updatePatternDisplay(instrument, stepIndex) {
        const step = document.querySelector(`.pattern-step[data-instrument="${instrument}"][data-step="${stepIndex}"]`);
        if (step) {
            if (this.patterns[instrument][stepIndex]) {
                step.classList.add('active');
            } else {
                step.classList.remove('active');
            }
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
        Object.keys(this.patterns).forEach(instrument => {
            this.patterns[instrument] = Array(this.stepsPerBar).fill(false);
            for (let i = 0; i < this.stepsPerBar; i++) {
                this.updatePatternDisplay(instrument, i);
            }
        });
        this.showNotification('All patterns cleared');
    }

    fillAllPatterns() {
        Object.keys(this.patterns).forEach(instrument => {
            this.patterns[instrument] = Array(this.stepsPerBar).fill(true);
            for (let i = 0; i < this.stepsPerBar; i++) {
                this.updatePatternDisplay(instrument, i);
            }
        });
        this.showNotification('All patterns filled');
    }

    loadDefaultSounds() {
        // Auto-load default sound files if they exist
        const defaultSounds = {
            nagado: 'split_sounds/Nagado.wav',
            odaiko: 'split_sounds/Odaiko.wav',
            shime: 'split_sounds/Shime.wav',
            click: 'split_sounds/Click.wav',
            chappa: 'split_sounds/Chappa.wav',
            kane: 'split_sounds/Kane.wav'
        };

        Object.keys(defaultSounds).forEach(instrument => {
            const soundPath = defaultSounds[instrument];
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
