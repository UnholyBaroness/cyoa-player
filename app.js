/**
 * CYOA AUDIO STUDIO PLAYER
 * Safe, Client-Side Interactive Engine
 */

'use strict';

// 1. SOUND ENGINE (Web Audio Church Bell & Click SFX)
class SoundEngine {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      } catch (e) {
        console.warn("Web Audio API not supported or blocked:", e);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  playChurchBell() {
    this.init();
    if (!this.ctx) return;
    try {
      const now = this.ctx.currentTime;
      const masterGain = this.ctx.createGain();
      masterGain.gain.setValueAtTime(0.35, now);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2200, now);

      filter.connect(masterGain);
      masterGain.connect(this.ctx.destination);

      const baseFreq = 280;
      const partials = [
        { ratio: 0.5, gain: 0.35, decay: 3.2 },
        { ratio: 1.0, gain: 0.70, decay: 2.8 },
        { ratio: 1.2, gain: 0.45, decay: 2.2 },
        { ratio: 1.5, gain: 0.35, decay: 1.8 },
        { ratio: 2.0, gain: 0.50, decay: 1.5 },
        { ratio: 2.76, gain: 0.20, decay: 1.0 },
        { ratio: 3.0, gain: 0.15, decay: 0.8 }
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
    } catch (e) {
      console.warn("Church bell chime failed:", e);
    }
  }

  playClick() {
    try {
      this.init();
      if (!this.ctx) return;
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
    } catch (e) {}
  }
}

// 2. CYOA PARSER
class CYOAParser {
  static async parsePackage(file) {
    if (typeof JSZip === 'undefined') {
      throw new Error("JSZip library failed to load. Please check internet connection.");
    }
    let zip;
    try {
      zip = await JSZip.loadAsync(file);
    } catch (err) {
      throw new Error("File is not a valid ZIP/.cyoa archive.");
    }
    let jsonEntry = zip.file("story.json");
    if (!jsonEntry) {
      const matches = zip.file(/story\.json$/i);
      if (matches.length > 0) jsonEntry = matches[0];
    }
    if (!jsonEntry) {
      throw new Error("Invalid .cyoa archive: 'story.json' was not found.");
    }
    const jsonText = await jsonEntry.async("string");
    let storyData;
    try {
      storyData = JSON.parse(jsonText);
    } catch (err) {
      throw new Error("'story.json' contains JSON syntax errors.");
    }
    if (!storyData.title) storyData.title = "Untitled CYOA Story";
    if (!storyData.author) storyData.author = "Unknown Author";
    if (!storyData.scenes || typeof storyData.scenes !== 'object') {
      throw new Error("Invalid story structure: 'scenes' object is missing.");
    }
    if (!storyData.start || !storyData.scenes[storyData.start]) {
      const sceneKeys = Object.keys(storyData.scenes);
      if (sceneKeys.length === 0) throw new Error("No scenes defined in story.");
      storyData.start = sceneKeys[0];
    }
    return { storyData, zip };
  }

