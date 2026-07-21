/**
 * ============================================================================
 * CYOA AUDIO STUDIO PLAYER - ENGINE & UI CONTROLLER
 * Client-Side Interactive Branching Audio Engine
 * ============================================================================
 */

'use strict';

/* ============================================================================
   1. SOUND ENGINE (Synthesizes Soft Church Bell & UI Audio Effects via Web Audio)
   ============================================================================ */
class SoundEngine {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Synthesizes a soft, warm church bell chime using FM/Additive synthesis
   * No external sound files required!
   */
  playChurchBell() {
    this.init();
    const now = this.ctx.currentTime;
    
    // Master Bell Gain Node
    const masterGain = this.ctx.createGain();
    masterGain.gain.setValueAtTime(0.35, now);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);

    // Warm Low-pass Filter to give the bell a soft, non-harsh tone
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, now);

    filter.connect(masterGain);
    masterGain.connect(this.ctx.destination);

    // Harmonic partial ratios for a cathedral tubular/church bell
    const baseFreq = 280; // D4-ish pitch
    const partials = [
      { ratio: 0.5, gain: 0.35, decay: 3.2 },  # Hum tone
      { ratio: 1.0, gain: 0.70, decay: 2.8 },  # Prime fundamental
      { ratio: 1.2, gain: 0.45, decay: 2.2 },  # Tierce (minor 3rd)
      { ratio: 1.5, gain: 0.35, decay: 1.8 },  # Quint (5th)
      { ratio: 2.0, gain: 0.50, decay: 1.5 },  # Nominal octave
      { ratio: 2.76, gain: 0.20, decay: 1.0 }, # Higher chime partial
      { ratio: 3.0, gain: 0.15, decay: 0.8 }   # Superoctave
    ];

    partials.forEach(p => {
      const osc = this.ctx.createOscillator();
      const pGain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * p.ratio, now);

      pGain.gain.setValueAtTime(p.gain, now);
      pGain.gain.exponentialRampToValueAtTime(0.0001, now + p.decay);

      osc.connect(pGain);
      pGain.connect(filter);

      osc.start(now);
      osc.stop(now + p.decay);
    });
  }

  /**
   * Gentle acoustic click sound for choice selection & buttons
   */
  playClick() {
    try {
      this.init();
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(200, now + 0.04);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.04);
    } catch (e) {
      // Ignore audio context autoplay restrictions on soft click
    }
  }
}

/* ============================================================================
   2. CYOA PARSER (Reads & Validates ZIP / .cyoa Packages)
   ============================================================================ */
class CYOAParser {
  /**
   * Unzips a .cyoa file in memory and extracts story.json and assets
   */
  static async parsePackage(file) {
    if (typeof JSZip === 'undefined') {
      throw new Error("JSZip library failed to load. Check internet connection or script tag.");
    }

    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (err) {
      throw new Error("The selected file is not a valid ZIP/.cyoa archive.");
    }

    // 1. Locate story.json (supports root or nested folder)
    let jsonEntry = zip.file("story.json");
    if (!jsonEntry) {
      const matches = zip.file(/story\.json$/i);
      if (matches.length > 0) jsonEntry = matches[0];
    }

    if (!jsonEntry) {
      throw new Error("Invalid .cyoa archive: 'story.json' was not found inside the file.");
    }

    const jsonText = await jsonEntry.async("string");
    let storyData;
    try {
      storyData = JSON.parse(jsonText);
    } catch (err) {
      throw new Error("Invalid 'story.json' format: File contains JSON syntax errors.");
    }

    // 2. Validate Story Data Schema
    if (!storyData.title) storyData.title = "Untitled CYOA Story";
    if (!storyData.author) storyData.author = "Unknown Author";
    if (!storyData.scenes || typeof storyData.scenes !== 'object') {
      throw new Error("Invalid story structure: 'scenes' object is missing.");
    }

    if (!storyData.start || !storyData.scenes[storyData.start]) {
      const sceneKeys = Object.keys(storyData.scenes);
      if (sceneKeys.length === 0) {
        throw new Error("Invalid story structure: No scenes defined.");
      }
      storyData.start = sceneKeys[0]; // Fallback to first scene
    }

    // Return story payload along with zip reference for asset extraction
    return { storyData, zip };
  }

