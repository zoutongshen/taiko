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
// A second tap on the same square inside this window is a double-tap.
const DOUBLE_TAP_MS = 300;
// How much louder an accented hit is than the track's normal level.
const ACCENT_GAIN = 1.6;
const LONG_PRESS_SLOP_PX = 10;

// Swing is the share of a 16th-note pair given to its first note: 50 is
// straight, 67 is a triplet feel.
const SWING_RANGE = { min: 50, max: 75, default: 67 };   // percent

const MAX_MEASURES = 16;

// Tracks are added as needed rather than showing every drum up front. The same
// sound can be added more than once - a high and a low nagado, say - since
// each track has its own pitch and volume.
const MAX_TRACKS = 8;
const DEFAULT_TRACKS = ['nagado', 'shime'];

// Playback runs on the audio clock. A short timer wakes up every tick and hands
// Web Audio every hit due within the lookahead window, so main-thread hiccups
// no longer move notes - they only have to be shorter than the window.
const SCHEDULER_TICK_MS = 25;
const LOOKAHEAD_S = 0.12;
const START_DELAY_S = 0.05;

// If the clock falls further behind than this - a backgrounded tab, usually -
// drop the missed steps and pick up the grid again, rather than machine-gunning
// through everything that was skipped.
const RESYNC_THRESHOLD_S = 0.25;

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

// A second of silence as a WAV blob URL. Looping it through an <audio> element
// puts iOS into its media ("playback") audio session, so Web Audio follows the
// media volume and Bluetooth instead of being muted by the ringer switch.
// Plain 16-bit 44.1 kHz, the most ordinary format there is, so no iOS version
// declines to play it.
function createSilentWavUrl(seconds = 1, sampleRate = 44100) {
    const bytesPerSample = 2;
    const dataSize = seconds * sampleRate * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeText = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };

    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);          // fmt chunk size
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerSample, true);  // byte rate
    view.setUint16(32, bytesPerSample, true);               // block align
    view.setUint16(34, 8 * bytesPerSample, true);           // bits per sample
    writeText(36, 'data');
    view.setUint32(40, dataSize, true);
    // The samples are already zero, which is silence at 16 bits.

    return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

