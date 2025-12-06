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
            kiai: Array(16).fill(false),
            chappa: Array(16).fill(false),
            kane: Array(16).fill(false)
        };
        
        this.usePatternMode = false;
        this.currentStep = 0;
        
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
            });
        });

        // Save/Load pattern buttons
        document.getElementById('save-pattern-btn').addEventListener('click', () => this.savePattern());
        document.getElementById('load-pattern-btn').addEventListener('click', () => this.loadPattern());
        document.getElementById('delete-pattern-btn').addEventListener('click', () => this.deletePattern());

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

        // Pattern control buttons
        document.getElementById('clear-pattern-btn').addEventListener('click', () => this.clearAllPatterns());
        document.getElementById('fill-pattern-btn').addEventListener('click', () => this.fillAllPatterns());
        
        // Save/Load pattern buttons
        document.getElementById('save-pattern-btn').addEventListener('click', () => this.savePattern());
        document.getElementById('load-pattern-btn').addEventListener('click', () => this.loadPattern());
        document.getElementById('delete-pattern-btn').addEventListener('click', () => this.deletePattern());
    }

    savePattern() {
        const nameInput = document.getElementById('pattern-name');
        const name = nameInput.value.trim();
        
        if (!name) {
            this.showNotification('Please enter a pattern name', true);
            return;
        }
        
        this.savedPatterns[name] = JSON.parse(JSON.stringify(this.patterns));
        localStorage.setItem('taikoPatterns', JSON.stringify(this.savedPatterns));
        
        this.updatePatternSelect();
        nameInput.value = '';
        this.showNotification(`Pattern "${name}" saved!`);
    }

    loadPattern() {
        const select = document.getElementById('saved-patterns');
        const name = select.value;
        
        if (!name) {
            this.showNotification('Please select a pattern to load', true);
            return;
        }
        
        if (this.savedPatterns[name]) {
            this.patterns = JSON.parse(JSON.stringify(this.savedPatterns[name]));
            
            // Update UI
            Object.keys(this.patterns).forEach(instrument => {
                for (let i = 0; i < 16; i++) {
                    this.updatePatternDisplay(instrument, i);
                }
            });
            
            this.showNotification(`Pattern "${name}" loaded!`);
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

    play() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
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

        // Play selected instruments
        this.playInstruments();

        // Update beat indicator
        this.updateBeatIndicator();

        // Calculate next beat timing
        const beatDuration = this.calculateBeatDuration();
        
        // Move to next beat
        this.currentBeat++;
        this.currentStep++;
        
        if (this.currentStep >= 16) {
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
        
        if (this.rhythmType === 'swing' && this.currentStep % 2 === 0) {
            return baseDuration * 1.5; // Swing feel
        } else if (this.rhythmType === 'swing' && this.currentStep % 2 === 1) {
            return baseDuration * 0.5; // Swing feel
        }
        
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
            
            const gainNode = this.audioContext.createGain();
            gainNode.gain.value = 0.7;
            
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
                kiai: { frequency: 600, duration: 0.2, type: 'square' },
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

    updateBeatIndicator() {
        const indicator = document.getElementById('beat-indicator');
        const beatNum = (this.currentBeat % this.beatsPerBar) + 1;
        const barNum = this.currentBar + 1;
        
        indicator.textContent = `Bar ${barNum} | Beat ${beatNum}`;
        
        // Visual pulse effect
        indicator.style.transform = 'scale(1.2)';
        setTimeout(() => {
            indicator.style.transform = 'scale(1)';
        }, 100);
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

    handleAudioUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const instrument = event.target.dataset.instrument;
        const reader = new FileReader();

        reader.onload = (e) => {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            this.audioContext.decodeAudioData(e.target.result, 
                (buffer) => {
                    this.audioBuffers[instrument] = buffer;
                    this.showNotification(`${instrument} sound loaded successfully!`);
                },
                (error) => {
                    console.error('Error decoding audio:', error);
                    this.showNotification(`Error loading ${instrument} sound`, true);
                }
            );
        };

        reader.readAsArrayBuffer(file);
    }

    resetSound(instrument) {
        this.audioBuffers[instrument] = null;
        const fileInput = document.querySelector(`.audio-upload[data-instrument="${instrument}"]`);
        if (fileInput) fileInput.value = '';
        this.showNotification(`${instrument} reset to default sound`);
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

    initializePatternGrid() {
        const patternGrid = document.getElementById('pattern-grid');
        const instruments = ['nagado', 'odaiko', 'shime', 'kiai', 'chappa', 'kane'];

        instruments.forEach(instrument => {
            const row = document.createElement('div');
            row.className = 'pattern-row';
            
            const label = document.createElement('div');
            label.className = 'pattern-label';
            
            const labelText = document.createElement('span');
            labelText.className = 'pattern-label-text';
            labelText.textContent = instrument.charAt(0).toUpperCase() + instrument.slice(1);
            label.appendChild(labelText);
            
            const audioControls = document.createElement('div');
            audioControls.className = 'pattern-audio-controls';
            
            const uploadLabel = document.createElement('label');
            uploadLabel.className = 'pattern-upload-btn';
            uploadLabel.textContent = '📁';
            uploadLabel.title = 'Load custom sound';
            
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.className = 'audio-upload';
            fileInput.dataset.instrument = instrument;
            fileInput.accept = 'audio/*';
            fileInput.addEventListener('change', (e) => this.handleAudioUpload(e));
            uploadLabel.appendChild(fileInput);
            
            const resetBtn = document.createElement('button');
            resetBtn.className = 'pattern-reset-btn';
            resetBtn.textContent = '↺';
            resetBtn.title = 'Reset to default sound';
            resetBtn.addEventListener('click', () => this.resetSound(instrument));
            
            audioControls.appendChild(uploadLabel);
            audioControls.appendChild(resetBtn);
            label.appendChild(audioControls);
            
            row.appendChild(label);

            const stepsContainer = document.createElement('div');
            stepsContainer.className = 'pattern-steps';

            for (let i = 0; i < 16; i++) {
                const step = document.createElement('button');
                step.className = 'pattern-step';
                if (i % 4 === 0) step.classList.add('beat-1');
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
            this.patterns[instrument] = Array(16).fill(false);
            for (let i = 0; i < 16; i++) {
                this.updatePatternDisplay(instrument, i);
            }
        });
        this.showNotification('All patterns cleared');
    }

    fillAllPatterns() {
        Object.keys(this.patterns).forEach(instrument => {
            this.patterns[instrument] = Array(16).fill(true);
            for (let i = 0; i < 16; i++) {
                this.updatePatternDisplay(instrument, i);
            }
        });
        this.showNotification('All patterns filled');
    }

    loadDefaultSounds() {
        // Auto-load default sound files if they exist
        const defaultSounds = {
            odaiko: 'split_sounds/drum_hit_001.wav',
            nagado: 'split_sounds/drum_hit_005.wav'
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