  static async extractAudioBlobUrl(zip, relativePath) {
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

// 3. MAIN CYOA PLAYER APP
class CYOAPlayerApp {
  constructor() {
    this.soundEngine = new SoundEngine();
    this.storyData = null;
    this.zipArchive = null;
    this.currentSceneId = null;
    this.state = { variables: {}, history: [], visitedScenes: new Set() };
    this.activeObjectUrls = [];
    this.bellDelayTimer = null;
    this.timedChoiceInterval = null;

    try {
      this.initDOMReferences();
      this.initEventListeners();
      console.log("CYOAPlayerApp initialized successfully.");
    } catch (err) {
      console.error("Initialization error:", err);
      alert("Error initializing CYOA Player: " + err.message);
    }
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

      sceneImgContainer: document.getElementById('scene-image-container'),
      sceneImg: document.getElementById('scene-image'),
      narrationBanner: document.getElementById('narration-status-banner'),

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
    const triggerFileSelect = () => {
      if (this.dom.fileInput) this.dom.fileInput.click();
    };

    if (this.dom.btnOpenFile) this.dom.btnOpenFile.onclick = triggerFileSelect;
    if (this.dom.btnHeroOpen) this.dom.btnHeroOpen.onclick = triggerFileSelect;

    if (this.dom.fileInput) {
      this.dom.fileInput.onchange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.loadCyoaFile(e.target.files[0]);
        }
      };
    }

    const loadDemo = () => this.loadDemoStory();
    if (this.dom.btnDemoStory) this.dom.btnDemoStory.onclick = loadDemo;
    if (this.dom.btnHeroDemo) this.dom.btnHeroDemo.onclick = loadDemo;

    if (this.dom.audio) {
      this.dom.audio.ontimeupdate = () => this.updateAudioProgress();
      this.dom.audio.onloadedmetadata = () => this.updateAudioProgress();
      this.dom.audio.onended = () => this.handleAudioEnded();
      this.dom.audio.onplay = () => {
        this.updateStatusTag('Playing', 'status-playing');
        if (this.dom.iconPlay) this.dom.iconPlay.classList.add('hidden');
        if (this.dom.iconPause) this.dom.iconPause.classList.remove('hidden');
      };
      this.dom.audio.onpause = () => {
        if (!this.dom.audio.ended) {
          this.updateStatusTag('Paused', 'status-stopped');
        }
        if (this.dom.iconPlay) this.dom.iconPlay.classList.remove('hidden');
        if (this.dom.iconPause) this.dom.iconPause.classList.add('hidden');
      };
    }

    if (this.dom.btnPlayPause) this.dom.btnPlayPause.onclick = () => this.togglePlayPause();
    if (this.dom.btnSkipBack) this.dom.btnSkipBack.onclick = () => this.seekRelative(-10);
    if (this.dom.btnSkipForward) this.dom.btnSkipForward.onclick = () => this.seekRelative(10);
    if (this.dom.btnRestartScene) this.dom.btnRestartScene.onclick = () => this.restartCurrentScene();

    if (this.dom.progressBar) {
      this.dom.progressBar.oninput = (e) => {
        const targetTime = (e.target.value / 100) * (this.dom.audio.duration || 0);
        if (!isNaN(targetTime)) this.dom.audio.currentTime = targetTime;
      };
    }

    if (this.dom.selectSpeed) {
      this.dom.selectSpeed.onchange = (e) => {
        if (this.dom.audio) this.dom.audio.playbackRate = parseFloat(e.target.value);
      };
    }

    if (this.dom.volumeSlider) {
      this.dom.volumeSlider.oninput = (e) => {
        const val = parseFloat(e.target.value);
        if (this.dom.audio) {
          this.dom.audio.volume = val;
          this.dom.audio.muted = (val === 0);
        }
        this.updateVolumeIcons(val === 0);
      };
    }

    if (this.dom.btnMute) {
      this.dom.btnMute.onclick = () => {
        if (this.dom.audio) {
          this.dom.audio.muted = !this.dom.audio.muted;
          this.updateVolumeIcons(this.dom.audio.muted);
        }
      };
    }

    if (this.dom.btnStartAutoplay) {
      this.dom.btnStartAutoplay.onclick = () => {
        if (this.dom.autoplayBlocker) this.dom.autoplayBlocker.classList.add('hidden');
        if (this.dom.audio) this.dom.audio.play();
      };
    }

    if (this.dom.btnToggleTranscript) {
      this.dom.btnToggleTranscript.onclick = () => {
        const isExpanded = this.dom.btnToggleTranscript.getAttribute('aria-expanded') === 'true';
        this.dom.btnToggleTranscript.setAttribute('aria-expanded', !isExpanded);
        if (this.dom.transcriptBody) this.dom.transcriptBody.classList.toggle('hidden', isExpanded);
      };
    }

    if (this.dom.btnRestartStory) this.dom.btnRestartStory.onclick = () => this.restartStory();
    if (this.dom.btnLoadAnother) this.dom.btnLoadAnother.onclick = () => triggerFileSelect();

    if (this.dom.btnShortcuts) this.dom.btnShortcuts.onclick = () => this.toggleShortcutsModal(true);
    if (this.dom.btnCloseShortcuts) this.dom.btnCloseShortcuts.onclick = () => this.toggleShortcutsModal(false);

    window.onkeydown = (e) => this.handleGlobalKeyDown(e);
  }

