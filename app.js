/**
 * CHOOSE YOUR OWN AUDIO - PLAYER & CREATOR ENGINE
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
    if (!storyData.tags) storyData.tags = [];
    if (!storyData.variables) storyData.variables = [];
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
}

// 3. STORY CREATOR BUILDER MODULE
class CYOACreator {
  constructor(app) {
    this.app = app;
    this.variables = [];
    this.scenes = [];
    this.initDefaultTemplate();
  }

  initDefaultTemplate() {
    this.variables = [
      { name: "happiness", type: "float", default: 5.0 },
      { name: "hasKey", type: "boolean", default: false }
    ];

    this.scenes = [
      {
        id: "scene001",
        title: "The Beginning",
        timer: 10,
        timeoutNext: "scene002",
        choiceOffset: 0.5,
        audioFile: null,
        secondarySounds: [],
        choices: [
          { text: "Go to Scene 2", next: "scene002", actions: [], conditions: [], gates: [] }
        ]
      },
      {
        id: "scene002",
        title: "The Ending",
        timer: 0,
        timeoutNext: "",
        choiceOffset: 0,
        audioFile: null,
        secondarySounds: [],
        choices: []
      }
    ];
    this.reindexScenes();
  }

  loadStoryDataForEditing(storyData) {
    if (!storyData || !storyData.scenes) return;

    document.getElementById('create-title').value = storyData.title || '';
    document.getElementById('create-script-writer').value = storyData.scriptWriter || '';
    document.getElementById('create-script-filler').value = storyData.scriptFiller || '';
    document.getElementById('create-description').value = storyData.description || '';
    document.getElementById('create-tags').value = Array.isArray(storyData.tags) ? storyData.tags.join(', ') : (storyData.tags || '');

    this.variables = (storyData.variables || []).map(v => ({
      name: v.name,
      type: v.type || 'boolean',
      default: v.default !== undefined ? v.default : (v.type === 'boolean' ? false : (v.type === 'float' ? 0 : ''))
    }));

    const sceneKeys = Object.keys(storyData.scenes);
    this.scenes = sceneKeys.map((key, index) => {
      const sc = storyData.scenes[key];
      let secSounds = [];
      if (Array.isArray(sc.secondarySounds)) {
        secSounds = sc.secondarySounds.map((s, sIdx) => ({
          id: s.id || ("sec_" + sIdx),
          audioFile: null,
          startTime: typeof s.startTime === 'number' ? s.startTime : 0,
          volume: typeof s.volume === 'number' ? s.volume : 1.0,
          persist: Boolean(s.persist),
          conditions: s.conditions || [],
          gates: s.gates || []
        }));
      }

      return {
        id: key,
        title: sc.title || ("Scene " + (index + 1)),
        timer: typeof sc.timer === 'number' ? sc.timer : 0,
        timeoutNext: sc.timeoutNext || "",
        choiceOffset: typeof sc.choiceOffset === 'number' ? sc.choiceOffset : 1.0,
        audioFile: null,
        secondarySounds: secSounds,
        choices: (sc.choices || []).map(c => ({
          text: c.text,
          next: c.next || "",
          actions: c.actions || [],
          conditions: c.conditions || [],
          gates: c.gates || []
        }))
      };
    });

    this.renderUI();
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
    this.renderVariablesUI();
    this.renderScenesUI();
  }

  renderVariablesUI() {
    const container = document.getElementById('variables-list-container');
    if (!container) return;
    container.innerHTML = '';

    this.variables.forEach((v, idx) => {
      const row = document.createElement('div');
      row.className = 'variable-edit-row';

      let defaultInputHtml = '';
      if (v.type === 'boolean') {
        defaultInputHtml = `
          <select class="form-input var-default-input" data-vindex="${idx}" style="flex: 1.2;">
            <option value="false" ${!v.default ? 'selected' : ''}>False</option>
            <option value="true" ${v.default ? 'selected' : ''}>True</option>
          </select>
        `;
      } else if (v.type === 'float') {
        defaultInputHtml = `<input type="number" step="any" class="form-input var-default-input" value="${v.default !== undefined ? v.default : 0}" data-vindex="${idx}" placeholder="Default Float" style="flex: 1.2;" />`;
      } else {
        defaultInputHtml = `<input type="text" class="form-input var-default-input" value="${v.default !== undefined ? v.default : ''}" data-vindex="${idx}" placeholder="Default String" style="flex: 1.2;" />`;
      }

      row.innerHTML = `
        <input type="text" class="form-input var-name-input" value="${v.name}" data-vindex="${idx}" placeholder="Variable Name" style="flex: 1.5;" />
        <select class="form-input var-type-select" data-vindex="${idx}" style="flex: 1;">
          <option value="boolean" ${v.type === 'boolean' ? 'selected' : ''}>Boolean</option>
          <option value="string" ${v.type === 'string' ? 'selected' : ''}>String</option>
          <option value="float" ${v.type === 'float' ? 'selected' : ''}>Float</option>
        </select>
        ${defaultInputHtml}
        <button class="btn btn-danger btn-sm btn-delete-var" data-vindex="${idx}">&times;</button>
      `;
      container.appendChild(row);
    });

    container.querySelectorAll('.var-name-input').forEach(el => {
      el.onchange = (e) => { this.variables[e.target.dataset.vindex].name = e.target.value.trim(); };
    });
    container.querySelectorAll('.var-type-select').forEach(el => {
      el.onchange = (e) => {
        const v = this.variables[e.target.dataset.vindex];
        v.type = e.target.value;
        if (v.type === 'boolean') v.default = false;
        else if (v.type === 'float') v.default = 0;
        else v.default = '';
        this.renderVariablesUI();
      };
    });
    container.querySelectorAll('.var-default-input').forEach(el => {
      el.onchange = (e) => {
        const v = this.variables[e.target.dataset.vindex];
        if (v.type === 'boolean') v.default = (e.target.value.toLowerCase() === 'true');
        else if (v.type === 'float') v.default = parseFloat(e.target.value) || 0;
        else v.default = e.target.value;
      };
    });
    container.querySelectorAll('.btn-delete-var').forEach(el => {
      el.onclick = (e) => {
        this.variables.splice(e.target.dataset.vindex, 1);
        this.renderUI();
      };
    });
  }

  renderScenesUI() {
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
            <label>Primary Audio File (.mp3, .wav, .m4a):</label>
            <input type="file" accept="audio/*" class="form-input scene-audio-input" data-index="${index}" />
            <span class="badge" style="margin-top:4px;">${scene.audioFile ? 'Primary Audio: ' + scene.audioFile.name : 'No primary audio attached'}</span>
          </div>
        </div>

        <div class="secondary-sound-section">
          <div class="section-header">
            <label><strong>Overlaid Secondary Sounds (${(scene.secondarySounds || []).length}):</strong></label>
            <button class="btn btn-secondary btn-sm btn-add-sec-sound" data-index="${index}">+ Add Secondary Sound</button>
          </div>
          <div class="sec-sounds-list" id="sec-sounds-list-${index}"></div>
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

      // Render Secondary Sound Cards with Conditions
      const secListContainer = card.querySelector(`#sec-sounds-list-${index}`);
      (scene.secondarySounds || []).forEach((secSound, secIdx) => {
        const secCard = document.createElement('div');
        secCard.className = 'choice-edit-box';
        secCard.innerHTML = `
          <div class="choice-edit-main-row">
            <span style="font-size: 0.8rem; font-weight: 700; color: var(--accent-purple);">Sound #${secIdx + 1}</span>
            <input type="file" accept="audio/*" class="form-input sec-audio-file-input" data-sindex="${index}" data-secindex="${secIdx}" style="flex:2;" />
            <button class="btn btn-danger btn-sm btn-delete-sec-sound" data-sindex="${index}" data-secindex="${secIdx}">&times;</button>
          </div>
          <div class="form-grid" style="margin-top:0.4rem;">
            <div class="form-group">
              <label>Start Timestamp (Sec):</label>
              <input type="number" step="0.1" min="0" class="form-input sec-start-input" value="${secSound.startTime}" data-sindex="${index}" data-secindex="${secIdx}" />
            </div>
            <div class="form-group">
              <label>Relative Volume (e.g. 1.0, 1.5):</label>
              <input type="number" step="0.1" min="0" class="form-input sec-vol-input" value="${secSound.volume}" data-sindex="${index}" data-secindex="${secIdx}" />
            </div>
            <div class="form-group full-width" style="flex-direction: row; align-items: center; gap: 0.5rem;">
              <input type="checkbox" id="sec-persist-${index}-${secIdx}" class="sec-persist-input" ${secSound.persist ? 'checked' : ''} data-sindex="${index}" data-secindex="${secIdx}" />
              <label for="sec-persist-${index}-${secIdx}" style="margin: 0; cursor: pointer;">Persist Audio Across Scenes</label>
            </div>
          </div>
        `;
        secListContainer.appendChild(secCard);
      });

      // Render Choices List
      const choicesContainer = card.querySelector(`#choices-list-edit-${index}`);
      scene.choices.forEach((choice, cIndex) => {
        const choiceRow = document.createElement('div');
        choiceRow.className = 'choice-edit-box';

        const condCount = choice.conditions ? choice.conditions.length : 0;

        const availableSignalPool = [];
        (choice.conditions || []).forEach((cd, cIdx) => {
          const cId = cd.id || ("C" + (cIdx + 1));
          cd.id = cId;
          availableSignalPool.push({ id: cId, label: `Condition #${cIdx + 1} (${cId})` });
        });

        (choice.gates || []).forEach((gt, gIdx) => {
          const gId = gt.id || ("G" + (gIdx + 1));
          gt.id = gId;
          availableSignalPool.push({ id: gId, label: `Gate #${gIdx + 1} (${gId})` });
        });

        choiceRow.innerHTML = `
          <div class="choice-edit-main-row">
            <input type="text" class="form-input choice-text-input" placeholder="Choice Button Text" value="${choice.text}" data-sindex="${index}" data-cindex="${cIndex}" style="flex:2;" />
            <select class="form-input choice-next-select" data-sindex="${index}" data-cindex="${cIndex}" style="flex:1.5;">
              <option value="">-- Target Scene --</option>
              ${this.scenes.map((s, sIdx) => 
                `<option value="${s.id}" ${choice.next === s.id ? 'selected' : ''}>Scene ${sIdx + 1}: ${s.title || 'Untitled'}</option>`
              ).join('')}
            </select>
            <button class="btn btn-danger btn-sm btn-delete-choice" data-sindex="${index}" data-cindex="${cIndex}">&times;</button>
          </div>

          <div class="choice-sub-editor">
            <div class="sub-editor-header">
              <span>Required Conditions (${condCount}):</span>
              <button class="btn btn-secondary btn-sm btn-add-cond" data-sindex="${index}" data-cindex="${cIndex}">+ Condition</button>
            </div>
            <div class="conditions-list" id="cond-list-${index}-${cIndex}"></div>
          </div>

          ${condCount >= 2 ? `
            <div class="choice-sub-editor" style="border-color: var(--accent-gold);">
              <div class="sub-editor-header">
                <span style="color: var(--accent-gold); font-weight:700;">2-Input Logic Gate Funnel:</span>
                <button class="btn btn-secondary btn-sm btn-add-gate" data-sindex="${index}" data-cindex="${cIndex}">+ Add 2-Input Gate</button>
              </div>
              <div class="gates-list" id="gate-list-${index}-${cIndex}"></div>
            </div>
          ` : ''}

          <div class="choice-sub-editor">
            <div class="sub-editor-header">
              <span>Variable Modifiers (${choice.actions ? choice.actions.length : 0}):</span>
              <button class="btn btn-secondary btn-sm btn-add-act" data-sindex="${index}" data-cindex="${cIndex}">+ Modifier</button>
            </div>
            <div class="actions-list" id="act-list-${index}-${cIndex}"></div>
          </div>
        `;

        choicesContainer.appendChild(choiceRow);

        // Render Condition Rows
        const condContainer = choiceRow.querySelector(`#cond-list-${index}-${cIndex}`);
        (choice.conditions || []).forEach((cond, condIdx) => {
          const selectedVarObj = this.variables.find(v => v.name === cond.var) || this.variables[0] || { type: 'float' };
          const varType = selectedVarObj.type || 'float';

          let opOptions = '';
          if (varType === 'float') {
            opOptions = `
              <option value="==" ${cond.op === '==' ? 'selected' : ''}>Equals (=)</option>
              <option value="!=" ${cond.op === '!=' ? 'selected' : ''}>Does Not Equal (&ne;)</option>
              <option value=">" ${cond.op === '>' ? 'selected' : ''}>Greater Than (&gt;)</option>
              <option value=">=" ${cond.op === '>=' ? 'selected' : ''}>Greater Than or Equal To (&ge;)</option>
              <option value="<" ${cond.op === '<' ? 'selected' : ''}>Less Than (&lt;)</option>
              <option value="<=" ${cond.op === '<=' ? 'selected' : ''}>Less Than or Equal To (&le;)</option>
            `;
          } else {
            opOptions = `
              <option value="==" ${cond.op === '==' ? 'selected' : ''}>Equals (=)</option>
              <option value="!=" ${cond.op === '!=' ? 'selected' : ''}>Does Not Equal (&ne;)</option>
            `;
          }

          let targetSelectOptions = '';
          const sameTypeVars = this.variables.filter(v => v.type === varType && v.name !== cond.var);
          sameTypeVars.forEach(v => {
            targetSelectOptions += `<option value="var:${v.name}" ${cond.targetVar === v.name ? 'selected' : ''}>Variable: ${v.name}</option>`;
          });

          if (varType === 'boolean') {
            targetSelectOptions += `<option value="true" ${cond.value === 'true' || cond.value === true ? 'selected' : ''}>True</option>`;
            targetSelectOptions += `<option value="false" ${cond.value === 'false' || cond.value === false ? 'selected' : ''}>False</option>`;
          } else {
            targetSelectOptions += `<option value="custom" ${cond.targetType === 'custom' || !cond.targetType ? 'selected' : ''}>Custom ${varType === 'float' ? 'Value' : 'Text'}</option>`;
          }

          const isCustom = cond.targetType === 'custom' || !cond.targetType;
          let customInputHtml = '';
          if (varType === 'float' && isCustom) {
            customInputHtml = `<input type="number" step="any" class="form-input cond-val-input" value="${cond.value !== undefined ? cond.value : ''}" placeholder="Number" data-sindex="${index}" data-cindex="${cIndex}" data-condindex="${condIdx}" style="flex:1; min-width:60px;" />`;
          } else if (varType === 'string' && isCustom) {
            customInputHtml = `<input type="text" class="form-input cond-val-input" value="${cond.value !== undefined ? cond.value : ''}" placeholder="Text" data-sindex="${index}" data-cindex="${cIndex}" data-condindex="${condIdx}" style="flex:1; min-width:60px;" />`;
          }

          const condRow = document.createElement('div');
          condRow.className = 'sub-rule-row';
          condRow.innerHTML = `
            <span class="rule-id-tag">${cond.id || ('C' + (condIdx + 1))}</span>
            <select class="form-input cond-unary-select" data-sindex="${index}" data-cindex="${cIndex}" data-condindex="${condIdx}" style="width:65px; flex-shrink:0;">
              <option value="BUFFER" ${(cond.unary || 'BUFFER') === 'BUFFER' ? 'selected' : ''}>If</option>
              <option value="NOT" ${cond.unary === 'NOT' ? 'selected' : ''}>NOT</option>
            </select>
            <select class="form-input cond-var-select" data-sindex="${index}" data-cindex="${cIndex}" data-condindex="${condIdx}" style="flex:1.2; min-width:90px;">
              ${this.variables.map(v => `<option value="${v.name}" ${cond.var === v.name ? 'selected' : ''}>${v.name} (${v.type})</option>`).join('')}
            </select>
            <select class="form-input cond-op-select" data-sindex="${index}" data-cindex="${cIndex}" data-condindex="${condIdx}" style="flex:1.2; min-width:90px;">
              ${opOptions}
            </select>
            <select class="form-input cond-target-select" data-sindex="${index}" data-cindex="${cIndex}" data-condindex="${condIdx}" style="flex:1; min-width:80px;">
              ${targetSelectOptions}
            </select>
            ${customInputHtml}
            <button class="btn btn-danger btn-sm btn-delete-cond" data-sindex="${index}" data-cindex="${cIndex}" data-condindex="${condIdx}">&times;</button>
          `;
          condContainer.appendChild(condRow);
        });

        // Render Binary Gates List
        const gateContainer = choiceRow.querySelector(`#gate-list-${index}-${cIndex}`);
        if (gateContainer) {
          (choice.gates || []).forEach((gate, gIdx) => {
            const gRow = document.createElement('div');
            gRow.className = 'sub-rule-row';
            
            const optA = availableSignalPool.map(sig => `<option value="${sig.id}" ${gate.inputA === sig.id ? 'selected' : ''}>Input A: ${sig.label}</option>`).join('');
            const optB = availableSignalPool.map(sig => `<option value="${sig.id}" ${gate.inputB === sig.id ? 'selected' : ''}>Input B: ${sig.label}</option>`).join('');

            gRow.innerHTML = `
              <span class="rule-id-tag">${gate.id || ('G' + (gIdx + 1))}</span>
              <select class="form-input gate-type-select" data-sindex="${index}" data-cindex="${cIndex}" data-gindex="${gIdx}" style="width:85px; flex-shrink:0;">
                <option value="AND" ${gate.gateType === 'AND' ? 'selected' : ''}>AND</option>
                <option value="OR" ${gate.gateType === 'OR' ? 'selected' : ''}>OR</option>
                <option value="NAND" ${gate.gateType === 'NAND' ? 'selected' : ''}>NAND</option>
                <option value="NOR" ${gate.gateType === 'NOR' ? 'selected' : ''}>NOR</option>
                <option value="XOR" ${gate.gateType === 'XOR' ? 'selected' : ''}>XOR</option>
                <option value="XNOR" ${gate.gateType === 'XNOR' ? 'selected' : ''}>XNOR</option>
              </select>
              <select class="form-input gate-in-a-select" data-sindex="${index}" data-cindex="${cIndex}" data-gindex="${gIdx}" style="flex:1; min-width:110px;">
                ${optA}
              </select>
              <select class="form-input gate-in-b-select" data-sindex="${index}" data-cindex="${cIndex}" data-gindex="${gIdx}" style="flex:1; min-width:110px;">
                ${optB}
              </select>
              <button class="btn btn-danger btn-sm btn-delete-gate" data-sindex="${index}" data-cindex="${cIndex}" data-gindex="${gIdx}">&times;</button>
            `;
            gateContainer.appendChild(gRow);
          });
        }

        // Render Action Rows
        const actContainer = choiceRow.querySelector(`#act-list-${index}-${cIndex}`);
        (choice.actions || []).forEach((act, actIdx) => {
          const selectedVarObj = this.variables.find(v => v.name === act.var) || this.variables[0] || { type: 'float' };
          const varType = selectedVarObj.type || 'float';

          let actOpOptions = '';
          if (varType === 'float') {
            actOpOptions = `
              <option value="set" ${act.op === 'set' ? 'selected' : ''}>Set =</option>
              <option value="add" ${act.op === 'add' ? 'selected' : ''}>Add +</option>
              <option value="subtract" ${act.op === 'subtract' ? 'selected' : ''}>Subtract -</option>
              <option value="multiply" ${act.op === 'multiply' ? 'selected' : ''}>Multiply *</option>
              <option value="divide" ${act.op === 'divide' ? 'selected' : ''}>Divide /</option>
            `;
          } else if (varType === 'boolean') {
            actOpOptions = `
              <option value="set" ${act.op === 'set' ? 'selected' : ''}>Set =</option>
              <option value="toggle" ${act.op === 'toggle' ? 'selected' : ''}>Toggle (&not;)</option>
            `;
          } else {
            actOpOptions = `<option value="set" selected>Set =</option>`;
          }

          const isToggle = act.op === 'toggle';
          let targetSelectHtml = '';
          let customValHtml = '';

          if (!isToggle) {
            let targetSelectOptions = '';
            const sameTypeVars = this.variables.filter(v => v.type === varType && v.name !== act.var);
            sameTypeVars.forEach(v => {
              targetSelectOptions += `<option value="var:${v.name}" ${act.targetVar === v.name ? 'selected' : ''}>Variable: ${v.name}</option>`;
            });

            if (varType === 'boolean') {
              targetSelectOptions += `<option value="true" ${act.value === 'true' || act.value === true ? 'selected' : ''}>True</option>`;
              targetSelectOptions += `<option value="false" ${act.value === 'false' || act.value === false ? 'selected' : ''}>False</option>`;
            } else {
              targetSelectOptions += `<option value="custom" ${act.targetType === 'custom' || !act.targetType ? 'selected' : ''}>Custom ${varType === 'float' ? 'Value' : 'Text'}</option>`;
            }

            targetSelectHtml = `<select class="form-input act-target-select" data-sindex="${index}" data-cindex="${cIndex}" data-actindex="${actIdx}" style="flex:1; min-width:80px;">${targetSelectOptions}</select>`;

            const isCustom = act.targetType === 'custom' || !act.targetType;
            if (varType === 'float' && isCustom) {
              customValHtml = `<input type="number" step="any" class="form-input act-val-input" value="${act.value !== undefined ? act.value : ''}" placeholder="Number" data-sindex="${index}" data-cindex="${cIndex}" data-actindex="${actIdx}" style="flex:1; min-width:60px;" />`;
            } else if (varType === 'string' && isCustom) {
              customValHtml = `<input type="text" class="form-input act-val-input" value="${act.value !== undefined ? act.value : ''}" placeholder="Text" data-sindex="${index}" data-cindex="${cIndex}" data-actindex="${actIdx}" style="flex:1; min-width:60px;" />`;
            }
          }

          const actRow = document.createElement('div');
          actRow.className = 'sub-rule-row';
          actRow.innerHTML = `
            <select class="form-input act-var-select" data-sindex="${index}" data-cindex="${cIndex}" data-actindex="${actIdx}" style="flex:1.2; min-width:90px;">
              ${this.variables.map(v => `<option value="${v.name}" ${act.var === v.name ? 'selected' : ''}>${v.name} (${v.type})</option>`).join('')}
            </select>
            <select class="form-input act-op-select" data-sindex="${index}" data-cindex="${cIndex}" data-actindex="${actIdx}" style="flex:1; min-width:80px;">
              ${actOpOptions}
            </select>
            ${targetSelectHtml}
            ${customValHtml}
            <button class="btn btn-danger btn-sm btn-delete-act" data-sindex="${index}" data-cindex="${cIndex}" data-actindex="${actIdx}">&times;</button>
          `;
          actContainer.appendChild(actRow);
        });
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

    document.querySelectorAll('.btn-add-sec-sound').forEach(el => {
      el.onclick = (e) => {
        const sIdx = e.target.dataset.index;
        if (!this.scenes[sIdx].secondarySounds) this.scenes[sIdx].secondarySounds = [];
        this.scenes[sIdx].secondarySounds.push({
          id: "sec_" + this.scenes[sIdx].secondarySounds.length,
          audioFile: null,
          startTime: 0,
          volume: 1.0,
          persist: false,
          conditions: [],
          gates: []
        });
        this.renderUI();
      };
    });

    document.querySelectorAll('.sec-audio-file-input').forEach(el => {
      el.onchange = (e) => {
        if (e.target.files.length > 0) {
          this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].audioFile = e.target.files[0];
          this.renderUI();
        }
      };
    });

    document.querySelectorAll('.sec-start-input').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].startTime = parseFloat(e.target.value) || 0; };
    });

    document.querySelectorAll('.sec-vol-input').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].volume = parseFloat(e.target.value) || 1.0; };
    });

    document.querySelectorAll('.sec-persist-input').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].persist = e.target.checked; };
    });

    document.querySelectorAll('.btn-delete-sec-sound').forEach(el => {
      el.onclick = (e) => {
        this.scenes[e.target.dataset.sindex].secondarySounds.splice(e.target.dataset.secindex, 1);
        this.renderUI();
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

    document.querySelectorAll('.btn-add-cond').forEach(el => {
      el.onclick = (e) => {
        const s = e.target.dataset.sindex, c = e.target.dataset.cindex;
        if (!this.scenes[s].choices[c].conditions) this.scenes[s].choices[c].conditions = [];
        const conds = this.scenes[s].choices[c].conditions;
        const newId = "C" + (conds.length + 1);
        const firstVar = this.variables[0] ? this.variables[0].name : '';
        conds.push({ id: newId, unary: 'BUFFER', var: firstVar, op: '==', targetType: 'custom', value: '' });
        this.renderUI();
      };
    });

    document.querySelectorAll('.btn-add-gate').forEach(el => {
      el.onclick = (e) => {
        const s = e.target.dataset.sindex, c = e.target.dataset.cindex;
        if (!this.scenes[s].choices[c].gates) this.scenes[s].choices[c].gates = [];
        const gates = this.scenes[s].choices[c].gates;
        const newId = "G" + (gates.length + 1);
        
        const conds = this.scenes[s].choices[c].conditions || [];
        const inA = conds[0] ? conds[0].id : "C1";
        const inB = conds[1] ? conds[1].id : "C2";

        gates.push({ id: newId, gateType: 'AND', inputA: inA, inputB: inB });
        this.renderUI();
      };
    });

    document.querySelectorAll('.btn-add-act').forEach(el => {
      el.onclick = (e) => {
        const s = e.target.dataset.sindex, c = e.target.dataset.cindex;
        if (!this.scenes[s].choices[c].actions) this.scenes[s].choices[c].actions = [];
        const firstVar = this.variables[0] ? this.variables[0].name : '';
        this.scenes[s].choices[c].actions.push({ var: firstVar, op: 'set', targetType: 'custom', value: '' });
        this.renderUI();
      };
    });

    document.querySelectorAll('.cond-unary-select').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].conditions[e.target.dataset.condindex].unary = e.target.value; };
    });
    document.querySelectorAll('.cond-var-select').forEach(el => {
      el.onchange = (e) => {
        const cond = this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].conditions[e.target.dataset.condindex];
        cond.var = e.target.value;
        this.renderUI();
      };
    });
    document.querySelectorAll('.cond-op-select').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].conditions[e.target.dataset.condindex].op = e.target.value; };
    });
    document.querySelectorAll('.cond-target-select').forEach(el => {
      el.onchange = (e) => {
        const cond = this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].conditions[e.target.dataset.condindex];
        const val = e.target.value;
        if (val.startsWith('var:')) {
          cond.targetType = 'variable';
          cond.targetVar = val.substring(4);
        } else if (val === 'true' || val === 'false') {
          cond.targetType = 'custom';
          cond.value = (val === 'true');
        } else {
          cond.targetType = 'custom';
        }
        this.renderUI();
      };
    });
    document.querySelectorAll('.cond-val-input').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].conditions[e.target.dataset.condindex].value = e.target.value; };
    });
    document.querySelectorAll('.btn-delete-cond').forEach(el => {
      el.onclick = (e) => {
        this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].conditions.splice(e.target.dataset.condindex, 1);
        this.renderUI();
      };
    });

    document.querySelectorAll('.gate-type-select').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].gates[e.target.dataset.gindex].gateType = e.target.value; };
    });
    document.querySelectorAll('.gate-in-a-select').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].gates[e.target.dataset.gindex].inputA = e.target.value; };
    });
    document.querySelectorAll('.gate-in-b-select').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].gates[e.target.dataset.gindex].inputB = e.target.value; };
    });
    document.querySelectorAll('.btn-delete-gate').forEach(el => {
      el.onclick = (e) => {
        this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].gates.splice(e.target.dataset.gindex, 1);
        this.renderUI();
      };
    });

    document.querySelectorAll('.act-var-select').forEach(el => {
      el.onchange = (e) => {
        const act = this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].actions[e.target.dataset.actindex];
        act.var = e.target.value;
        this.renderUI();
      };
    });
    document.querySelectorAll('.act-op-select').forEach(el => {
      el.onchange = (e) => {
        const act = this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].actions[e.target.dataset.actindex];
        act.op = e.target.value;
        this.renderUI();
      };
    });
    document.querySelectorAll('.act-target-select').forEach(el => {
      el.onchange = (e) => {
        const act = this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].actions[e.target.dataset.actindex];
        const val = e.target.value;
        if (val.startsWith('var:')) {
          act.targetType = 'variable';
          act.targetVar = val.substring(4);
        } else if (val === 'true' || val === 'false') {
          act.targetType = 'custom';
          act.value = (val === 'true');
        } else {
          act.targetType = 'custom';
        }
        this.renderUI();
      };
    });
    document.querySelectorAll('.act-val-input').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].actions[e.target.dataset.actindex].value = e.target.value; };
    });
    document.querySelectorAll('.btn-delete-act').forEach(el => {
      el.onclick = (e) => {
        this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].actions.splice(e.target.dataset.actindex, 1);
        this.renderUI();
      };
    });

    document.querySelectorAll('.btn-add-choice').forEach(el => {
      el.onclick = (e) => {
        const sIndex = parseInt(e.target.dataset.index, 10);
        const targetScene = this.scenes[sIndex + 1] ? this.scenes[sIndex + 1].id : (this.scenes[0] ? this.scenes[0].id : "");
        this.scenes[sIndex].choices.push({ text: "New Option", next: targetScene, actions: [], conditions: [], gates: [] });
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

  addVariable() {
    this.variables.push({ name: "newVar" + (this.variables.length + 1), type: "float", default: 0 });
    this.renderUI();
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
      secondarySounds: [],
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
    const scriptWriter = document.getElementById('create-script-writer').value.trim();
    const scriptFiller = document.getElementById('create-script-filler').value.trim();
    const description = document.getElementById('create-description').value.trim();
    const rawTags = document.getElementById('create-tags').value.trim();

    if (!scriptWriter) {
      this.app.showToast("Script Writer is a required field.", "error");
      document.getElementById('create-script-writer').focus();
      return;
    }

    if (!scriptFiller) {
      this.app.showToast("Script Filler is a required field.", "error");
      document.getElementById('create-script-filler').focus();
      return;
    }

    if (this.scenes.length === 0) {
      alert("Please add at least one scene to your story.");
      return;
    }

    const tags = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : [];

    this.reindexScenes();

    const zip = new JSZip();
    const manifest = {
      title,
      scriptWriter,
      scriptFiller,
      description,
      tags,
      variables: this.variables,
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

      const secSoundsManifest = [];
      (scene.secondarySounds || []).forEach((sec, idx) => {
        let secPath = "";
        if (sec.audioFile) {
          const ext = sec.audioFile.name.split('.').pop();
          secPath = "audio/" + scene.id + "_sec" + idx + "." + ext;
          audioFolder.file(scene.id + "_sec" + idx + "." + ext, sec.audioFile);
        }
        secSoundsManifest.push({
          id: sec.id || ("sec_" + idx),
          audio: secPath || undefined,
          startTime: sec.startTime,
          volume: sec.volume,
          persist: sec.persist,
          conditions: sec.conditions || [],
          gates: sec.gates || []
        });
      });

      manifest.scenes[scene.id] = {
        title: scene.title,
        audio: audioPath || undefined,
        secondarySounds: secSoundsManifest,
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
    this.settings = { bellEnabled: true, flowchartLineMode: "hover" };
    this.activeObjectUrls = [];
    this.bellDelayTimer = null;
    this.timedChoiceInterval = null;
    this.choicesRevealed = false;
    this.activeSecondaryAudioElements = [];

    try {
      this.initDOMReferences();
      this.creator = new CYOACreator(this);
      this.initEventListeners();
      this.checkUrlQueryParams();
      console.log("CYOAPlayerApp initialized.");
    } catch (err) {
      console.error("Initialization error:", err);
    }
  }

  initDOMReferences() {
    this.dom = {
      fileInput: document.getElementById('file-input'),
      btnOpenFile: document.getElementById('btn-open-file'),
      btnOpenUrl: document.getElementById('btn-open-url'),
      btnCreateStory: document.getElementById('btn-create-story'),
      btnEditCurrent: document.getElementById('btn-edit-current'),
      btnViewFlowchart: document.getElementById('btn-view-flowchart'),
      welcomeScreen: document.getElementById('welcome-screen'),
      playerScreen: document.getElementById('player-screen'),
      btnHeroOpen: document.getElementById('btn-hero-open'),
      btnHeroUrl: document.getElementById('btn-hero-url'),
      btnHeroCreate: document.getElementById('btn-hero-create'),
      storyTitle: document.getElementById('story-title'),
      storyWriter: document.getElementById('story-writer'),
      storyFiller: document.getElementById('story-filler'),
      storyDescription: document.getElementById('story-description'),
      storyTags: document.getElementById('story-tags'),
      statusTag: document.getElementById('story-status-tag'),
      sceneCounter: document.getElementById('scene-counter'),
      centralMediaCard: document.getElementById('central-media-card'),
      audio: document.getElementById('audio-element'),
      progressBar: document.getElementById('progress-bar'),
      progressFill: document.getElementById('progress-fill'),
      volumeFill: document.getElementById('volume-fill'),
      timeCurrent: document.getElementById('time-current'),
      timeDuration: document.getElementById('time-duration'),
      btnPlayPause: document.getElementById('btn-play-pause'),
      iconPlay: document.getElementById('icon-play'),
      iconPause: document.getElementById('icon-pause'),
      btnPrevScene: document.getElementById('btn-prev-scene'),
      btnSkipBack: document.getElementById('btn-skip-back'),
      btnSkipForward: document.getElementById('btn-skip-forward'),
      btnRestartScene: document.getElementById('btn-restart-scene'),
      btnToggleBell: document.getElementById('btn-toggle-bell'),
      iconBellOn: document.getElementById('icon-bell-on'),
      iconBellOff: document.getElementById('icon-bell-off'),
      selectSpeed: document.getElementById('select-speed'),
      btnMute: document.getElementById('btn-mute'),
      iconVolumeHigh: document.getElementById('icon-volume-high'),
      iconVolumeMuted: document.getElementById('icon-volume-muted'),
      volumeSlider: document.getElementById('volume-slider'),
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
      btnAddVariable: document.getElementById('btn-add-variable'),
      btnAddScene: document.getElementById('btn-add-scene'),
      btnExportCyoa: document.getElementById('btn-export-cyoa'),
      modalUrl: document.getElementById('modal-url'),
      btnCloseUrl: document.getElementById('btn-close-url'),
      btnSubmitUrl: document.getElementById('btn-submit-url'),
      inputCyoaUrl: document.getElementById('input-cyoa-url'),
      modalFlowchart: document.getElementById('modal-flowchart'),
      btnCloseFlowchart: document.getElementById('btn-close-flowchart'),
      flowchartContent: document.getElementById('flowchart-content'),
      btnToggleFlowchartLines: document.getElementById('btn-toggle-flowchart-lines'),
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

    const openUrlModal = () => {
      if (this.dom.modalUrl) this.dom.modalUrl.classList.remove('hidden');
      if (this.dom.inputCyoaUrl) this.dom.inputCyoaUrl.focus();
    };
    if (this.dom.btnOpenUrl) this.dom.btnOpenUrl.onclick = openUrlModal;
    if (this.dom.btnHeroUrl) this.dom.btnHeroUrl.onclick = openUrlModal;
    if (this.dom.btnCloseUrl) this.dom.btnCloseUrl.onclick = () => this.dom.modalUrl.classList.add('hidden');

    if (this.dom.btnSubmitUrl) {
      this.dom.btnSubmitUrl.onclick = () => {
        const url = this.dom.inputCyoaUrl ? this.dom.inputCyoaUrl.value.trim() : '';
        if (url) {
          this.dom.modalUrl.classList.add('hidden');
          this.loadCyoaFromUrl(url);
        } else {
          this.showToast("Please enter a valid URL.", "error");
        }
      };
    }

    const openCreator = () => {
      this.creator.renderUI();
      if (this.dom.modalCreator) this.dom.modalCreator.classList.remove('hidden');
    };
    if (this.dom.btnCreateStory) this.dom.btnCreateStory.onclick = openCreator;
    if (this.dom.btnHeroCreate) this.dom.btnHeroCreate.onclick = openCreator;

    if (this.dom.btnEditCurrent) {
      this.dom.btnEditCurrent.onclick = () => {
        if (this.storyData) {
          this.creator.loadStoryDataForEditing(this.storyData);
          if (this.dom.modalCreator) this.dom.modalCreator.classList.remove('hidden');
        } else {
          this.showToast("No story is currently loaded to edit.", "error");
        }
      };
    }

    if (this.dom.btnViewFlowchart) {
      this.dom.btnViewFlowchart.onclick = () => this.openFlowchartModal();
    }
    if (this.dom.btnCloseFlowchart) {
      this.dom.btnCloseFlowchart.onclick = () => this.dom.modalFlowchart.classList.add('hidden');
    }

    if (this.dom.btnToggleFlowchartLines) {
      this.dom.btnToggleFlowchartLines.onclick = () => {
        if (this.settings.flowchartLineMode === 'hover') this.settings.flowchartLineMode = 'all';
        else if (this.settings.flowchartLineMode === 'all') this.settings.flowchartLineMode = 'hidden';
        else this.settings.flowchartLineMode = 'hover';

        this.dom.btnToggleFlowchartLines.textContent = "Lines: " + this.settings.flowchartLineMode.toUpperCase();
        this.renderFlowchart();
      };
    }

    if (this.dom.btnCloseCreator) this.dom.btnCloseCreator.onclick = () => this.dom.modalCreator.classList.add('hidden');
    if (this.dom.btnAddVariable) this.dom.btnAddVariable.onclick = () => this.creator.addVariable();
    if (this.dom.btnAddScene) this.dom.btnAddScene.onclick = () => this.creator.addScene();
    if (this.dom.btnExportCyoa) this.dom.btnExportCyoa.onclick = () => this.creator.exportPackage();

    // Drag and Drop File Support
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (this.dom.dragDropOverlay) this.dom.dragDropOverlay.classList.remove('hidden');
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        if (this.dom.dragDropOverlay) this.dom.dragDropOverlay.classList.add('hidden');
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      if (this.dom.dragDropOverlay) this.dom.dragDropOverlay.classList.add('hidden');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.loadCyoaFile(e.dataTransfer.files[0]);
      }
    });

    if (this.dom.audio) {
      this.dom.audio.ontimeupdate = () => this.handleAudioTimeUpdate();
      this.dom.audio.onloadedmetadata = () => this.updateAudioProgress();
      this.dom.audio.onended = () => this.handleAudioEnded();
      this.dom.audio.onplay = () => {
        this.updateStatusTag('Playing', 'status-playing');
        if (this.dom.iconPlay) this.dom.iconPlay.classList.add('hidden');
        if (this.dom.iconPause) this.dom.iconPause.classList.remove('hidden');
        this.activeSecondaryAudioElements.forEach(item => {
          if (item.triggered && item.audioEl) item.audioEl.play().catch(() => {});
        });
      };
      this.dom.audio.onpause = () => {
        if (!this.dom.audio.ended) {
          this.updateStatusTag('Paused', 'status-stopped');
        }
        if (this.dom.iconPlay) this.dom.iconPlay.classList.remove('hidden');
        if (this.dom.iconPause) this.dom.iconPause.classList.add('hidden');
        this.activeSecondaryAudioElements.forEach(item => {
          if (item.audioEl) item.audioEl.pause();
        });
      };
    }

    if (this.dom.btnPlayPause) this.dom.btnPlayPause.onclick = () => this.togglePlayPause();
    if (this.dom.btnPrevScene) this.dom.btnPrevScene.onclick = () => this.goBack();
    if (this.dom.btnSkipBack) this.dom.btnSkipBack.onclick = () => this.seekRelative(-10);
    if (this.dom.btnSkipForward) this.dom.btnSkipForward.onclick = () => this.seekRelative(10);
    if (this.dom.btnRestartScene) this.dom.btnRestartScene.onclick = () => this.restartCurrentScene();
    if (this.dom.btnToggleBell) this.dom.btnToggleBell.onclick = () => this.toggleBellSetting();

    if (this.dom.progressBar) {
      this.dom.progressBar.oninput = (e) => {
        const targetTime = (e.target.value / 100) * (this.dom.audio.duration || 0);
        if (!isNaN(targetTime)) {
          this.seekToTimestamp(targetTime);
        }
      };
    }

    if (this.dom.selectSpeed) {
      this.dom.selectSpeed.onchange = (e) => {
        const rate = parseFloat(e.target.value);
        if (this.dom.audio) this.dom.audio.playbackRate = rate;
        this.activeSecondaryAudioElements.forEach(item => {
          if (item.audioEl) item.audioEl.playbackRate = rate;
        });
      };
    }

    if (this.dom.volumeSlider) {
      this.dom.volumeSlider.oninput = (e) => {
        const val = parseFloat(e.target.value);
        if (this.dom.audio) {
          this.dom.audio.volume = val;
          this.dom.audio.muted = (val === 0);
        }
        this.syncSecondaryVolumes();
        this.updateVolumeProgress(val);
        this.updateVolumeIcons(val === 0);
      };
    }

    if (this.dom.btnMute) {
      this.dom.btnMute.onclick = () => {
        if (this.dom.audio) {
          this.dom.audio.muted = !this.dom.audio.muted;
          const currentVal = this.dom.audio.muted ? 0 : (this.dom.audio.volume || 1);
          this.syncSecondaryVolumes();
          this.updateVolumeProgress(currentVal);
          this.updateVolumeIcons(this.dom.audio.muted);
        }
      };
    }

    if (this.dom.btnRestartStory) this.dom.btnRestartStory.onclick = () => this.restartStory();
    if (this.dom.btnLoadAnother) this.dom.btnLoadAnother.onclick = () => triggerFileSelect();

    window.onkeydown = (e) => this.handleGlobalKeyDown(e);
  }

  updateVolumeProgress(val) {
    if (this.dom.volumeFill) {
      const pct = Math.max(0, Math.min(100, val * 100));
      this.dom.volumeFill.style.width = pct + "%";
    }
  }

  // --- VARIABLE ENGINE HELPER METHODS ---
  initVariablesState() {
    this.state.variables = {};
    if (this.storyData && Array.isArray(this.storyData.variables)) {
      this.storyData.variables.forEach(v => {
        if (v.type === 'boolean') {
          this.state.variables[v.name] = (String(v.default).toLowerCase() === 'true' || v.default === true);
        } else if (v.type === 'float') {
          this.state.variables[v.name] = parseFloat(v.default) || 0;
        } else {
          this.state.variables[v.name] = String(v.default !== undefined ? v.default : '');
        }
      });
    }
  }

  evalCondition(cond, variables) {
    if (!cond || !cond.var || !(cond.var in variables)) return true;
    const leftVal = variables[cond.var];
    let rightVal;

    if (cond.targetType === 'variable') {
      rightVal = variables[cond.targetVar];
    } else {
      rightVal = cond.value;
    }

    if (typeof leftVal === 'number') {
      rightVal = parseFloat(rightVal) || 0;
    } else if (typeof leftVal === 'boolean') {
      rightVal = (String(rightVal).toLowerCase() === 'true' || rightVal === true);
    } else {
      rightVal = String(rightVal !== undefined ? rightVal : '');
    }

    let result = false;
    switch (cond.op) {
      case '==': result = (leftVal == rightVal); break;
      case '!=': result = (leftVal != rightVal); break;
      case '>':  result = (leftVal > rightVal); break;
      case '>=': result = (leftVal >= rightVal); break;
      case '<':  result = (leftVal < rightVal); break;
      case '<=': result = (leftVal <= rightVal); break;
      default:   result = true; break;
    }

    if (cond.unary === 'NOT') {
      result = !result;
    }
    return result;
  }

  // 2-INPUT BINARY GATE FUNNEL EVALUATOR
  evalGateTree(conditions, gates, variables) {
    if (!conditions || conditions.length === 0) return true;

    const signalValues = {};
    conditions.forEach((c, idx) => {
      const cId = c.id || ("C" + (idx + 1));
      signalValues[cId] = this.evalCondition(c, variables);
    });

    if (conditions.length === 1) {
      const firstId = conditions[0].id || "C1";
      return Boolean(signalValues[firstId]);
    }

    if (!gates || !Array.isArray(gates) || gates.length === 0) {
      return Object.values(signalValues).every(Boolean);
    }

    const computeGate = (type, a, b) => {
      switch ((type || 'AND').toUpperCase()) {
        case 'AND':  return a && b;
        case 'OR':   return a || b;
        case 'NAND': return !(a && b);
        case 'NOR':  return !(a || b);
        case 'XOR':  return (a && !b) || (!a && b);
        case 'XNOR': return !((a && !b) || (!a && b));
        default:     return a && b;
      }
    };

    gates.forEach((g, gIdx) => {
      const gId = g.id || ("G" + (gIdx + 1));
      const valA = Boolean(signalValues[g.inputA]);
      const valB = Boolean(signalValues[g.inputB]);
      signalValues[gId] = computeGate(g.gateType, valA, valB);
    });

    const lastGate = gates[gates.length - 1];
    if (lastGate && lastGate.id && (lastGate.id in signalValues)) {
      return Boolean(signalValues[lastGate.id]);
    }

    return Object.values(signalValues).every(Boolean);
  }

  applyAction(action, variables) {
    if (!action || !action.var || !(action.var in variables)) return;
    const varName = action.var;
    const curType = typeof variables[varName];

    if (curType === 'boolean') {
      if (action.op === 'toggle') {
        variables[varName] = !variables[varName];
        return;
      }
    }

    let sourceVal;
    if (action.targetType === 'variable') {
      sourceVal = variables[action.targetVar];
    } else {
      sourceVal = action.value;
    }

    if (curType === 'boolean') {
      variables[varName] = (String(sourceVal).toLowerCase() === 'true' || sourceVal === true);
    } else if (curType === 'number') {
      const num = parseFloat(sourceVal) || 0;
      switch (action.op) {
        case 'set': variables[varName] = num; break;
        case 'add': variables[varName] += num; break;
        case 'subtract': variables[varName] -= num; break;
        case 'multiply': variables[varName] *= num; break;
        case 'divide': if (num !== 0) variables[varName] /= num; break;
      }
    } else {
      variables[varName] = String(sourceVal !== undefined ? sourceVal : '');
    }
  }

  applyActions(actions, variables) {
    if (!actions || !Array.isArray(actions)) return;
    actions.forEach(a => this.applyAction(a, variables));
  }

  // --- FLOWCHART MODAL METHODS WITH GUTTER ROUTING & CARD HOVER LOGIC ---
  openFlowchartModal() {
    if (!this.storyData) return;
    this.renderFlowchart();
    if (this.dom.modalFlowchart) this.dom.modalFlowchart.classList.remove('hidden');
  }

  renderFlowchart() {
    const container = this.dom.flowchartContent;
    if (!container || !this.storyData || !this.storyData.scenes) return;

    container.innerHTML = '';

    const varsLegend = document.createElement('div');
    varsLegend.className = 'flowchart-vars-legend';
    const varList = (this.storyData.variables || []).map(v => `<span class="var-legend-pill"><strong>${v.name}</strong> (${v.type}): <em>${this.state.variables[v.name] !== undefined ? this.state.variables[v.name] : v.default}</em></span>`).join('');
    varsLegend.innerHTML = `<strong>Global Variables:</strong> ${varList || '<em>None defined</em>'}`;
    container.appendChild(varsLegend);

    const scenes = this.storyData.scenes;
    const startId = this.storyData.start;
    const currentId = this.currentSceneId;

    const levels = {};
    const queue = [{ id: startId, level: 0 }];
    const visited = new Set();

    while (queue.length > 0) {
      const { id, level } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      levels[id] = Math.max(levels[id] || 0, level);

      const sc = scenes[id];
      if (sc) {
        if (sc.timeoutNext && !visited.has(sc.timeoutNext)) {
          queue.push({ id: sc.timeoutNext, level: level + 1 });
        }
        (sc.choices || []).forEach(c => {
          if (c.next && !visited.has(c.next)) {
            queue.push({ id: c.next, level: level + 1 });
          }
        });
      }
    }

    const allKeys = Object.keys(scenes);
    const maxLevel = Math.max(...Object.values(levels), 0);
    allKeys.forEach(key => {
      if (levels[key] === undefined) {
        levels[key] = maxLevel + 1;
      }
    });

    const levelGroups = {};
    allKeys.forEach(key => {
      const lvl = levels[key];
      if (!levelGroups[lvl]) levelGroups[lvl] = [];
      levelGroups[lvl].push(key);
    });

    const treeWrapper = document.createElement('div');
    treeWrapper.className = 'flowchart-tree-wrapper';

    const svgCanvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgCanvas.setAttribute('class', 'flowchart-svg-canvas');

    svgCanvas.innerHTML = `
      <defs>
        <marker id="flowchart-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-gold)"/>
        </marker>
      </defs>
    `;

    treeWrapper.appendChild(svgCanvas);

    const sortedLevels = Object.keys(levelGroups).map(Number).sort((a, b) => a - b);

    sortedLevels.forEach(lvl => {
      const column = document.createElement('div');
      column.className = 'flowchart-column';
      column.dataset.colLevel = lvl;

      levelGroups[lvl].forEach(sceneId => {
        const sc = scenes[sceneId];
        const isStart = sceneId === startId;
        const isCurrent = sceneId === currentId;

        const card = document.createElement('div');
        card.className = `flowchart-node-card ${isStart ? 'node-start' : ''} ${isCurrent ? 'node-current' : ''}`;
        card.dataset.sceneId = sceneId;

        let secAudioBadge = '';
        const secSounds = sc.secondarySounds || [];
        if (secSounds.length > 0) {
          secAudioBadge = `<div class="flowchart-sec-badge">🎵 Overlaid Sounds (${secSounds.length})</div>`;
        }

        let choicesHtml = '';
        if (sc.choices && sc.choices.length > 0) {
          choicesHtml = sc.choices.map((c, idx) => {
            let condText = (c.conditions && c.conditions.length > 0) ? `<div class="flowchart-cond-pill">🔒 Req: ${c.conditions.map(cd => `${cd.unary === 'NOT' ? 'NOT ' : ''}${cd.var} ${cd.op} ${cd.targetType === 'variable' ? cd.targetVar : cd.value}`).join(' & ')}</div>` : '';
            let actText = (c.actions && c.actions.length > 0) ? `<div class="flowchart-act-pill">⚡ ${c.actions.map(a => `${a.var} ${a.op} ${a.targetType === 'variable' ? a.targetVar : a.value}`).join(', ')}</div>` : '';

            return `
              <div class="flowchart-choice-item" data-from="${sceneId}" data-target="${c.next || ''}" data-choice-index="${idx}">
                <div class="choice-main-line">
                  <span class="choice-num">${idx + 1}</span>
                  <span class="choice-label">${c.text}</span>
                  <span class="choice-arrow">&rarr; ${c.next || 'End'}</span>
                </div>
                ${condText}
                ${actText}
              </div>
            `;
          }).join('');
        } else {
          choicesHtml = '<div class="flowchart-ending-tag">&check; Story Endpoint</div>';
        }

        card.innerHTML = `
          <div class="node-header">
            <span class="node-title">${sc.title || sceneId}</span>
            ${isStart ? '<span class="node-badge badge-start">START</span>' : ''}
            ${isCurrent ? '<span class="node-badge badge-current">CURRENT</span>' : ''}
          </div>
          ${secAudioBadge}
          <div class="node-body">
            <div class="node-choices-list">${choicesHtml}</div>
          </div>
          <button class="btn btn-sm btn-primary btn-jump-scene" data-scene-id="${sceneId}">Jump to Scene</button>
        `;

        column.appendChild(card);
      });

      treeWrapper.appendChild(column);
    });

    container.appendChild(treeWrapper);

    container.querySelectorAll('.btn-jump-scene').forEach(btn => {
      btn.onclick = (e) => {
        const targetSceneId = e.currentTarget.dataset.sceneId;
        this.dom.modalFlowchart.classList.add('hidden');
        this.loadScene(targetSceneId, false, true);
      };
    });

    setTimeout(() => this.drawFlowchartConnections(svgCanvas, treeWrapper), 60);
  }

  // GUTTER-BASED ZERO-OVERLAP ROUTING ENGINE & CARD DEFAULT TIMEOUT HOVER HIGHLIGHTING
  drawFlowchartConnections(svg, wrapper) {
    if (!svg || !wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    
    svg.setAttribute('width', wrapper.scrollWidth);
    svg.setAttribute('height', wrapper.scrollHeight);

    svg.querySelectorAll('.flowchart-connection-line').forEach(l => l.remove());

    if (this.settings.flowchartLineMode === 'hidden') return;

    const sceneCards = wrapper.querySelectorAll('.flowchart-node-card');
    const cardMap = {};
    sceneCards.forEach(c => cardMap[c.dataset.sceneId] = c);

    sceneCards.forEach(card => {
      const fromId = card.dataset.sceneId;
      const sceneObj = this.storyData.scenes[fromId];
      const choiceItems = card.querySelectorAll('.flowchart-choice-item');

      // Determine default timeout target for Card Hovering
      let defaultTargetId = sceneObj ? sceneObj.timeoutNext : null;
      if (!defaultTargetId && sceneObj && sceneObj.choices && sceneObj.choices[0]) {
        defaultTargetId = sceneObj.choices[0].next;
      }

      choiceItems.forEach(item => {
        const toId = item.dataset.target;
        const targetCard = cardMap[toId];
        const cIndex = item.dataset.choiceIndex;

        if (toId && targetCard) {
          const itemRect = item.getBoundingClientRect();
          const targetRect = targetCard.getBoundingClientRect();

          const x1 = (itemRect.right - wrapperRect.left) + wrapper.scrollLeft;
          const y1 = (itemRect.top + itemRect.height / 2 - wrapperRect.top) + wrapper.scrollTop;
          
          const x2 = (targetRect.left - wrapperRect.left) + wrapper.scrollLeft;
          const y2 = (targetRect.top + targetRect.height / 2 - wrapperRect.top) + wrapper.scrollTop;

          // Compute Gutter X channel outside of card boxes
          const cardCol = card.parentElement;
          const targetCol = targetCard.parentElement;
          const colRect = cardCol.getBoundingClientRect();

          let gutterX = (colRect.right - wrapperRect.left) + wrapper.scrollLeft + 25;
          if (targetCol && targetCol !== cardCol) {
            const targetColRect = targetCol.getBoundingClientRect();
            if (targetColRect.left > colRect.right) {
              gutterX = (colRect.right - wrapperRect.left) + (targetColRect.left - colRect.right) / 2 + wrapper.scrollLeft;
            }
          }

          // Smooth Orthogonal Path Routing around cards
          const radius = 10;
          const dy = y2 >= y1 ? 1 : -1;
          const dirX = x2 >= gutterX ? 1 : -1;

          let d = '';
          if (Math.abs(y2 - y1) < 12) {
            d = `M ${x1} ${y1} L ${x2} ${y2}`;
          } else {
            d = `M ${x1} ${y1} ` +
                `L ${gutterX - radius} ${y1} ` +
                `Q ${gutterX} ${y1}, ${gutterX} ${y1 + radius * dy} ` +
                `L ${gutterX} ${y2 - radius * dy} ` +
                `Q ${gutterX} ${y2}, ${gutterX + dirX * radius} ${y2} ` +
                `L ${x2} ${y2}`;
          }

          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', d);
          path.setAttribute('class', 'flowchart-connection-line');
          path.setAttribute('data-from', fromId);
          path.setAttribute('data-to', toId);
          path.setAttribute('data-choice-idx', cIndex);
          path.setAttribute('marker-end', 'url(#flowchart-arrow)');

          if (this.settings.flowchartLineMode === 'hover') {
            path.style.display = 'none';
          }

          svg.appendChild(path);

          // Individual Choice Hover Handler
          item.onmouseenter = (e) => {
            e.stopPropagation();
            // Hide all lines from this scene first
            svg.querySelectorAll(`path[data-from="${fromId}"]`).forEach(p => {
              p.classList.remove('line-highlight');
              if (this.settings.flowchartLineMode === 'hover') p.style.display = 'none';
            });
            // Highlight ONLY this choice's line
            path.style.display = 'block';
            path.classList.add('line-highlight');
          };

          item.onmouseleave = (e) => {
            e.stopPropagation();
            if (this.settings.flowchartLineMode === 'hover') {
              path.style.display = 'none';
            }
            path.classList.remove('line-highlight');
          };
        }
      });

      // Card Hover Handler: Highlights ONLY the default timeout choice arrow
      card.onmouseenter = () => {
        svg.querySelectorAll(`path[data-from="${fromId}"]`).forEach(p => {
          p.classList.remove('line-highlight');
          if (this.settings.flowchartLineMode === 'hover') p.style.display = 'none';
        });

        if (defaultTargetId) {
          const defaultPath = svg.querySelector(`path[data-from="${fromId}"][data-to="${defaultTargetId}"]`);
          if (defaultPath) {
            defaultPath.style.display = 'block';
            defaultPath.classList.add('line-highlight');
          }
        }
      };

      card.onmouseleave = () => {
        svg.querySelectorAll(`path[data-from="${fromId}"]`).forEach(p => {
          p.classList.remove('line-highlight');
          if (this.settings.flowchartLineMode === 'hover') p.style.display = 'none';
        });
      };
    });
  }

  checkUrlQueryParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      const url = params.get('story') || params.get('cyoa') || params.get('url');
      if (url) {
        this.loadCyoaFromUrl(url);
      }
    } catch (err) {}
  }

  async loadCyoaFromUrl(url) {
    this.showToast("Fetching story package from URL...", "info");
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("HTTP " + response.status + ": " + response.statusText);
      }
      const blob = await response.blob();
      const filename = url.split('/').pop().split('?')[0] || "downloaded_story.cyoa";
      const file = new File([blob], filename, { type: "application/zip" });
      await this.loadCyoaFile(file);
    } catch (err) {
      console.error(err);
      this.showToast("Failed to fetch story from URL: " + err.message, "error");
    }
  }

  updateMediaCardVisibility() {
    if (!this.dom.centralMediaCard) return;
    const isChoiceVisible = this.dom.choiceContainer && !this.dom.choiceContainer.classList.contains('hidden');

    if (isChoiceVisible) {
      this.dom.centralMediaCard.classList.remove('hidden');
    } else {
      this.dom.centralMediaCard.classList.add('hidden');
    }
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

  // ACCURATE MULTI-TRACK CONDITIONAL SECONDARY AUDIO SYNC
  syncSecondaryAudio() {
    if (!this.dom.audio || this.activeSecondaryAudioElements.length === 0) return;
    const mainCurTime = this.dom.audio.currentTime || 0;

    this.activeSecondaryAudioElements.forEach(item => {
      if (!item.audioEl || !item.audioEl.src) return;
      const startTs = item.startTime || 0;
      const offset = mainCurTime - startTs;
      const duration = item.audioEl.duration || 999999;

      if (offset >= 0 && offset < duration) {
        // Evaluate Secondary Sound Variable Conditions
        const conditionsPassed = this.evalGateTree(item.conditions, item.gates, this.state.variables);

        if (conditionsPassed) {
          if (Math.abs(item.audioEl.currentTime - offset) > 0.3) {
            item.audioEl.currentTime = offset;
          }
          if (!this.dom.audio.paused && item.audioEl.paused) {
            item.audioEl.play().catch(() => {});
          }
          item.triggered = true;
        } else {
          item.audioEl.pause();
        }
      } else {
        if (!item.audioEl.paused) {
          item.audioEl.pause();
        }
      }
    });
  }

  syncSecondaryVolumes() {
    const mainVol = this.dom.audio ? (this.dom.audio.muted ? 0 : this.dom.audio.volume) : 1;
    this.activeSecondaryAudioElements.forEach(item => {
      if (item.audioEl) {
        const relVol = typeof item.relativeVolume === 'number' ? item.relativeVolume : 1.0;
        item.audioEl.volume = Math.max(0, Math.min(1, mainVol * relVol));
      }
    });
  }

  handleAudioTimeUpdate() {
    this.updateAudioProgress();
    if (!this.dom.audio) return;

    this.syncSecondaryAudio();

    if (this.choicesRevealed) return;

    const scene = this.storyData && this.storyData.scenes && this.storyData.scenes[this.currentSceneId];
    if (!scene) return;

    const { choiceOffset } = this.getSceneSettings(scene);
    const dur = this.dom.audio.duration;
    const cur = this.dom.audio.currentTime;

    if (choiceOffset < 0 && dur > 0 && cur >= (dur + choiceOffset)) {
      this.choicesRevealed = true;
      if (this.settings.bellEnabled) {
        this.soundEngine.playChurchBell();
      }
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
        if (this.settings.bellEnabled) {
          this.soundEngine.playChurchBell();
        }
        this.revealChoices();
      }
    }, delayMs);
  }

  toggleBellSetting() {
    this.settings.bellEnabled = !this.settings.bellEnabled;
    if (this.dom.iconBellOn && this.dom.iconBellOff) {
      if (this.settings.bellEnabled) {
        this.dom.iconBellOn.classList.remove('hidden');
        this.dom.iconBellOff.classList.add('hidden');
        this.showToast("Decision chime sound enabled.", "info");
      } else {
        this.dom.iconBellOn.classList.add('hidden');
        this.dom.iconBellOff.classList.remove('hidden');
        this.showToast("Decision chime sound disabled.", "info");
      }
    }
  }

  async loadCyoaFile(file) {
    this.showToast("Loading " + file.name + "...", 'info');
    try {
      this.cleanupCurrentStory();
      const { storyData, zip } = await CYOAParser.parsePackage(file);
      this.storyData = storyData;
      this.zipArchive = zip;

      this.initVariablesState();
      this.renderStoryMetadata();

      if (this.dom.welcomeScreen) this.dom.welcomeScreen.classList.add('hidden');
      if (this.dom.playerScreen) this.dom.playerScreen.classList.remove('hidden');
      if (this.dom.btnEditCurrent) this.dom.btnEditCurrent.classList.remove('hidden');
      if (this.dom.btnViewFlowchart) this.dom.btnViewFlowchart.classList.remove('hidden');

      this.showToast("Loaded " + storyData.title + "!", 'success');
      
      // FILE LOAD: No Autoplay
      this.loadScene(this.storyData.start, false, false);
    } catch (err) {
      console.error(err);
      this.showToast(err.message, 'error');
    }
  }

  async loadScene(sceneId, isBackNav = false, shouldAutoPlay = true) {
    const scene = this.storyData.scenes[sceneId];
    if (!scene) {
      this.showToast("Error: Scene " + sceneId + " not found.", 'error');
      return;
    }

    this.currentSceneId = sceneId;
    this.choicesRevealed = false;
    this.state.visitedScenes.add(sceneId);

    if (!isBackNav) {
      if (this.state.history[this.state.history.length - 1] !== sceneId) {
        this.state.history.push(sceneId);
      }
    }

    this.clearTimers();
    if (this.dom.choiceContainer) this.dom.choiceContainer.classList.add('hidden');

    // Clean non-persisting secondary audio tracks
    const remainingSecAudio = [];
    this.activeSecondaryAudioElements.forEach(item => {
      if (item.persist && item.audioEl && !item.audioEl.paused) {
        remainingSecAudio.push(item);
      } else if (item.audioEl) {
        item.audioEl.pause();
        item.audioEl.src = '';
      }
    });
    this.activeSecondaryAudioElements = remainingSecAudio;

    if (this.dom.sceneCounter) this.dom.sceneCounter.textContent = "Scene: " + (scene.title || sceneId);

    this.updateMediaCardVisibility();

    // Prepare Secondary Audio Tracks
    const secSounds = scene.secondarySounds || [];
    for (let sec of secSounds) {
      if (sec.audio) {
        const sfxUrl = await CYOAParser.extractAudioBlobUrl(this.zipArchive, sec.audio);
        if (sfxUrl) {
          this.activeObjectUrls.push(sfxUrl);
          const audioEl = new Audio(sfxUrl);
          const mainVol = this.dom.audio ? (this.dom.audio.muted ? 0 : this.dom.audio.volume) : 1;
          const relVol = typeof sec.volume === 'number' ? sec.volume : 1.0;
          audioEl.volume = Math.max(0, Math.min(1, mainVol * relVol));

          this.activeSecondaryAudioElements.push({
            audioEl,
            startTime: sec.startTime || 0,
            relativeVolume: relVol,
            persist: Boolean(sec.persist),
            conditions: sec.conditions || [],
            gates: sec.gates || [],
            triggered: false
          });
        }
      }
    }

    if (scene.audio && this.dom.audio) {
      const audioUrl = await CYOAParser.extractAudioBlobUrl(this.zipArchive, scene.audio);
      if (audioUrl) {
        this.activeObjectUrls.push(audioUrl);
        this.dom.audio.src = audioUrl;
        if (this.dom.selectSpeed) this.dom.audio.playbackRate = parseFloat(this.dom.selectSpeed.value);

        if (shouldAutoPlay) {
          try {
            this.soundEngine.init();
            await this.dom.audio.play();
            this.updateStatusTag('Playing', 'status-playing');
          } catch (autoplayErr) {
            this.dom.audio.pause();
            this.updateStatusTag('Paused', 'status-stopped');
          }
        } else {
          this.dom.audio.pause();
          this.dom.audio.currentTime = 0;
          this.updateAudioProgress();
          this.updateStatusTag('Ready to Play', 'status-stopped');
        }
      } else {
        this.showToast("Audio missing for: " + sceneId, 'error');
        this.handleAudioEnded();
      }
    } else {
      this.handleAudioEnded();
    }
  }

  goBack() {
    if (this.state.history.length > 1) {
      this.state.history.pop();
      const prevSceneId = this.state.history[this.state.history.length - 1];
      this.showToast("Returned to previous scene.", "info");
      this.loadScene(prevSceneId, true, true);
    } else {
      this.showToast("Already at the beginning of the story.", "info");
    }
  }

  revealChoices() {
    const scene = this.storyData.scenes[this.currentSceneId];
    const allChoices = (scene && scene.choices) || [];

    // Filter choices with 2-input Binary Gate Funnel evaluation
    const validChoices = allChoices.filter(c => this.evalGateTree(c.conditions, c.gates, this.state.variables));

    const { timer } = this.getSceneSettings(scene);

    // AUTO-BRANCHING RULE: Timer = 0 & 1 Choice
    if (timer === 0 && validChoices.length === 1) {
      const singleChoice = validChoices[0];
      this.applyActions(singleChoice.actions, this.state.variables);
      if (singleChoice.next) {
        this.loadScene(singleChoice.next, false, true);
        return;
      }
    }

    if (this.dom.choiceContainer) this.dom.choiceContainer.classList.remove('hidden');
    if (this.dom.choicesList) this.dom.choicesList.innerHTML = '';
    if (this.dom.endingOptions) this.dom.endingOptions.classList.add('hidden');

    if (validChoices.length === 0) {
      if (this.dom.choiceHeader) this.dom.choiceHeader.classList.add('hidden');
      if (this.dom.timerBarWrapper) this.dom.timerBarWrapper.classList.add('hidden');
      if (this.dom.endingOptions) this.dom.endingOptions.classList.remove('hidden');
      this.updateStatusTag('Completed', 'status-stopped');
      this.updateMediaCardVisibility();
      return;
    }

    this.updateStatusTag('Awaiting Decision', 'status-awaiting');
    if (this.dom.choiceHeader) this.dom.choiceHeader.classList.remove('hidden');

    validChoices.forEach((choice, index) => {
      const btn = document.createElement('button');
      btn.className = 'btn-choice';
      btn.innerHTML = '<span class="choice-key-badge">' + (index + 1) + '</span><span class="choice-text">' + choice.text + '</span>';
      btn.onclick = () => {
        this.soundEngine.playClick();
        this.selectChoice(choice);
      };
      if (this.dom.choicesList) this.dom.choicesList.appendChild(btn);
    });

    if (timer > 0) {
      this.startTimedChoiceCountdown(timer, scene.timeoutNext || (validChoices[0] && validChoices[0].next));
    } else {
      if (this.dom.timerBarWrapper) this.dom.timerBarWrapper.classList.add('hidden');
    }

    this.updateMediaCardVisibility();
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
          this.loadScene(timeoutTargetScene, false, true);
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

    this.applyActions(choice.actions, this.state.variables);

    if (choice.next) {
      this.loadScene(choice.next, false, true);
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

  seekToTimestamp(seconds) {
    if (!this.dom.audio || !this.dom.audio.src) return;
    this.dom.audio.currentTime = seconds;
    this.syncSecondaryAudio();
  }

  seekRelative(seconds) {
    if (!this.dom.audio || !this.dom.audio.src) return;
    const target = Math.max(0, Math.min(this.dom.audio.duration || 0, this.dom.audio.currentTime + seconds));
    this.seekToTimestamp(target);
  }

  restartCurrentScene() {
    if (this.currentSceneId) this.loadScene(this.currentSceneId, true, true);
  }

  restartStory() {
    this.state.history = [];
    this.initVariablesState();
    if (this.storyData && this.storyData.start) this.loadScene(this.storyData.start, false, true);
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

    if (this.dom.storyTags) {
      let tagsList = [];
      if (Array.isArray(this.storyData.tags)) {
        tagsList = this.storyData.tags;
      } else if (typeof this.storyData.tags === 'string' && this.storyData.tags.trim()) {
        tagsList = this.storyData.tags.split(',').map(t => t.trim()).filter(Boolean);
      }

      if (tagsList.length > 0) {
        this.dom.storyTags.innerHTML = '<span class="tags-label">Tags:</span>' + 
          tagsList.map(tag => `<span class="story-tag-badge">${tag}</span>`).join('');
        this.dom.storyTags.classList.remove('hidden');
      } else {
        this.dom.storyTags.classList.add('hidden');
        this.dom.storyTags.innerHTML = '';
      }
    }
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
    this.activeSecondaryAudioElements.forEach(item => {
      if (item.audioEl) {
        item.audioEl.pause();
        item.audioEl.src = '';
      }
    });
    this.activeSecondaryAudioElements = [];
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
      if (this.dom.modalUrl) this.dom.modalUrl.classList.add('hidden');
      if (this.dom.modalFlowchart) this.dom.modalFlowchart.classList.add('hidden');
      return;
    }

    if (this.dom.playerScreen && this.dom.playerScreen.classList.contains('hidden')) return;

    if (e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key, 10) - 1;
      const choices = this.storyData && this.storyData.scenes && this.storyData.scenes[this.currentSceneId] && this.storyData.scenes[this.currentSceneId].choices;
      const validChoices = (choices || []).filter(c => this.evalGateTree(c.conditions, c.gates, this.state.variables));
      if (validChoices && validChoices[idx] && this.choicesRevealed) {
        this.soundEngine.playClick();
        this.selectChoice(validChoices[idx]);
      }
    } else if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      this.togglePlayPause();
    } else if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') {
      e.preventDefault();
      this.seekRelative(-10);
    } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      this.seekRelative(10);
    } else if (e.key === 'b' || e.key === 'B') {
      this.goBack();
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
