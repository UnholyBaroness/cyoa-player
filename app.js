/**
 * CYOA AUDIO STUDIO PLAYER & CREATOR ENGINE
 * Client-Side Interactive Engine with Builder & Package Exporter
 */

'use strict';

// 1. SOUND ENGINE
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
        console.warn("Web Audio API not supported:", e);
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
      console.warn("Church bell failed:", e);
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

// 2. PARSER
class CYOAParser {
  static async parsePackage(file) {
    if (typeof JSZip === 'undefined') {
      throw new Error("JSZip library failed to load.");
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
    if (!storyData.scriptWriter) storyData.scriptWriter = storyData.author || "Unknown Writer";
    if (!storyData.scriptFiller) storyData.scriptFiller = "Unknown Filler";
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

// 3. STORY CREATOR BUILDER MODULE
class CYOACreator {
  constructor(app) {
    this.app = app;
    this.scenes = [];
    this.initDefaultTemplate();
  }

  initDefaultTemplate() {
    this.scenes = [
      {
        id: "scene001",
        title: "The Beginning",
        timer: 10,
        timeoutNext: "scene002",
        choiceOffset: 0.5,
        audioFile: null,
        choices: [
          { text: "Go to Scene 2", next: "scene002" }
        ]
      },
      {
        id: "scene002",
        title: "The Ending",
        timer: 0,
        timeoutNext: "",
        choiceOffset: 0,
        audioFile: null,
        choices: []
      }
    ];
    this.reindexScenes();
  }

  reindexScenes() {
    this.scenes.forEach((sc, i) => {
      const oldId = sc.id;
      const num = i + 1;
      const newId = "scene" + (num < 10 ? "00" + num : (num < 100 ? "0" + num : num));
      sc.id = newId;

      if (oldId && oldId !== newId) {
        this.scenes.forEach(s => {
          if (s.timeoutNext === oldId) s.timeoutNext = newId;
          s.choices.forEach(c => {
            if (c.next === oldId) c.next = newId;
          });
        });
      }
    });
  }

  renderUI() {
    const container = document.getElementById('creator-scenes-container');
    if (!container) return;

    this.reindexScenes();
    container.innerHTML = '';

    this.scenes.forEach((scene, index) => {
      const card = document.createElement('div');
      card.className = 'scene-edit-card';

      card.innerHTML = `
        <div class="scene-edit-header">
          <span class="scene-tag">Scene ${index + 1} (${scene.id})</span>
          ${this.scenes.length > 1 ? `<button class="btn btn-danger btn-sm btn-delete-scene" data-index="${index}">Delete Scene</button>` : ''}
        </div>
        <div class="form-grid">
          <div class="form-group full-width">
            <label>Scene Title:</label>
            <input type="text" class="form-input scene-title-input" value="${scene.title}" data-index="${index}" placeholder="Scene Title" />
          </div>
          <div class="form-group full-width">
            <label>Audio File (.mp3, .wav, .m4a):</label>
            <input type="file" accept="audio/*" class="form-input scene-audio-input" data-index="${index}" />
            <span class="badge" style="margin-top:4px;">${scene.audioFile ? 'File attached: ' + scene.audioFile.name : 'No audio attached'}</span>
          </div>
        </div>

        <div class="choices-editor">
          <div class="section-header">
            <label><strong>Choices & Timing Settings (${scene.choices.length}):</strong></label>
            <button class="btn btn-secondary btn-sm btn-add-choice" data-index="${index}">+ Add Choice</button>
          </div>

          <div class="form-grid" style="margin-bottom: 1rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 1rem;">
            <div class="form-group">
              <label>Timer (Seconds, 0 = unlimited):</label>
              <input type="number" min="0" class="form-input scene-timer-input" value="${scene.timer}" data-index="${index}" />
            </div>
            <div class="form-group">
              <label>On Timeout Jump To Scene:</label>
              <select class="form-input scene-timeout-select" data-index="${index}">
                <option value="">Default (First choice or next scene)</option>
                ${this.scenes.map((s, sIdx) => 
                  `<option value="${s.id}" ${scene.timeoutNext === s.id ? 'selected' : ''}>Scene ${sIdx + 1}: ${s.title || 'Untitled'}</option>`
                ).join('')}
              </select>
            </div>
            <div class="form-group full-width">
              <label>Choice Bell Offset (Seconds relative to audio end):</label>
              <input type="number" step="0.5" class="form-input scene-offset-input" value="${scene.choiceOffset}" data-index="${index}" />
            </div>
          </div>

          <div class="choices-list-edit" id="choices-list-edit-${index}"></div>
        </div>
      `;

      container.appendChild(card);

      const choicesContainer = card.querySelector(`#choices-list-edit-${index}`);
      scene.choices.forEach((choice, cIndex) => {
        const choiceRow = document.createElement('div');
        choiceRow.className = 'choice-edit-row';
        choiceRow.innerHTML = `
          <input type="text" class="form-input choice-text-input" placeholder="Choice Text" value="${choice.text}" data-sindex="${index}" data-cindex="${cIndex}" style="flex:2;" />
          <select class="form-input choice-next-select" data-sindex="${index}" data-cindex="${cIndex}" style="flex:1.5;">
            <option value="">-- Target Scene --</option>
            ${this.scenes.map((s, sIdx) => 
              `<option value="${s.id}" ${choice.next === s.id ? 'selected' : ''}>Scene ${sIdx + 1}: ${s.title || 'Untitled'}</option>`
            ).join('')}
          </select>
          <button class="btn btn-danger btn-sm btn-delete-choice" data-sindex="${index}" data-cindex="${cIndex}">&times;</button>
        `;
        choicesContainer.appendChild(choiceRow);
      });
    });

    this.bindEvents();
  }

  bindEvents() {
    document.querySelectorAll('.scene-title-input').forEach(el => {
      el.onchange = (e) => {
        this.scenes[e.target.dataset.index].title = e.target.value;
        this.renderUI();
      };
    });
    document.querySelectorAll('.scene-timer-input').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.index].timer = parseFloat(e.target.value) || 0; };
    });
    document.querySelectorAll('.scene-timeout-select').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.index].timeoutNext = e.target.value; };
    });
    document.querySelectorAll('.scene-offset-input').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.index].choiceOffset = parseFloat(e.target.value) || 0; };
    });

    document.querySelectorAll('.scene-audio-input').forEach(el => {
      el.onchange = (e) => {
        if (e.target.files.length > 0) {
          this.scenes[e.target.dataset.index].audioFile = e.target.files[0];
          this.renderUI();
        }
      };
    });

    document.querySelectorAll('.choice-text-input').forEach(el => {
      el.onchange = (e) => {
        this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].text = e.target.value;
      };
    });
    document.querySelectorAll('.choice-next-select').forEach(el => {
      el.onchange = (e) => {
        this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].next = e.target.value;
      };
    });

    document.querySelectorAll('.btn-add-choice').forEach(el => {
      el.onclick = (e) => {
        const sIndex = parseInt(e.target.dataset.index, 10);
        const targetScene = this.scenes[sIndex + 1] ? this.scenes[sIndex + 1].id : (this.scenes[0] ? this.scenes[0].id : "");
        this.scenes[sIndex].choices.push({ text: "New Option", next: targetScene });
        this.renderUI();
      };
    });
    document.querySelectorAll('.btn-delete-choice').forEach(el => {
      el.onclick = (e) => {
        const sIndex = e.target.dataset.sindex;
        const cIndex = e.target.dataset.cindex;
        this.scenes[sIndex].choices.splice(cIndex, 1);
        this.renderUI();
      };
    });

    document.querySelectorAll('.btn-delete-scene').forEach(el => {
      el.onclick = (e) => {
        this.scenes.splice(e.target.dataset.index, 1);
        this.reindexScenes();
        this.renderUI();
      };
    });
  }

  addScene() {
    const num = this.scenes.length + 1;
    const newId = "scene" + (num < 10 ? "00" + num : (num < 100 ? "0" + num : num));
    this.scenes.push({
      id: newId,
      title: "New Scene " + num,
      timer: 0,
      timeoutNext: "",
      choiceOffset: 1.0,
      audioFile: null,
      choices: []
    });
    this.reindexScenes();
    this.renderUI();
  }

  async exportPackage() {
    if (typeof JSZip === 'undefined') {
      alert("JSZip library is not loaded.");
      return;
    }

    const title = document.getElementById('create-title').value.trim() || "My Story";
    const scriptWriter = document.getElementById('create-script-writer').value.trim() || "Unknown Writer";
    const scriptFiller = document.getElementById('create-script-filler').value.trim() || "Unknown Filler";
    const description = document.getElementById('create-description').value.trim();

    if (this.scenes.length === 0) {
      alert("Please add at least one scene to your story.");
      return;
    }

    this.reindexScenes();

    const zip = new JSZip();
    const manifest = {
      title,
      scriptWriter,
      scriptFiller,
      description,
      start: this.scenes[0].id,
      scenes: {}
    };

    const audioFolder = zip.folder("audio");

    for (let scene of this.scenes) {
      let audioPath = "";
      if (scene.audioFile) {
        const ext = scene.audioFile.name.split('.').pop();
        audioPath = "audio/" + scene.id + "." + ext;
        audioFolder.file(scene.id + "." + ext, scene.audioFile);
      }

      manifest.scenes[scene.id] = {
        title: scene.title,
        audio: audioPath,
        timer: scene.timer,
        timeoutNext: scene.timeoutNext || undefined,
        choiceOffset: scene.choiceOffset,
        choices: scene.choices
      };
    }

    zip.file("story.json", JSON.stringify(manifest, null, 2));

    this.app.showToast("Generating .cyoa package...", "info");
    const blob = await zip.generateAsync({ type: "blob" });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = title.toLowerCase().replace(/[^a-z0-9]/g, '_') + ".cyoa";
    link.click();

    this.app.showToast("Export complete! .cyoa file downloaded.", "success");
  }
}