  async loadCyoaFile(file) {
    this.showToast("Loading " + file.name + "...", 'info');
    try {
      this.cleanupCurrentStory();
      const { storyData, zip } = await CYOAParser.parsePackage(file);
      this.storyData = storyData;
      this.zipArchive = zip;

      this.renderStoryMetadata();
      if (this.dom.welcomeScreen) this.dom.welcomeScreen.classList.add('hidden');
      if (this.dom.playerScreen) this.dom.playerScreen.classList.remove('hidden');

      this.showToast("Loaded " + storyData.title + "!", 'success');
      this.loadScene(this.storyData.start);
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  async loadScene(sceneId) {
    const scene = this.storyData.scenes[sceneId];
    if (!scene) {
      this.showToast("Error: Scene " + sceneId + " not found.", 'error');
      return;
    }

    this.currentSceneId = sceneId;
    this.state.visitedScenes.add(sceneId);
    this.state.history.push(sceneId);

    this.clearTimers();
    if (this.dom.choiceContainer) this.dom.choiceContainer.classList.add('hidden');
    if (this.dom.narrationBanner) this.dom.narrationBanner.classList.remove('hidden');
    if (this.dom.autoplayBlocker) this.dom.autoplayBlocker.classList.add('hidden');

    if (this.dom.sceneCounter) this.dom.sceneCounter.textContent = "Scene: " + (scene.title || sceneId);
    if (this.dom.transcriptText) this.dom.transcriptText.textContent = scene.transcript || scene.text || "No narration transcript available.";

    if (scene.image && this.dom.sceneImg) {
      const imgUrl = await CYOAParser.extractImageBlobUrl(this.zipArchive, scene.image);
      if (imgUrl) {
        this.activeObjectUrls.push(imgUrl);
        this.dom.sceneImg.src = imgUrl;
        if (this.dom.sceneImgContainer) this.dom.sceneImgContainer.classList.remove('hidden');
      } else {
        if (this.dom.sceneImgContainer) this.dom.sceneImgContainer.classList.add('hidden');
      }
    } else {
      if (this.dom.sceneImgContainer) this.dom.sceneImgContainer.classList.add('hidden');
    }

    if (scene.audio && this.dom.audio) {
      const audioUrl = await CYOAParser.extractAudioBlobUrl(this.zipArchive, scene.audio);
      if (audioUrl) {
        this.activeObjectUrls.push(audioUrl);
        this.dom.audio.src = audioUrl;
        if (this.dom.selectSpeed) this.dom.audio.playbackRate = parseFloat(this.dom.selectSpeed.value);

        try {
          this.soundEngine.init();
          await this.dom.audio.play();
        } catch (autoplayError) {
          if (this.dom.autoplayBlocker) this.dom.autoplayBlocker.classList.remove('hidden');
        }
      } else {
        this.showToast("Audio missing for: " + sceneId, 'error');
        this.handleAudioEnded();
      }
    } else {
      this.handleAudioEnded();
    }
  }

  handleAudioEnded() {
    this.updateStatusTag('Waiting for Bell...', 'status-stopped');
    this.bellDelayTimer = setTimeout(() => {
      this.soundEngine.playChurchBell();
      this.revealChoices();
    }, 1500);
  }

  revealChoices() {
    this.updateStatusTag('Awaiting Decision', 'status-awaiting');
    if (this.dom.narrationBanner) this.dom.narrationBanner.classList.add('hidden');
    if (this.dom.choiceContainer) this.dom.choiceContainer.classList.remove('hidden');

    const scene = this.storyData.scenes[this.currentSceneId];
    const choices = scene.choices || [];

    if (this.dom.choicesList) this.dom.choicesList.innerHTML = '';
    if (this.dom.endingOptions) this.dom.endingOptions.classList.add('hidden');

    if (choices.length === 0) {
      if (this.dom.endingOptions) this.dom.endingOptions.classList.remove('hidden');
      return;
    }

    choices.forEach((choice, index) => {
      const btn = document.createElement('button');
      btn.className = 'btn-choice';
      btn.innerHTML = '<span class="choice-key-badge">' + (index + 1) + '</span><span class="choice-text">' + choice.text + '</span>';
      btn.onclick = () => {
        this.soundEngine.playClick();
        this.selectChoice(choice);
      };
      if (this.dom.choicesList) this.dom.choicesList.appendChild(btn);
    });

    if (scene.timer && typeof scene.timer === 'number' && scene.timer > 0) {
      this.startTimedChoiceCountdown(scene.timer, scene.timeoutNext || (choices[0] && choices[0].next));
    } else {
      if (this.dom.timerBarWrapper) this.dom.timerBarWrapper.classList.add('hidden');
    }
  }

  startTimedChoiceCountdown(durationSeconds, timeoutTargetScene) {
    if (this.dom.timerBarWrapper) this.dom.timerBarWrapper.classList.remove('hidden');
    if (this.dom.timerSecondsText) this.dom.timerSecondsText.textContent = durationSeconds + "s";
    if (this.dom.timerProgressFill) this.dom.timerProgressFill.style.width = '100%';

    const startTime = Date.now();
    const totalMs = durationSeconds * 1000;

    this.timedChoiceInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remainingMs = Math.max(0, totalMs - elapsed);
      const remainingSec = Math.ceil(remainingMs / 1000);

      if (this.dom.timerSecondsText) this.dom.timerSecondsText.textContent = remainingSec + "s";
      const pct = (remainingMs / totalMs) * 100;
      if (this.dom.timerProgressFill) this.dom.timerProgressFill.style.width = pct + "%";

      if (remainingMs <= 0) {
        this.clearTimers();
        this.showToast('Time expired!', 'info');
        if (timeoutTargetScene) {
          this.loadScene(timeoutTargetScene);
        } else {
          const firstChoice = this.storyData.scenes[this.currentSceneId] && this.storyData.scenes[this.currentSceneId].choices[0];
          if (firstChoice) this.selectChoice(firstChoice);
        }
      }
    }, 100);
  }