  /**
   * Extracts an audio asset from the ZIP archive and returns a local Object URL
   */
  static async extractAudioBlobUrl(zip, relativePath) {
    if (!relativePath) return null;

    // Sanitize path separators
    const normalizedPath = relativePath.replace(/\\/g, '/');
    let fileEntry = zip.file(normalizedPath);

    if (!fileEntry) {
      // Try searching recursively for audio file by name
      const fileName = normalizedPath.split('/').pop().toLowerCase();
      const matches = zip.file(new RegExp(fileName + '$', 'i'));
      if (matches.length > 0) fileEntry = matches[0];
    }

    if (!fileEntry) {
      console.warn(`Audio file missing in zip: ${relativePath}`);
      return null;
    }

    const blob = await fileEntry.async("blob");
    return URL.createObjectURL(blob);
  }

  /**
   * Extracts optional scene artwork image from the ZIP archive
   */
  static async extractImageBlobUrl(zip, relativePath) {
    if (!relativePath) return null;
    const normalizedPath = relativePath.replace(/\\/g, '/');
    let fileEntry = zip.file(normalizedPath);
    
    if (!fileEntry) {
      const fileName = normalizedPath.split('/').pop().toLowerCase();
      const matches = zip.file(new RegExp(fileName + '$', 'i'));
      if (matches.length > 0) fileEntry = matches[0];
    }

    if (!fileEntry) return null;
    const blob = await fileEntry.async("blob");
    return URL.createObjectURL(blob);
  }
}

/* ============================================================================
   3. AUDIO VISUALIZER (Canvas Frequency Wave Animation)
   ============================================================================ */
class AudioVisualizer {
  constructor(canvasElement, audioElement, soundEngine) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.audio = audioElement;
    this.soundEngine = soundEngine;
    this.analyser = null;
    this.source = null;
    this.animationFrame = null;
  }

  setup() {
    if (this.analyser) return;
    try {
      this.soundEngine.init();
      const audioCtx = this.soundEngine.ctx;
      this.analyser = audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      
      this.source = audioCtx.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(audioCtx.destination);
    } catch (e) {
      // Handle browser audio context reconnects gracefully
    }
  }

  start() {
    this.setup();
    this.draw();
  }

  stop() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
    this.drawIdleState();
  }

  draw() {
    this.animationFrame = requestAnimationFrame(() => this.draw());
    if (!this.analyser) {
      this.drawIdleState();
      return;
    }

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const width = this.canvas.width;
    const height = this.canvas.height;
    this.ctx.clearRect(0, 0, width, height);

    const barWidth = (width / bufferLength) * 1.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * height * 0.8;
      
      // Warm amber gold visualizer colors
      const gradient = this.ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#d97706');
      gradient.addColorStop(1, '#f59e0b');

      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(x, height - barHeight, barWidth - 2, barHeight);

      x += barWidth + 1;
    }
  }

  drawIdleState() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    this.ctx.clearRect(0, 0, width, height);

    // Draw a subtle flat central audio line
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(0, height / 2);
    this.ctx.lineTo(width, height / 2);
    this.ctx.stroke();
  }
}

/* ============================================================================
   4. CYOA PLAYER APP CONTROLLER (Main Game Loop & State Manager)
   ============================================================================ */
class CYOAPlayerApp {
  constructor() {
    this.soundEngine = new SoundEngine();
    this.storyData = null;
    this.zipArchive = null;
    this.currentSceneId = null;
    
    // Future Compatibility State Storage
    this.state = {
      variables: {},
      history: [],
      visitedScenes: new Set()
    };

    // Active Object URLs to revoke when loading new file
    this.activeObjectUrls = [];

    // Delay & Timer handles
    this.bellDelayTimer = null;
    this.timedChoiceInterval = null;
    this.timeRemaining = 0;

    this.initDOMReferences();
    this.initEventListeners();
    this.visualizer = new AudioVisualizer(this.dom.canvas, this.dom.audio, this.soundEngine);
  }