class TaikoMetronome {
    constructor() {
        this.tempo = 120;
        this.isPlaying = false;
        this.isLooping = true;
        this.rhythmType = 'regular';
        this.swingPercent = SWING_RANGE.default;
        // With looping off, how many times to play the whole pattern.
        this.loopCount = 4;
        this.currentStep = 0;
        this.currentPass = 0;
        this.audioContext = null;
        this.silentAudio = null;

        this.timeSignature = DEFAULT_TIME_SIGNATURE;
        this.stepsPerBar = TIME_SIGNATURES[DEFAULT_TIME_SIGNATURE].stepsPerBar;
        this.beatsPerBar = TIME_SIGNATURES[DEFAULT_TIME_SIGNATURE].beatsPerBar;
        this.measureCount = 1;

        // Decoded samples, and which ones failed to load (those fall back to a
        // synthesised tone; ones still loading simply stay quiet).
        this.audioBuffers = this.perInstrument(null);
        this.sampleFailed = this.perInstrument(false);

        // The tracks on the grid, in display order. Each owns its sound, pitch,
        // volume, and three flat arrays spanning every measure: steps (hits),
        // accents (louder hits) and dotted. A dot on a step makes that track's hit on the following step
        // land late, so the pair splits 3:1 instead of evenly; the grid
        // realigns straight after the pair.
        this.nextTrackId = 1;
        this.tracks = DEFAULT_TRACKS.map(instrument => this.createTrack(instrument));

        // Scheduler state. nextStepAt is on the audio clock, in seconds.
        this.schedulerId = null;
        this.nextStepAt = 0;
        this.finishing = false;
        // Hits already handed to Web Audio, so stop() can cancel ones not yet
        // sounding, and timers that sync the grid display to the audio.
        this.scheduledSources = new Set();
        this.uiTimers = new Set();
        this.lastMeasureShown = -1;

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

    // Length of the whole pattern, across every measure.
    get totalSteps() {
        return this.stepsPerBar * this.measureCount;
    }

    // A fresh { instrumentId: value } map.
    perInstrument(value) {
        const map = {};
        INSTRUMENT_IDS.forEach(id => { map[id] = value; });
        return map;
    }

    // A new, empty track the length of the current pattern.
    createTrack(instrument, { pitch = 0, volume = VOLUME_RANGE.default, steps, dotted, accents } = {}) {
        return {
            id: this.nextTrackId++,
            instrument,
            pitch,
            volume,
            steps: this.fitSteps(steps),
            dotted: this.fitSteps(dotted),
            accents: this.fitSteps(accents)
        };
    }

    // Copy saved step values into an array of the current pattern length,
    // padding or trimming as needed.
    fitSteps(saved) {
        const steps = Array(this.totalSteps).fill(false);
        if (!Array.isArray(saved)) return steps;
        for (let i = 0; i < steps.length; i++) steps[i] = Boolean(saved[i]);
        return steps;
    }

    findTrack(trackId) {
        return this.tracks.find(track => track.id === trackId);
    }

    // "Nagado", or "Nagado 2" when the same sound is on more than one track.
    trackLabel(track) {
        const same = this.tracks.filter(t => t.instrument === track.instrument);
        const name = INSTRUMENT_LABELS[track.instrument];
        return same.length > 1 ? `${name} ${same.indexOf(track) + 1}` : name;
    }

    ensureAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Everything plays through a limiter, so accents on loud tracks
            // get louder without clipping. Set to leave normal levels alone.
            const limiter = this.audioContext.createDynamicsCompressor();
            limiter.threshold.value = -3;
            limiter.knee.value = 0;
            limiter.ratio.value = 20;
            limiter.attack.value = 0.002;
            limiter.release.value = 0.1;
            limiter.connect(this.audioContext.destination);
            this.output = limiter;
        }
        return this.audioContext;
    }

    // Send Web Audio to the media channel on iOS rather than the ringer, so the
    // silent switch does not mute it and Bluetooth speakers get it. Must run
    // inside a user gesture. Cheap to repeat: it only acts when needed.
    routeToMediaChannel() {
        // Newer Safari lets the page declare it outright...
        try {
            if (navigator.audioSession && navigator.audioSession.type !== 'playback') {
                navigator.audioSession.type = 'playback';
            }
        } catch (err) {
            // Unsupported; the silent loop below covers it.
        }

        // ...but some versions have the setting without honouring it, so
        // always keep the older trick going too: while any media element is
        // playing, iOS moves the whole page into its media session.
        if (!this.silentAudio) {
            this.silentAudio = new Audio(createSilentWavUrl());
            this.silentAudio.loop = true;
            this.silentAudio.preload = 'auto';
            this.silentAudio.setAttribute('playsinline', '');
            this.silentAudio.setAttribute('webkit-playsinline', '');

            // Name the lock-screen "Now Playing" entry the loop creates.
            if ('mediaSession' in navigator && window.MediaMetadata) {
                navigator.mediaSession.metadata = new MediaMetadata({ title: 'Taiko Metronome' });
            }
        }
        if (this.silentAudio.paused) {
            this.silentAudio.play().catch(err => console.warn('Silent keep-alive failed:', err));
        }
    }

    // iOS reports 'interrupted' after a call or Siri; both need a resume.
    resumeAudioContext() {
        const ctx = this.ensureAudioContext();
        if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
            return ctx.resume().catch(err => console.warn('Audio resume failed:', err));
        }
        return null;
    }

    initializeAudio() {
        let unlocked = false;

        // Every tap re-checks the routing, not just the first: iOS can drop
        // the silent loop or suspend the context after a call or an app
        // switch, and only a user gesture is allowed to start them again.
        // touchstart does not count as a gesture for media on iOS, so use
        // the events that do.
        const onGesture = () => {
            const ctx = this.ensureAudioContext();
            this.routeToMediaChannel();
            this.resumeAudioContext();

            if (!unlocked) {
                unlocked = true;
                // A silent buffer finishes unlocking Web Audio on older iOS.
                const source = ctx.createBufferSource();
                source.buffer = ctx.createBuffer(1, 1, 22050);
                source.connect(ctx.destination);
                source.start(0);
            }
        };

        ['touchend', 'click', 'keydown'].forEach(event => {
            document.addEventListener(event, onGesture, { capture: true });
        });

        // Let go of the media session when the page is put away and nothing
        // is playing, so it does not hold the lock screen or pause other
        // apps' music for no reason. The next tap takes it back.
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && !this.isPlaying && this.silentAudio) {
                this.silentAudio.pause();
            }
        });
    }

    setupEventListeners() {
        // Tempo controls
        const tempoSlider = document.getElementById('tempo-slider');
        const tempoInput = document.getElementById('tempo-input');
        
        // The scheduler reads this.tempo for every step, so a change takes
        // effect on the next note without restarting playback.
        const setTempo = (value) => {
            const tempo = parseInt(value, 10);
            const min = parseInt(tempoSlider.min, 10);
            const max = parseInt(tempoSlider.max, 10);
            if (Number.isNaN(tempo) || tempo < min || tempo > max) return false;
            this.tempo = tempo;
            return true;
        };

        tempoSlider.addEventListener('input', (e) => {
            if (setTempo(e.target.value)) tempoInput.value = this.tempo;
        });

        tempoInput.addEventListener('input', (e) => {
            if (setTempo(e.target.value)) tempoSlider.value = this.tempo;
        });

        // Rhythm controls
        const swingContainer = document.getElementById('swing-amount-container');
        const swingSlider = document.getElementById('swing-slider');
        const swingValue = document.getElementById('swing-value');

        const rhythmRadios = document.querySelectorAll('input[name="rhythm"]');
        rhythmRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.rhythmType = e.target.value;
                swingContainer.style.display = this.rhythmType === 'swing' ? 'flex' : 'none';
                this.showNotification(`Rhythm: ${this.rhythmType}`);
            });
        });

        swingSlider.min = SWING_RANGE.min;
        swingSlider.max = SWING_RANGE.max;
        swingSlider.value = this.swingPercent;
        swingValue.textContent = `${this.swingPercent}%`;
        swingSlider.addEventListener('input', (e) => {
            this.swingPercent = parseInt(e.target.value, 10);
            swingValue.textContent = `${this.swingPercent}%`;
        });

        // Time signature selector
        const timeSigSelect = document.getElementById('time-sig');
        timeSigSelect.addEventListener('change', (e) => {
            const oldStepsPerBar = this.stepsPerBar;
            this.applyTimeSignature(e.target.value);
            const dropped = this.regeneratePatternGrid(oldStepsPerBar);
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
            const count = parseInt(e.target.value, 10);
            if (count >= 1) this.loopCount = count;
        });

        // Playback controls
        document.getElementById('play-btn').addEventListener('click', () => this.play());
        document.getElementById('stop-btn').addEventListener('click', () => this.stop());
        document.getElementById('stop-btn').disabled = true;

        // Initialize pattern grid
        this.rebuildPatternGrid();

        // Initialize button states
        document.getElementById('load-pattern-btn').disabled = true;
        document.getElementById('delete-pattern-btn').disabled = true;

        // Pattern control buttons
        document.getElementById('clear-pattern-btn').addEventListener('click', () => this.clearAllPatterns());
        document.getElementById('fill-pattern-btn').addEventListener('click', () => this.fillAllPatterns());
        document.getElementById('add-measure-btn').addEventListener('click', () => this.addMeasure());

        // "+ Add instrument" is a select so phones get their native picker.
        const addTrackSelect = document.getElementById('add-track-select');
        INSTRUMENTS.forEach(({ id, label }) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = label;
            addTrackSelect.appendChild(option);
        });
        addTrackSelect.addEventListener('change', (e) => {
            if (e.target.value) this.addTrack(e.target.value);
            e.target.value = '';
        });

        this.renderTrackList();
    }

    // The track list above the grid: each track's name, pitch, volume and a
    // remove button. The grid itself only shows the notes.
    renderTrackList() {
        const container = document.getElementById('track-list');
        container.innerHTML = '';

        this.tracks.forEach(track => {
            const row = document.createElement('div');
            row.className = 'track-row';

            const name = document.createElement('span');
            name.className = 'instrument-label';
            name.textContent = this.trackLabel(track);
            row.appendChild(name);

            const pitch = this.buildAdjuster('Pitch', 'pitch-value',
                direction => this.adjustPitch(track, direction, pitch.valueEl));
            this.showPitch(track, pitch.valueEl);
            row.appendChild(pitch.group);

            const volume = this.buildAdjuster('Volume', 'volume-value',
                direction => this.adjustVolume(track, direction, volume.valueEl));
            this.showVolume(track, volume.valueEl);
            row.appendChild(volume.group);

            const remove = document.createElement('button');
            remove.className = 'track-remove-btn';
            remove.textContent = '✕';
            remove.title = `Remove ${this.trackLabel(track)}`;
            remove.setAttribute('aria-label', remove.title);
            remove.addEventListener('click', () => this.removeTrack(track.id));
            row.appendChild(remove);

            container.appendChild(row);
        });

        const full = this.tracks.length >= MAX_TRACKS;
        const addTrackSelect = document.getElementById('add-track-select');
        addTrackSelect.disabled = full;
        addTrackSelect.options[0].textContent = full
            ? `${MAX_TRACKS} instruments max`
            : '+ Add instrument';
    }

    addTrack(instrument) {
        if (this.tracks.length >= MAX_TRACKS) {
            this.showNotification(`At most ${MAX_TRACKS} instruments`, true);
            return;
        }
        const track = this.createTrack(instrument);
        this.tracks.push(track);
        this.afterTracksChanged();
        this.playSound(track);
        this.showNotification(`${this.trackLabel(track)} added`);
    }

    removeTrack(trackId) {
        const track = this.findTrack(trackId);
        if (!track) return;
        const label = this.trackLabel(track);
        if (track.steps.some(Boolean) && !confirm(`Remove ${label} and its notes?`)) return;

        this.tracks = this.tracks.filter(t => t.id !== trackId);
        this.afterTracksChanged();
        this.showNotification(`${label} removed`);
    }

    // Labels can change ("Nagado" becomes "Nagado 1"), so redraw both views.
    afterTracksChanged() {
        this.renderTrackList();
        this.rebuildPatternGrid();
        this.refreshPatternDisplay();
    }

    // A [- value +] cluster wired straight to its handler.
    buildAdjuster(labelText, valueClass, onAdjust) {
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
        group.appendChild(value);

        const up = document.createElement('button');
        up.className = buttonClass;
        up.textContent = '+';
        up.addEventListener('click', () => onAdjust('up'));
        group.appendChild(up);

        return { group, valueEl: value };
    }

    showPitch(track, valueEl) {
        valueEl.textContent = track.pitch > 0 ? `+${track.pitch}` : `${track.pitch}`;
    }

    showVolume(track, valueEl) {
        valueEl.textContent = `${track.volume}%`;
    }

    savePattern() {
        const nameInput = document.getElementById('pattern-name');
        const name = nameInput.value.trim();
        
        if (!name) {
            this.showNotification('Please enter a pattern name', true);
            return;
        }
        
        this.savedPatterns[name] = {
            tracks: this.tracks.map(({ instrument, pitch, volume, steps, dotted, accents }) =>
                ({ instrument, pitch, volume, steps: [...steps], dotted: [...dotted], accents: [...accents] })),
            timeSignature: this.timeSignature,
            stepsPerBar: this.stepsPerBar,
            measureCount: this.measureCount
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
            this.measureCount = 1;
            this.tracks = this.tracksFromInstrumentMaps(savedData, null);
        } else {
            this.applyTimeSignature(savedData.timeSignature || DEFAULT_TIME_SIGNATURE);
            document.getElementById('time-sig').value = this.timeSignature;

            // Saves made before measures existed are a single bar.
            const savedMeasures = parseInt(savedData.measureCount, 10);
            this.measureCount = Math.min(MAX_MEASURES, Math.max(1, savedMeasures || 1));

            this.tracks = Array.isArray(savedData.tracks)
                ? savedData.tracks
                    .filter(saved => INSTRUMENT_LABELS[saved.instrument])
                    .slice(0, MAX_TRACKS)
                    .map(saved => this.createTrack(saved.instrument, {
                        pitch: this.clamp(saved.pitch, PITCH_RANGE, 0),
                        volume: this.clamp(saved.volume, VOLUME_RANGE, VOLUME_RANGE.default),
                        steps: saved.steps,
                        dotted: saved.dotted,
                        // Saves from before accents existed simply have none.
                        accents: saved.accents
                    }))
                // Saves from before tracks were keyed by instrument.
                : this.tracksFromInstrumentMaps(savedData.patterns, savedData.dotted);
        }

        if (this.currentStep >= this.totalSteps) this.currentStep = 0;
        this.afterTracksChanged();

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

    // Older saves held one { instrumentId: steps } map for hits and one for
    // dots. Bring back only the instruments that were actually used, falling
    // back to the default tracks if none were.
    tracksFromInstrumentMaps(patterns, dotted) {
        const used = INSTRUMENT_IDS.filter(id =>
            Array.isArray(patterns?.[id]) && patterns[id].some(Boolean));
        const instruments = used.length ? used : DEFAULT_TRACKS;
        return instruments.map(id => this.createTrack(id, {
            steps: patterns?.[id],
            dotted: dotted?.[id]
        }));
    }

    // A saved number, kept inside its range, or the fallback if unusable.
    clamp(value, range, fallback) {
        const number = Number(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(range.max, Math.max(range.min, number));
    }

    async play() {
        if (this.isPlaying) return;

        const ctx = this.ensureAudioContext();
        // Both of these need the user gesture, so they come before any await.
        this.routeToMediaChannel();
        const resumed = this.resumeAudioContext();

        this.isPlaying = true;
        this.finishing = false;
        this.currentStep = 0;
        this.currentPass = 0;
        this.lastMeasureShown = -1;

        document.getElementById('play-btn').disabled = true;
        document.getElementById('stop-btn').disabled = false;
        this.setStatus('Playing...');

        if (resumed) await resumed;
        if (!this.isPlaying) return; // stopped while resuming

        this.nextStepAt = ctx.currentTime + START_DELAY_S;
        this.schedulerTick();
        this.schedulerId = setInterval(() => this.schedulerTick(), SCHEDULER_TICK_MS);
    }

    stop() {
        this.isPlaying = false;
        this.finishing = false;

        clearInterval(this.schedulerId);
        this.schedulerId = null;

        this.uiTimers.forEach(id => clearTimeout(id));
        this.uiTimers.clear();

        // Cancel hits queued for the future; ones already sounding ring out.
        const now = this.audioContext ? this.audioContext.currentTime : 0;
        this.scheduledSources.forEach(entry => {
            if (entry.startAt > now) {
                try { entry.source.stop(); } catch (err) { /* already stopped */ }
                this.scheduledSources.delete(entry);
            }
        });

        this.currentStep = 0;
        this.removeStepHighlights();

        document.getElementById('play-btn').disabled = false;
        document.getElementById('stop-btn').disabled = true;
        this.setStatus('Stopped');
        document.getElementById('beat-indicator').textContent = '';
    }

    // Hand Web Audio every step that falls due inside the lookahead window.
    schedulerTick() {
        if (!this.isPlaying || this.finishing) return;

        const now = this.audioContext.currentTime;
        if (now - this.nextStepAt > RESYNC_THRESHOLD_S) {
            // Too far behind to catch up musically (a backgrounded tab);
            // drop the missed steps instead of firing them all at once.
            this.nextStepAt = now + START_DELAY_S;
        }

        while (this.nextStepAt < now + LOOKAHEAD_S) {
            if (!this.isLooping && this.currentPass >= this.loopCount) {
                // Done: stop once the last step has had its full length.
                this.finishing = true;
                this.runAtAudioTime(this.nextStepAt, () => this.stop());
                return;
            }

            const step = this.currentStep;
            this.scheduleStep(step, this.nextStepAt);

            // Absolute times on the audio clock: nothing accumulates drift.
            this.nextStepAt += this.stepDuration(step) / 1000;
            this.currentStep++;
            if (this.currentStep >= this.totalSteps) {
                this.currentStep = 0;
                this.currentPass++;
            }
        }
    }

    // Queue one step's hits at an exact audio time, and the grid update with it.
    scheduleStep(step, when) {
        // A dot on the previous step pushes this track's hit late. Dots are
        // per track, so the shared clock never moves - only the affected hit
        // does, leaving every other part on the grid.
        const previousStep = (step - 1 + this.totalSteps) % this.totalSteps;
        const dottedOffset = this.dottedDelay(previousStep) / 1000;

        this.tracks.forEach(track => {
            if (!track.steps[step]) return;
            const isPushed = dottedOffset > 0 && track.dotted[previousStep];
            this.playSound(track, isPushed ? when + dottedOffset : when, track.accents[step]);
        });

        this.runAtAudioTime(when, () => this.showPlayhead(step));
    }

    // Run a callback when the audio clock reaches the given time.
    runAtAudioTime(when, callback) {
        const delayMs = Math.max(0, (when - this.audioContext.currentTime) * 1000);
        const timerId = setTimeout(() => {
            this.uiTimers.delete(timerId);
            callback();
        }, delayMs);
        this.uiTimers.add(timerId);
    }

    stepDuration(stepIndex) {
        // A step is a 16th note: a quarter of a beat at the current tempo.
        const baseDuration = (60000 / this.tempo) / 4;

        if (this.rhythmType === 'swing') {
            // Swing each pair of 16ths: the first takes swingPercent of the
            // pair, the second the rest. Pairs always add up to two steps, so
            // every beat still lands on the grid.
            const ratio = this.swingPercent / 100;
            return 2 * baseDuration * (stepIndex % 2 === 0 ? ratio : 1 - ratio);
        }

        return baseDuration;
    }

    // How late the hit after a dotted step should land. The dotted pair keeps
    // its total length and splits 3:1, so the next step is back on the grid.
    // Derived from the real step durations, so this stays correct under swing.
    dottedDelay(dottedStepIndex) {
        const current = this.stepDuration(dottedStepIndex);
        const next = this.stepDuration((dottedStepIndex + 1) % this.totalSteps);
        return Math.max(0, (current + next) * DOTTED_SPLIT - current);
    }

    // Play a track's sound now, or at an exact time on the audio clock.
    playSound(track, when = 0, accented = false) {
        const ctx = this.ensureAudioContext();
        this.resumeAudioContext();

        const instrument = track.instrument;
        const buffer = this.audioBuffers[instrument];
        // Still loading: stay quiet rather than play a stand-in beep.
        if (!buffer && !this.sampleFailed[instrument]) return;

        const startAt = Math.max(when, ctx.currentTime);
        const volumeLevel = (track.volume / 100) * (accented ? ACCENT_GAIN : 1);
        const gainNode = ctx.createGain();
        gainNode.connect(this.output);

        let source;
        if (buffer) {
            source = ctx.createBufferSource();
            source.buffer = buffer;
            // Pitch shift by playback rate: 2^(semitones/12).
            if (track.pitch !== 0) source.playbackRate.value = Math.pow(2, track.pitch / 12);
            gainNode.gain.value = 0.7 * volumeLevel;
            source.connect(gainNode);
            source.start(startAt);
        } else {
            // Synthesised stand-in for a sample that failed to load.
            const profile = SOUND_PROFILES[instrument];
            source = ctx.createOscillator();
            source.type = profile.type;
            source.frequency.setValueAtTime(profile.frequency, startAt);
            gainNode.gain.setValueAtTime(0.3 * volumeLevel || 0.0001, startAt);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + profile.duration);
            source.connect(gainNode);
            source.start(startAt);
            source.stop(startAt + profile.duration);
        }

        const entry = { source, startAt };
        this.scheduledSources.add(entry);
        source.onended = () => {
            this.scheduledSources.delete(entry);
            gainNode.disconnect();
        };
    }

    // Pitch and volume changes play the sound when stopped, so the result can
    // be heard straight away; while playing, the next hit already does that.
    adjustPitch(track, direction, valueEl) {
        const change = direction === 'up' ? PITCH_RANGE.step : -PITCH_RANGE.step;
        const newPitch = track.pitch + change;
        if (newPitch < PITCH_RANGE.min || newPitch > PITCH_RANGE.max) return;

        track.pitch = newPitch;
        this.showPitch(track, valueEl);
        if (!this.isPlaying) this.playSound(track);
        this.showNotification(`${this.trackLabel(track)}: ${newPitch > 0 ? '+' : ''}${newPitch} semitones`);
    }

    adjustVolume(track, direction, valueEl) {
        const change = direction === 'up' ? VOLUME_RANGE.step : -VOLUME_RANGE.step;
        const newVolume = track.volume + change;
        if (newVolume < VOLUME_RANGE.min || newVolume > VOLUME_RANGE.max) return;

        track.volume = newVolume;
        this.showVolume(track, valueEl);
        if (!this.isPlaying) this.playSound(track);
        this.showNotification(`${this.trackLabel(track)}: ${newVolume}% volume`);
    }

    // Move the grid highlight and counter to a step as it sounds.
    showPlayhead(step) {
        this.highlightCurrentStep(step);
        this.updateBeatIndicator(step);

        // Keep the measure being played on screen, once per measure, so it
        // does not fight someone scrolling around to edit.
        const measure = Math.floor(step / this.stepsPerBar);
        if (measure !== this.lastMeasureShown) {
            this.lastMeasureShown = measure;
            if (this.measureCount > 1) {
                const block = document.querySelector(`.measure-block[data-measure="${measure}"]`);
                if (block) block.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }
        }
    }

    updateBeatIndicator(step) {
        const indicator = document.getElementById('beat-indicator');
        const bar = Math.floor(step / this.stepsPerBar);
        const stepInBar = step % this.stepsPerBar;
        const beatNum = Math.floor(stepInBar / this.stepsPerBeat) + 1;

        indicator.textContent = `Bar ${bar + 1}/${this.measureCount} | Beat ${beatNum} | Step ${stepInBar + 1}`;
    }

    // "step 5", or "measure 2 step 5" once there is more than one measure.
    describeStep(step) {
        const stepInBar = step % this.stepsPerBar + 1;
        if (this.measureCount === 1) return `step ${stepInBar}`;
        return `measure ${Math.floor(step / this.stepsPerBar) + 1} step ${stepInBar}`;
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

    // Rebuild the squares for the current pattern size, leaving the pattern alone.
    rebuildPatternGrid() {
        const patternGrid = document.getElementById('pattern-grid');
        patternGrid.innerHTML = '';

        const size = this.measureCount === 1
            ? `${this.stepsPerBar} steps`
            : `${this.measureCount} measures × ${this.stepsPerBar} steps`;
        document.getElementById('pattern-title').textContent =
            `Pattern Sequencer (${size})`;

        this.lastMeasureShown = -1;
        this.initializePatternGrid();

        const addButton = document.getElementById('add-measure-btn');
        if (addButton) addButton.disabled = this.measureCount >= MAX_MEASURES;
    }

    // Change of bar length: keep as much of the pattern as still fits rather
    // than silently throwing away work.
    regeneratePatternGrid(oldStepsPerBar) {
        const dropped = this.resizeStepArrays(oldStepsPerBar);
        this.rebuildPatternGrid();
        this.refreshPatternDisplay();
        return dropped;
    }

    // Fit patterns and dots to the current bar length, measure by measure, so
    // every measure keeps its own start. Reports how many set steps no longer
    // fit in their measure.
    resizeStepArrays(oldStepsPerBar) {
        let dropped = 0;

        this.tracks.forEach(track => {
            const steps = this.fitSteps(null);
            const dotted = this.fitSteps(null);
            const accents = this.fitSteps(null);

            track.steps.forEach((isSet, i) => {
                if (!isSet) return;
                const measure = Math.floor(i / oldStepsPerBar);
                const position = i % oldStepsPerBar;
                if (measure < this.measureCount && position < this.stepsPerBar) {
                    const target = measure * this.stepsPerBar + position;
                    steps[target] = true;
                    dotted[target] = Boolean(track.dotted[i]);
                    accents[target] = Boolean(track.accents[i]);
                } else {
                    dropped++;
                }
            });

            track.steps = steps;
            track.dotted = dotted;
            track.accents = accents;
        });

        if (this.currentStep >= this.totalSteps) this.currentStep = 0;
        return dropped;
    }

    refreshPatternDisplay() {
        this.tracks.forEach(track => {
            for (let i = 0; i < this.totalSteps; i++) this.updatePatternDisplay(track, i);
        });
    }

    initializePatternGrid() {
        const patternGrid = document.getElementById('pattern-grid');

        if (this.tracks.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'pattern-empty';
            empty.textContent = 'No instruments yet - use "+ Add instrument" above to start.';
            patternGrid.appendChild(empty);
            return;
        }

        for (let measure = 0; measure < this.measureCount; measure++) {
            const block = document.createElement('div');
            block.className = 'measure-block';
            block.dataset.measure = measure;
            block.appendChild(this.buildMeasureHeader(measure));

            const firstStep = measure * this.stepsPerBar;

            this.tracks.forEach(track => {
                const row = document.createElement('div');
                row.className = 'pattern-row';

                const label = document.createElement('div');
                label.className = 'pattern-label';
                label.textContent = this.trackLabel(track);
                row.appendChild(label);

                const stepsContainer = document.createElement('div');
                stepsContainer.className = 'pattern-steps';

                for (let offset = 0; offset < this.stepsPerBar; offset++) {
                    // data-step is the index across the whole pattern.
                    const i = firstStep + offset;
                    const step = document.createElement('button');
                    step.className = 'pattern-step';
                    // Accent the counted beats, wherever they fall in this signature.
                    if (offset % this.stepsPerBeat === 0) step.classList.add('beat-1');
                    step.dataset.track = track.id;
                    step.dataset.step = i;

                    this.attachStepHandlers(step, track.id, i);

                    stepsContainer.appendChild(step);
                }

                row.appendChild(stepsContainer);
                block.appendChild(row);
            });

            patternGrid.appendChild(block);
        }
    }

    // "Measure N" with its Duplicate / Delete buttons.
    buildMeasureHeader(measure) {
        const header = document.createElement('div');
        header.className = 'measure-header';

        const title = document.createElement('span');
        title.className = 'measure-title';
        title.textContent = `Measure ${measure + 1}`;
        header.appendChild(title);

        const actions = document.createElement('span');
        actions.className = 'measure-actions';

        const duplicate = document.createElement('button');
        duplicate.className = 'measure-btn';
        duplicate.textContent = 'Duplicate';
        duplicate.disabled = this.measureCount >= MAX_MEASURES;
        duplicate.addEventListener('click', () => this.duplicateMeasure(measure));
        actions.appendChild(duplicate);

        const remove = document.createElement('button');
        remove.className = 'measure-btn measure-delete-btn';
        remove.textContent = 'Delete';
        remove.disabled = this.measureCount <= 1;
        remove.addEventListener('click', () => this.deleteMeasure(measure));
        actions.appendChild(remove);

        header.appendChild(actions);
        return header;
    }

    addMeasure() {
        if (this.insertMeasure(this.measureCount, null)) {
            this.showNotification(`Measure ${this.measureCount} added`);
        }
    }

    duplicateMeasure(measure) {
        if (this.insertMeasure(measure + 1, measure)) {
            this.showNotification(`Measure ${measure + 1} duplicated`);
        }
    }

    // Insert a measure at position `at`: empty, or a copy of measure `copyFrom`.
    insertMeasure(at, copyFrom) {
        if (this.measureCount >= MAX_MEASURES) {
            this.showNotification(`A pattern can have at most ${MAX_MEASURES} measures`, true);
            return false;
        }

        const length = this.stepsPerBar;
        this.tracks.forEach(track => {
            [track.steps, track.dotted, track.accents].forEach(row => {
                const block = copyFrom === null
                    ? Array(length).fill(false)
                    : row.slice(copyFrom * length, (copyFrom + 1) * length);
                row.splice(at * length, 0, ...block);
            });
        });

        this.measureCount++;
        this.afterMeasuresChanged();
        return true;
    }

    deleteMeasure(measure) {
        if (this.measureCount <= 1) return;

        const length = this.stepsPerBar;
        const start = measure * length;
        const hasHits = this.tracks.some(track =>
            track.steps.slice(start, start + length).some(Boolean));
        if (hasHits && !confirm(`Delete measure ${measure + 1} and its notes?`)) return;

        this.tracks.forEach(track => {
            track.steps.splice(start, length);
            track.dotted.splice(start, length);
            track.accents.splice(start, length);
        });

        this.measureCount--;
        this.afterMeasuresChanged();
        this.showNotification(`Measure ${measure + 1} deleted`);
    }

    afterMeasuresChanged() {
        // Playback carries on; just keep its position inside the pattern.
        if (this.currentStep >= this.totalSteps) this.currentStep = 0;
        this.rebuildPatternGrid();
        this.refreshPatternDisplay();
    }

    // Tap toggles the note; long-press (or right-click) toggles its dot.
    // Handlers hold the track id and look the track up when they fire.
    attachStepHandlers(step, trackId, stepIndex) {
        let pressTimer = null;
        // The first tap of a possible double-tap: when, and what the square
        // looked like before it, so the second tap can undo it.
        let lastTap = null;
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
                this.toggleDotted(trackId, stepIndex);
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
            const now = performance.now();
            if (lastTap && now - lastTap.time < DOUBLE_TAP_MS) {
                const before = lastTap.before;
                lastTap = null;
                this.toggleAccent(trackId, stepIndex, before);
                return;
            }

            const track = this.findTrack(trackId);
            if (!track) return;
            lastTap = {
                time: now,
                before: {
                    hit: track.steps[stepIndex],
                    dotted: track.dotted[stepIndex],
                    accent: track.accents[stepIndex]
                }
            };
            this.toggleStep(trackId, stepIndex);
        });

        step.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            cancelPress();
            // Some touch browsers raise this *as well as* the long press.
            if (longPressed) {
                longPressed = false;
                return;
            }
            this.toggleDotted(trackId, stepIndex);
        });
    }

    toggleStep(trackId, stepIndex) {
        const track = this.findTrack(trackId);
        if (!track) return;

        track.steps[stepIndex] = !track.steps[stepIndex];
        // A dot or accent belongs to a note, so it goes when the note does.
        if (!track.steps[stepIndex]) {
            track.dotted[stepIndex] = false;
            track.accents[stepIndex] = false;
        }
        this.updatePatternDisplay(track, stepIndex);

        if (track.steps[stepIndex]) this.playSound(track);
    }

    // Double-tap: put the square back how it was before the first tap undid
    // it, then flip the accent. The note always ends up on.
    toggleAccent(trackId, stepIndex, before) {
        const track = this.findTrack(trackId);
        if (!track) return;

        track.steps[stepIndex] = true;
        track.dotted[stepIndex] = before.hit && before.dotted;
        track.accents[stepIndex] = !(before.hit && before.accent);
        this.updatePatternDisplay(track, stepIndex);

        const label = this.trackLabel(track);
        const accented = track.accents[stepIndex];
        this.showNotification(`${label} ${this.describeStep(stepIndex)}: ${accented ? 'accented' : 'accent removed'}`);
        this.playSound(track, 0, accented);
    }

    toggleDotted(trackId, stepIndex) {
        const track = this.findTrack(trackId);
        if (!track) return;

        // Dotting an empty square fills it first - a dot needs a note to sit on.
        track.steps[stepIndex] = true;
        const isDotted = !track.dotted[stepIndex];
        track.dotted[stepIndex] = isDotted;
        this.updatePatternDisplay(track, stepIndex);

        const label = this.trackLabel(track);
        if (!isDotted) {
            this.showNotification(`${label} ${this.describeStep(stepIndex)}: dot removed`);
            return;
        }

        // The dot only moves the *next* hit, so say so when there is nothing to move.
        const nextStep = (stepIndex + 1) % this.totalSteps;
        this.showNotification(track.steps[nextStep]
            ? `${label} ${this.describeStep(stepIndex)} dotted`
            : `${label} ${this.describeStep(stepIndex)} dotted - add a hit on ${this.describeStep(nextStep)} to hear it`);

        this.playSound(track, 0, track.accents[stepIndex]);
    }

    updatePatternDisplay(track, stepIndex) {
        const step = document.querySelector(`.pattern-step[data-track="${track.id}"][data-step="${stepIndex}"]`);
        if (step) {
            step.classList.toggle('active', track.steps[stepIndex]);
            step.classList.toggle('dotted', track.dotted[stepIndex]);
            step.classList.toggle('accent', track.accents[stepIndex]);
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
        this.tracks.forEach(track => {
            track.steps.fill(false);
            track.dotted.fill(false);
            track.accents.fill(false);
        });
        this.refreshPatternDisplay();
        this.showNotification('All patterns cleared');
    }

    fillAllPatterns() {
        this.tracks.forEach(track => {
            track.steps.fill(true);
            track.dotted.fill(false);
            track.accents.fill(false);
        });
        this.refreshPatternDisplay();
        this.showNotification('All patterns filled');
    }

    loadDefaultSounds() {
        // Decoded into Web Audio buffers, which can be scheduled to the sample.
        INSTRUMENTS.forEach(({ id: instrument, file: soundPath }) => {
            fetch(soundPath)
                .then(response => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return response.arrayBuffer();
                })
                .then(arrayBuffer => this.ensureAudioContext().decodeAudioData(arrayBuffer))
                .then(buffer => {
                    this.audioBuffers[instrument] = buffer;
                })
                .catch(error => {
                    // Fall back to a synthesised tone for this instrument.
                    this.sampleFailed[instrument] = true;
                    console.warn(`Could not load ${soundPath}:`, error);
                });
        });
    }
}

// Initialize the metronome when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const metronome = new TaikoMetronome();
});