  selectChoice(choice) {
    this.clearTimers();
    if (choice.next) {
      this.loadScene(choice.next);
    } else {
      this.showToast("No destination scene.", "error");
    }
  }

  togglePlayPause() {
    if (!this.dom.audio || !this.dom.audio.src) return;
    this.soundEngine.init();
    if (this.dom.audio.paused) {
      this.dom.audio.play();
    } else {
      this.dom.audio.pause();
    }
  }

  seekRelative(seconds) {
    if (!this.dom.audio || !this.dom.audio.src) return;
    this.dom.audio.currentTime = Math.max(0, Math.min(this.dom.audio.duration || 0, this.dom.audio.currentTime + seconds));
  }

  restartCurrentScene() {
    if (this.currentSceneId) this.loadScene(this.currentSceneId);
  }

  restartStory() {
    if (this.storyData && this.storyData.start) this.loadScene(this.storyData.start);
  }

  updateAudioProgress() {
    if (!this.dom.audio) return;
    const cur = this.dom.audio.currentTime || 0;
    const dur = this.dom.audio.duration || 0;

    if (this.dom.timeCurrent) this.dom.timeCurrent.textContent = this.formatTime(cur);
    if (this.dom.timeDuration) this.dom.timeDuration.textContent = this.formatTime(dur);

    if (dur > 0 && this.dom.progressBar && this.dom.progressFill) {
      const pct = (cur / dur) * 100;
      this.dom.progressBar.value = pct;
      this.dom.progressFill.style.width = pct + "%";
    }
  }