  initDOMReferences() {
    this.dom = {
      fileInput: document.getElementById('file-input'),
      btnOpenFile: document.getElementById('btn-open-file'),
      btnDemoStory: document.getElementById('btn-demo-story'),
      btnShortcuts: document.getElementById('btn-shortcuts'),
      
      welcomeScreen: document.getElementById('welcome-screen'),
      playerScreen: document.getElementById('player-screen'),
      btnHeroOpen: document.getElementById('btn-hero-open'),
      btnHeroDemo: document.getElementById('btn-hero-demo'),

      storyTitle: document.getElementById('story-title'),
      storyAuthor: document.getElementById('story-author'),
      storyDescription: document.getElementById('story-description'),
      statusTag: document.getElementById('story-status-tag'),
      sceneCounter: document.getElementById('scene-counter'),

      canvas: document.getElementById('audio-visualizer'),
      sceneImgContainer: document.getElementById('scene-image-container'),
      sceneImg: document.getElementById('scene-image'),

      btnToggleTranscript: document.getElementById('btn-toggle-transcript'),
      transcriptBody: document.getElementById('transcript-body'),
      transcriptText: document.getElementById('transcript-text'),

      audio: document.getElementById('audio-element'),
      progressBar: document.getElementById('progress-bar'),
      progressFill: document.getElementById('progress-fill'),
      timeCurrent: document.getElementById('time-current'),
      timeDuration: document.getElementById('time-duration'),

      btnPlayPause: document.getElementById('btn-play-pause'),
      iconPlay: document.getElementById('icon-play'),
      iconPause: document.getElementById('icon-pause'),
      btnSkipBack: document.getElementById('btn-skip-back'),
      btnSkipForward: document.getElementById('btn-skip-forward'),
      btnRestartScene: document.getElementById('btn-restart-scene'),
      selectSpeed: document.getElementById('select-speed'),

      btnMute: document.getElementById('btn-mute'),
      iconVolumeHigh: document.getElementById('icon-volume-high'),
      iconVolumeMuted: document.getElementById('icon-volume-muted'),
      volumeSlider: document.getElementById('volume-slider'),

      autoplayBlocker: document.getElementById('autoplay-blocker'),
      btnStartAutoplay: document.getElementById('btn-start-autoplay'),

      choiceContainer: document.getElementById('choice-container'),
      choicesList: document.getElementById('choices-list'),
      timerBarWrapper: document.getElementById('timer-bar-wrapper'),
      timerSecondsText: document.getElementById('timer-seconds-text'),
      timerProgressFill: document.getElementById('timer-progress-fill'),

      endingOptions: document.getElementById('ending-options'),
      btnRestartStory: document.getElementById('btn-restart-story'),
      btnLoadAnother: document.getElementById('btn-load-another'),

      dragDropOverlay: document.getElementById('drag-drop-overlay'),
      modalShortcuts: document.getElementById('modal-shortcuts'),
      btnCloseShortcuts: document.getElementById('btn-close-shortcuts'),
      toastContainer: document.getElementById('toast-container')
    };
  }