// 4. MAIN PLAYER APP CONTROLLER
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
    this.choicesRevealed = false;

    try {
      this.initDOMReferences();
      this.creator = new CYOACreator(this);
      this.initEventListeners();
      console.log("CYOAPlayerApp initialized.");
    } catch (err) {
      console.error("Initialization error:", err);
    }
  }

  initDOMReferences() {
    this.dom = {
      fileInput: document.getElementById('file-input'),
      btnOpenFile: document.getElementById('btn-open-file'),
      btnCreateStory: document.getElementById('btn-create-story'),
      welcomeScreen: document.getElementById('welcome-screen'),
      playerScreen: document.getElementById('player-screen'),
      btnHeroOpen: document.getElementById('btn-hero-open'),
      btnHeroCreate: document.getElementById('btn-hero-create'),
      storyTitle: document.getElementById('story-title'),
      storyWriter: document.getElementById('story-writer'),
      storyFiller: document.getElementById('story-filler'),
      storyDescription: document.getElementById('story-description'),
      statusTag: document.getElementById('story-status-tag'),
      sceneCounter: document.getElementById('scene-counter'),
      sceneImgContainer: document.getElementById('scene-image-container'),
      sceneImg: document.getElementById('scene-image'),
      narrationBanner: document.getElementById('narration-status-banner'),
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
      choiceHeader: document.getElementById('choice-header'),
      choicesList: document.getElementById('choices-list'),
      timerBarWrapper: document.getElementById('timer-bar-wrapper'),
      timerSecondsText: document.getElementById('timer-seconds-text'),
      timerProgressFill: document.getElementById('timer-progress-fill'),
      endingOptions: document.getElementById('ending-options'),
      btnRestartStory: document.getElementById('btn-restart-story'),
      btnLoadAnother: document.getElementById('btn-load-another'),
      dragDropOverlay: document.getElementById('drag-drop-overlay'),
      modalCreator: document.getElementById('modal-creator'),
      btnCloseCreator: document.getElementById('btn-close-creator'),
      btnAddScene: document.getElementById('btn-add-scene'),
      btnExportCyoa: document.getElementById('btn-export-cyoa'),
      toastContainer: document.getElementById('toast-container')
    };
  }

  initEventListeners() {
    const triggerFileSelect = () => { if (this.dom.fileInput) this.dom.fileInput.click(); };

    if (this.dom.btnOpenFile) this.dom.btnOpenFile.onclick = triggerFileSelect;
    if (this.dom.btnHeroOpen) this.dom.btnHeroOpen.onclick = triggerFileSelect;

    if (this.dom.fileInput) {
      this.dom.fileInput.onchange = (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.loadCyoaFile(e.target.files[0]);
        }
      };
    }

    const openCreator = () => {
      this.creator.renderUI();
      if (this.dom.modalCreator) this.dom.modalCreator.classList.remove('hidden');
    };
    if (this.dom.btnCreateStory) this.dom.btnCreateStory.onclick = openCreator;
    if (this.dom.btnHeroCreate) this.dom.btnHeroCreate.onclick = openCreator;
    if (this.dom.btnCloseCreator) this.dom.btnCloseCreator.onclick = () => this.dom.modalCreator.classList.add('hidden');
    if (this.dom.btnAddScene) this.dom.btnAddScene.onclick = () => this.creator.addScene();
    if (this.dom.btnExportCyoa) this.dom.btnExportCyoa.onclick = () => this.creator.exportPackage();

    if (this.dom.audio) {
      this.dom.audio.ontimeupdate = () => this.handleAudioTimeUpdate();
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

    if (this.dom.btnRestartStory) this.dom.btnRestartStory.onclick = () => this.restartStory();
    if (this.dom.btnLoadAnother) this.dom.btnLoadAnother.onclick = () => triggerFileSelect();

    window.onkeydown = (e) => this.handleGlobalKeyDown(e);
  }

  getSceneSettings(scene) {
    const defaults = (this.storyData && this.storyData.defaults) || {};
    let timer = 0;
    if (typeof scene.timer === 'number') timer = scene.timer;
    else if (typeof defaults.timer === 'number') timer = defaults.timer;

    let choiceOffset = 1.5;
    if (typeof scene.choiceOffset === 'number') choiceOffset = scene.choiceOffset;
    else if (typeof scene.choiceDelay === 'number') choiceOffset = scene.choiceDelay;
    else if (typeof defaults.choiceOffset === 'number') choiceOffset = defaults.choiceOffset;

    return { timer, choiceOffset };
  }

  handleAudioTimeUpdate() {
    this.updateAudioProgress();
    if (!this.dom.audio || this.choicesRevealed) return;

    const scene = this.storyData && this.storyData.scenes && this.storyData.scenes[this.currentSceneId];
    if (!scene) return;

    const { choiceOffset } = this.getSceneSettings(scene);
    const dur = this.dom.audio.duration;
    const cur = this.dom.audio.currentTime;

    if (choiceOffset < 0 && dur > 0 && cur >= (dur + choiceOffset)) {
      this.choicesRevealed = true;
      this.soundEngine.playChurchBell();
      this.revealChoices();
    }
  }

  handleAudioEnded() {
    if (this.choicesRevealed) return;

    const scene = this.storyData && this.storyData.scenes && this.storyData.scenes[this.currentSceneId];
    const { choiceOffset } = this.getSceneSettings(scene || {});

    this.updateStatusTag('Waiting for Bell...', 'status-stopped');

    const delayMs = Math.max(0, choiceOffset * 1000);
    this.bellDelayTimer = setTimeout(() => {
      if (!this.choicesRevealed) {
        this.choicesRevealed = true;
        this.soundEngine.playChurchBell();
        this.revealChoices();
      }
    }, delayMs);
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
    this.choicesRevealed = false;
    this.state.visitedScenes.add(sceneId);
    this.state.history.push(sceneId);

    this.clearTimers();
    if (this.dom.choiceContainer) this.dom.choiceContainer.classList.add('hidden');
    if (this.dom.narrationBanner) this.dom.narrationBanner.classList.remove('hidden');
    if (this.dom.autoplayBlocker) this.dom.autoplayBlocker.classList.add('hidden');

    if (this.dom.sceneCounter) this.dom.sceneCounter.textContent = "Scene: " + (scene.title || sceneId);

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

  revealChoices() {
    if (this.dom.narrationBanner) this.dom.narrationBanner.classList.add('hidden');
    if (this.dom.choiceContainer) this.dom.choiceContainer.classList.remove('hidden');

    const scene = this.storyData.scenes[this.currentSceneId];
    const choices = (scene && scene.choices) || [];

    if (this.dom.choicesList) this.dom.choicesList.innerHTML = '';
    if (this.dom.endingOptions) this.dom.endingOptions.classList.add('hidden');

    if (choices.length === 0) {
      if (this.dom.choiceHeader) this.dom.choiceHeader.classList.add('hidden');
      if (this.dom.timerBarWrapper) this.dom.timerBarWrapper.classList.add('hidden');
      if (this.dom.endingOptions) this.dom.endingOptions.classList.remove('hidden');
      this.updateStatusTag('Completed', 'status-stopped');
      return;
    }

    this.updateStatusTag('Awaiting Decision', 'status-awaiting');
    if (this.dom.choiceHeader) this.dom.choiceHeader.classList.remove('hidden');

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

    const { timer } = this.getSceneSettings(scene);
    if (timer > 0) {
      this.startTimedChoiceCountdown(timer, scene.timeoutNext || (choices[0] && choices[0].next));
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
    if (this.dom.audio) this.dom.audio.pause();
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
    if (this.dom.storyWriter) this.dom.storyWriter.textContent = "Writer: " + (this.storyData.scriptWriter || 'Unknown Writer');
    if (this.dom.storyFiller) this.dom.storyFiller.textContent = "Filler: " + (this.storyData.scriptFiller || 'Unknown Filler');
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

  handleGlobalKeyDown(e) {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (e.key === 'Escape') {
      if (this.dom.modalCreator) this.dom.modalCreator.classList.add('hidden');
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