  updateVolumeIcons(isMuted) {
    if (this.dom.iconVolumeHigh && this.dom.iconVolumeMuted) {
      if (isMuted) {
        this.dom.iconVolumeHigh.classList.add('hidden');
        this.dom.iconVolumeMuted.classList.remove('hidden');
      } else {
        this.dom.iconVolumeHigh.classList.remove('hidden');
        this.dom.iconVolumeMuted.classList.add('hidden');
      }
    }
  }

  updateStatusTag(text, className) {
    if (this.dom.statusTag) {
      this.dom.statusTag.textContent = text;
      this.dom.statusTag.className = "status-badge " + className;
    }
  }

  renderStoryMetadata() {
    if (this.dom.storyTitle) this.dom.storyTitle.textContent = this.storyData.title;
    if (this.dom.storyAuthor) this.dom.storyAuthor.textContent = "by " + this.storyData.author;
    if (this.dom.storyDescription) this.dom.storyDescription.textContent = this.storyData.description || 'No description available.';
  }

  clearTimers() {
    if (this.bellDelayTimer) clearTimeout(this.bellDelayTimer);
    if (this.timedChoiceInterval) clearInterval(this.timedChoiceInterval);
  }

  cleanupCurrentStory() {
    this.clearTimers();
    if (this.dom.audio) {
      this.dom.audio.pause();
      this.dom.audio.src = '';
    }
    this.activeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    this.activeObjectUrls = [];
    this.state = { variables: {}, history: [], visitedScenes: new Set() };
  }

  formatTime(secs) {
    if (isNaN(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
  }

  toggleShortcutsModal(show) {
    if (this.dom.modalShortcuts) {
      this.dom.modalShortcuts.classList.toggle('hidden', !show);
    }
  }

  handleGlobalKeyDown(e) {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key === '?') {
      if (this.dom.modalShortcuts) {
        this.toggleShortcutsModal(this.dom.modalShortcuts.classList.contains('hidden'));
      }
      return;
    }
    if (e.key === 'Escape') {
      this.toggleShortcutsModal(false);
      return;
    }
    if (this.dom.playerScreen && this.dom.playerScreen.classList.contains('hidden')) return;

    if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      this.togglePlayPause();
    } else if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      this.seekRelative(-10);
    } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      this.seekRelative(10);
    } else if (e.key === 'm' || e.key === 'M') {
      if (this.dom.btnMute) this.dom.btnMute.click();
    } else if (e.key === 'r' || e.key === 'R') {
      this.restartCurrentScene();
    } else if (e.key === 't' || e.key === 'T') {
      if (this.dom.btnToggleTranscript) this.dom.btnToggleTranscript.click();
    }
  }

  showToast(message, type = 'info') {
    if (!this.dom.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = "toast toast-" + type;
    toast.textContent = message;
    this.dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  async loadDemoStory() {
    this.showToast('Generating demo story package...', 'info');
    try {
      if (typeof JSZip === 'undefined') {
        alert("JSZip is not loaded. Please check your internet connection.");
        return;
      }
      const zip = new JSZip();

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

      zip.file("story.json", JSON.stringify(sampleStoryJson, null, 2));

      const audioFolder = zip.folder("audio");
      audioFolder.file("scene001.wav", this.createToneWavBlob(3.5, 440));
      audioFolder.file("scene002.wav", this.createToneWavBlob(3.0, 523.25));
      audioFolder.file("scene003.wav", this.createToneWavBlob(4.0, 659.25));

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const demoFile = new File([zipBlob], "whispering_cavern.cyoa", { type: "application/zip" });

      await this.loadCyoaFile(demoFile);
    } catch (err) {
      console.error(err);
      this.showToast("Failed to generate demo story: " + err.message, "error");
    }
  }

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
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t / (durationSec * 0.6));
      const sample = (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * (freq * 1.5) * t)) * env;
      const val = Math.max(-1, Math.min(1, sample)) * 32767;
      view.setInt16(44 + i * 2, val, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }
}

function initApp() {
  if (!window.cyoaPlayer) {
    window.cyoaPlayer = new CYOAPlayerApp();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