  initEventListeners() {
    // File Picking
    const triggerFileSelect = () => this.dom.fileInput.click();
    this.dom.btnOpenFile.addEventListener('click', triggerFileSelect);
    this.dom.btnHeroOpen.addEventListener('click', triggerFileSelect);

    this.dom.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.loadCyoaFile(e.target.files[0]);
      }
    });

    // Built-in Demo Generators
    const loadDemo = () => this.loadDemoStory();
    this.dom.btnDemoStory.addEventListener('click', loadDemo);
    this.dom.btnHeroDemo.addEventListener('click', loadDemo);

    // Audio Element Callbacks
    this.dom.audio.addEventListener('timeupdate', () => this.updateAudioProgress());
    this.dom.audio.addEventListener('loadedmetadata', () => this.updateAudioProgress());
    this.dom.audio.addEventListener('ended', () => this.handleAudioEnded());
    this.dom.audio.addEventListener('play', () => {
      this.updateStatusTag('Playing', 'status-playing');
      this.dom.iconPlay.classList.add('hidden');
      this.dom.iconPause.classList.remove('hidden');
      this.visualizer.start();
    });
    this.dom.audio.addEventListener('pause', () => {
      if (!this.dom.audio.ended) {
        this.updateStatusTag('Paused', 'status-stopped');
      }
      this.dom.iconPlay.classList.remove('hidden');
      this.dom.iconPause.classList.add('hidden');
      this.visualizer.stop();
    });

    // Controls
    this.dom.btnPlayPause.addEventListener('click', () => this.togglePlayPause());
    this.dom.btnSkipBack.addEventListener('click', () => this.seekRelative(-10));
    this.dom.btnSkipForward.addEventListener('click', () => this.seekRelative(10));
    this.dom.btnRestartScene.addEventListener('click', () => this.restartCurrentScene());

    this.dom.progressBar.addEventListener('input', (e) => {
      const targetTime = (e.target.value / 100) * this.dom.audio.duration;
      if (!isNaN(targetTime)) {
        this.dom.audio.currentTime = targetTime;
      }
    });

    this.dom.selectSpeed.addEventListener('change', (e) => {
      this.dom.audio.playbackRate = parseFloat(e.target.value);
    });

    this.dom.volumeSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.dom.audio.volume = val;
      this.dom.audio.muted = (val === 0);
      this.updateVolumeIcons(val === 0);
    });

    this.dom.btnMute.addEventListener('click', () => {
      this.dom.audio.muted = !this.dom.audio.muted;
      this.updateVolumeIcons(this.dom.audio.muted);
    });

    this.dom.btnStartAutoplay.addEventListener('click', () => {
      this.dom.autoplayBlocker.classList.add('hidden');
      this.dom.audio.play();
    });

    // Transcript Toggle
    this.dom.btnToggleTranscript.addEventListener('click', () => {
      const isExpanded = this.dom.btnToggleTranscript.getAttribute('aria-expanded') === 'true';
      this.dom.btnToggleTranscript.setAttribute('aria-expanded', !isExpanded);
      this.dom.transcriptBody.classList.toggle('hidden', isExpanded);
    });

    // Ending Actions
    this.dom.btnRestartStory.addEventListener('click', () => this.restartStory());
    this.dom.btnLoadAnother.addEventListener('click', () => triggerFileSelect());

    // Shortcuts Modal
    this.dom.btnShortcuts.addEventListener('click', () => this.toggleShortcutsModal(true));
    this.dom.btnCloseShortcuts.addEventListener('click', () => this.toggleShortcutsModal(false));

    // Global Keybindings
    window.addEventListener('keydown', (e) => this.handleGlobalKeyDown(e));

    // Drag and Drop
    this.initDragAndDrop();
  }

  initDragAndDrop() {
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dom.dragDropOverlay.classList.remove('hidden');
    });

    this.dom.dragDropOverlay.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.dom.dragDropOverlay.classList.add('hidden');
    });

    this.dom.dragDropOverlay.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dom.dragDropOverlay.classList.add('hidden');
      if (e.dataTransfer.files.length > 0) {
        this.loadCyoaFile(e.dataTransfer.files[0]);
      }
    });
  }

  /**
   * Loads a .cyoa ZIP file and starts playback
   */
  async loadCyoaFile(file) {
    this.showToast(`Loading package "${file.name}"...`, 'info');
    
    try {
      this.cleanupCurrentStory();
      const { storyData, zip } = await CYOAParser.parsePackage(file);
      
      this.storyData = storyData;
      this.zipArchive = zip;

      this.renderStoryMetadata();
      this.dom.welcomeScreen.classList.add('hidden');
      this.dom.playerScreen.classList.remove('hidden');

      this.showToast(`Loaded "${storyData.title}" successfully!`, 'success');
      this.loadScene(this.storyData.start);

    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  /**
   * Loads and begins a specific story scene
   */
  async loadScene(sceneId) {
    const scene = this.storyData.scenes[sceneId];
    if (!scene) {
      this.showToast(`Error: Scene "${sceneId}" not found in story.`, 'error');
      return;
    }

    this.currentSceneId = sceneId;
    this.state.visitedScenes.add(sceneId);
    this.state.history.push(sceneId);

    // Hide previous choice panel
    this.clearTimers();
    this.dom.choiceContainer.classList.add('hidden');
    this.dom.autoplayBlocker.classList.add('hidden');

    // Update UI Titles
    this.dom.sceneCounter.textContent = `Scene: ${scene.title || sceneId}`;
    this.dom.transcriptText.textContent = scene.transcript || scene.text || "No narration transcript available for this scene.";

    // Render Scene Artwork if present
    if (scene.image) {
      const imgUrl = await CYOAParser.extractImageBlobUrl(this.zipArchive, scene.image);
      if (imgUrl) {
        this.activeObjectUrls.push(imgUrl);
        this.dom.sceneImg.src = imgUrl;
        this.dom.sceneImgContainer.classList.remove('hidden');
      } else {
        this.dom.sceneImgContainer.classList.add('hidden');
      }
    } else {
      this.dom.sceneImgContainer.classList.add('hidden');
    }

    // Extract Audio Blob & Load HTML Audio
    if (scene.audio) {
      const audioUrl = await CYOAParser.extractAudioBlobUrl(this.zipArchive, scene.audio);
      if (audioUrl) {
        this.activeObjectUrls.push(audioUrl);
        this.dom.audio.src = audioUrl;
        this.dom.audio.playbackRate = parseFloat(this.dom.selectSpeed.value);

        // Play audio (handling browser autoplay policy gracefully)
        try {
          this.soundEngine.init();
          await this.dom.audio.play();
        } catch (autoplayError) {
          console.warn("Autoplay blocked by browser policy. Displaying user prompt.");
          this.dom.autoplayBlocker.classList.remove('hidden');
        }
      } else {
        this.showToast(`Audio asset missing for scene: ${sceneId}`, 'error');
        this.handleAudioEnded(); // Proceed to choices directly if audio missing
      }
    } else {
      // Scene without audio: jump straight to choices
      this.handleAudioEnded();
    }
  }

  /**
   * Flow step when scene audio reaches completion:
   * 1-2 second delay -> Soft Church Bell Chime -> Reveal Choice Buttons
   */
  handleAudioEnded() {
    this.updateStatusTag('Waiting for Bell...', 'status-stopped');
    
    // Wait 1.5 seconds, then ring the bell and reveal choices
    this.bellDelayTimer = setTimeout(() => {
      this.soundEngine.playChurchBell();
      this.revealChoices();
    }, 1500);
  }

  /**
   * Reveals choice buttons or ending card
   */
  revealChoices() {
    this.updateStatusTag('Awaiting Decision', 'status-awaiting');
    this.dom.choiceContainer.classList.remove('hidden');

    const scene = this.storyData.scenes[this.currentSceneId];
    const choices = scene.choices || [];

    // Clear previous choices
    this.dom.choicesList.innerHTML = '';
    this.dom.endingOptions.classList.add('hidden');

    if (choices.length === 0) {
      // End of story path
      this.dom.endingOptions.classList.remove('hidden');
      return;
    }

    // Render Choice Buttons
    choices.forEach((choice, index) => {
      // Skip choice if future condition evaluates to false
      if (choice.condition && !this.evaluateCondition(choice.condition)) {
        return;
      }

      const btn = document.createElement('button');
      btn.className = 'btn-choice';
      btn.setAttribute('role', 'button');
      btn.innerHTML = `
        <span class="choice-key-badge">${index + 1}</span>
        <span class="choice-text">${choice.text}</span>
      `;

      btn.addEventListener('click', () => {
        this.soundEngine.playClick();
        this.selectChoice(choice);
      });

      this.dom.choicesList.appendChild(btn);
    });

    // Check for Timed Choice setting in story.json
    if (scene.timer && typeof scene.timer === 'number' && scene.timer > 0) {
      this.startTimedChoiceCountdown(scene.timer, scene.timeoutNext || choices[0]?.next);
    } else {
      this.dom.timerBarWrapper.classList.add('hidden');
    }
  }

  /**
   * Handles timed choice countdown logic
   */
  startTimedChoiceCountdown(durationSeconds, timeoutTargetScene) {
    this.dom.timerBarWrapper.classList.remove('hidden');
    this.timeRemaining = durationSeconds;
    this.dom.timerSecondsText.textContent = `${this.timeRemaining}s`;
    this.dom.timerProgressFill.style.width = '100%';

    const startTime = Date.now();
    const totalMs = durationSeconds * 1000;

    this.timedChoiceInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingMs = Math.max(0, totalMs - elapsed);
      const remainingSec = Math.ceil(remainingMs / 1000);

      this.dom.timerSecondsText.textContent = `${remainingSec}s`;
      const pct = (remainingMs / totalMs) * 100;
      this.dom.timerProgressFill.style.width = `${pct}%`;

      if (remainingMs <= 0) {
        this.clearTimers();
        this.showToast('Time expired! Path auto-selected.', 'info');
        if (timeoutTargetScene) {
          this.loadScene(timeoutTargetScene);
        } else {
          const firstChoice = this.storyData.scenes[this.currentSceneId]?.choices[0];
          if (firstChoice) this.selectChoice(firstChoice);
        }
      }
    }, 100);
  }

  /**
   * Executes choice selection & state transition
   */
  selectChoice(choice) {
    this.clearTimers();

    // Future compatibility: Modify story variables if choice specifies variable updates
    if (choice.setVariables && typeof choice.setVariables === 'object') {
      Object.assign(this.state.variables, choice.setVariables);
    }

    if (choice.next) {
      this.loadScene(choice.next);
    } else {
      this.showToast("Selected choice has no destination scene.", "error");
    }
  }

  /**
   * Future Proofing: Simple variable condition evaluator
   */
  evaluateCondition(conditionStr) {
    try {
      // Safe evaluation context with state variables
      const vars = this.state.variables;
      const func = new Function('vars', `with(vars) { return ${conditionStr}; }`);
      return Boolean(func(vars));
    } catch (e) {
      console.warn("Condition evaluation error:", e);
      return true; // Fallback to allow choice
    }
  }

  // Audio Control Helper Functions
  togglePlayPause() {
    if (!this.dom.audio.src) return;
    this.soundEngine.init();
    if (this.dom.audio.paused) {
      this.dom.audio.play();
    } else {
      this.dom.audio.pause();
    }
  }

  seekRelative(seconds) {
    if (!this.dom.audio.src) return;
    this.dom.audio.currentTime = Math.max(0, Math.min(this.dom.audio.duration || 0, this.dom.audio.currentTime + seconds));
  }

  restartCurrentScene() {
    if (this.currentSceneId) {
      this.loadScene(this.currentSceneId);
    }
  }

  restartStory() {
    if (this.storyData && this.storyData.start) {
      this.loadScene(this.storyData.start);
    }
  }

  updateAudioProgress() {
    const cur = this.dom.audio.currentTime || 0;
    const dur = this.dom.audio.duration || 0;

    this.dom.timeCurrent.textContent = this.formatTime(cur);
    this.dom.timeDuration.textContent = this.formatTime(dur);

    if (dur > 0) {
      const pct = (cur / dur) * 100;
      this.dom.progressBar.value = pct;
      this.dom.progressFill.style.width = `${pct}%`;
    } else {
      this.dom.progressBar.value = 0;
      this.dom.progressFill.style.width = `0%`;
    }
  }

  updateVolumeIcons(isMuted) {
    if (isMuted) {
      this.dom.iconVolumeHigh.classList.add('hidden');
      this.dom.iconVolumeMuted.classList.remove('hidden');
    } else {
      this.dom.iconVolumeHigh.classList.remove('hidden');
      this.dom.iconVolumeMuted.classList.add('hidden');
    }
  }

  updateStatusTag(text, className) {
    this.dom.statusTag.textContent = text;
    this.dom.statusTag.className = `status-badge ${className}`;
  }

  renderStoryMetadata() {
    this.dom.storyTitle.textContent = this.storyData.title;
    this.dom.storyAuthor.textContent = `by ${this.storyData.author}`;
    this.dom.storyDescription.textContent = this.storyData.description || 'No description available.';
  }

  clearTimers() {
    if (this.bellDelayTimer) clearTimeout(this.bellDelayTimer);
    if (this.timedChoiceInterval) clearInterval(this.timedChoiceInterval);
  }

  cleanupCurrentStory() {
    this.clearTimers();
    this.dom.audio.pause();
    this.dom.audio.src = '';
    
    // Revoke memory URLs to prevent memory leaks
    this.activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    this.activeObjectUrls = [];

    this.state = { variables: {}, history: [], visitedScenes: new Set() };
  }

  formatTime(secs) {
    if (isNaN(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  toggleShortcutsModal(show) {
    this.dom.modalShortcuts.classList.toggle('hidden', !show);
  }

  handleGlobalKeyDown(e) {
    // Ignore keybindings if user is typing inside an input
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (e.key === '?') {
      this.toggleShortcutsModal(this.dom.modalShortcuts.classList.contains('hidden'));
      return;
    }

    if (e.key === 'Escape') {
      this.toggleShortcutsModal(false);
      return;
    }

    if (this.dom.playerScreen.classList.contains('hidden')) return;

    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        e.preventDefault();
        this.togglePlayPause();
        break;
      case 'ArrowLeft':
      case 'j':
      case 'J':
        e.preventDefault();
        this.seekRelative(-10);
        break;
      case 'ArrowRight':
      case 'l':
      case 'L':
        e.preventDefault();
        this.seekRelative(10);
        break;
      case 'm':
      case 'M':
        this.dom.btnMute.click();
        break;
      case 'r':
      case 'R':
        this.restartCurrentScene();
        break;
      case 't':
      case 'T':
        this.dom.btnToggleTranscript.click();
        break;
      default:
        // Number keys 1-5 for direct choice selection when choices are visible
        if (['1', '2', '3', '4', '5'].includes(e.key)) {
          const index = parseInt(e.key, 10) - 1;
          const choiceBtns = this.dom.choicesList.querySelectorAll('.btn-choice');
          if (choiceBtns[index] && !this.dom.choiceContainer.classList.contains('hidden')) {
            choiceBtns[index].click();
          }
        }
        break;
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    this.dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  /**
   * Generates a fully playable sample .cyoa package on the fly in memory!
   * Creates audio files dynamically using synthesized WAV audio tones.
   */
  async loadDemoStory() {
    this.showToast('Generating demo story package...', 'info');

    try {
      const zip = new JSZip();

      // Sample story JSON definition
      const sampleStoryJson = {
        title: "The Whispering Cavern",
        author: "A. Storyteller",
        description: "An interactive audio mystery inside an ancient cavern. Choose your path wisely.",
        start: "scene001",
        scenes: {
          scene001: {
            title: "The Cavern Entrance",
            audio: "audio/scene001.wav",
            transcript: "You stand before the arching entrance of the ancient cavern. Cold damp air drifts out from the darkness ahead. Two paths lie before you.",
            choices: [
              { text: "Light a torch and step inside", next: "scene002" },
              { text: "Follow the narrow ledge around the mountain", next: "scene003" }
            ]
          },
          scene002: {
            title: "Into the Deep",
            audio: "audio/scene002.wav",
            transcript: "The torchlight flickers off damp stone walls. Up ahead, you hear distant rushing water. You have 10 seconds to make a quick decision!",
            timer: 10,
            timeoutNext: "scene003",
            choices: [
              { text: "Follow the sound of echoing water", next: "scene003" },
              { text: "Investigate the strange warm draft to the left", next: "scene003" }
            ]
          },
          scene003: {
            title: "The Bioluminescent Chamber",
            audio: "audio/scene003.wav",
            transcript: "You emerge into a majestic underground cavern glowing with tranquil blue light. You have safely navigated the mystery!",
            choices: []
          }
        }
      };

      // Add story.json to zip
      zip.file("story.json", JSON.stringify(sampleStoryJson, null, 2));

      // Generate 3 synth audio WAV clips
      const audioFolder = zip.folder("audio");
      audioFolder.file("scene001.wav", this.createToneWavBlob(3.5, 440)); // A4 tone
      audioFolder.file("scene002.wav", this.createToneWavBlob(3.0, 523.25)); // C5 tone
      audioFolder.file("scene003.wav", this.createToneWavBlob(4.0, 659.25)); // E5 tone

      // Generate ZIP blob and load into player
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const demoFile = new File([zipBlob], "whispering_cavern.cyoa", { type: "application/zip" });

      await this.loadCyoaFile(demoFile);

    } catch (err) {
      console.error(err);
      this.showToast("Failed to generate demo story.", "error");
    }
  }

  /**
   * Pure JS PCM WAV Audio Blob Generator for demo audio clips
   */
  createToneWavBlob(durationSec, freq) {
    const sampleRate = 22050;
    const numSamples = Math.floor(sampleRate * durationSec);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    function writeString(offset, string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // Mono PCM
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Synthesize a soft melody chime tone
      const env = Math.exp(-t / (durationSec * 0.6));
      const sample = (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * (freq * 1.5) * t)) * env;
      const val = Math.max(-1, Math.min(1, sample)) * 32767;
      view.setInt16(44 + i * 2, val, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }
}

// Instantiate player app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.cyoaPlayer = new CYOAPlayerApp();
});
