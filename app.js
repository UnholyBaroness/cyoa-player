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
  // Recognizes common "share page" links (which serve an HTML viewer, not the raw
  // file) and rewrites them to a direct-download URL where that's actually possible.
  // Browser security (CORS) means this can't be made universal -- a host has to
  // explicitly allow cross-origin reads of the raw bytes for fetch() to work at all,
  // regardless of what URL we ask for. Where that's fundamentally not possible
  // (Mega's links are client-side encrypted and need their own SDK to decrypt),
  // this says so up front instead of attempting and failing confusingly.
  static resolveShareLink(rawUrl) {
    let u;
    try { u = new URL(rawUrl); } catch (e) { return { url: rawUrl }; }
    const host = u.hostname.replace(/^www\./, '');

    if (host === 'mega.nz' || host === 'mega.co.nz') {
      return { unsupported: true, reason: "Mega links are end-to-end encrypted and can only be opened through Mega's own app/SDK -- a direct link fetch can't decrypt the file. Please download it from Mega and use \"Open .cyoa\" instead." };
    }

    if (host === 'drive.google.com') {
      let id = null;
      const m = u.pathname.match(/\/file\/d\/([^/]+)/);
      if (m) id = m[1];
      if (!id) id = u.searchParams.get('id');
      if (id) {
        return {
          url: `https://drive.google.com/uc?export=download&id=${id}`,
          note: "Google Drive link detected — using its direct-download endpoint. Large files or Drive's virus-scan warning page can still block this; if it fails, download the file manually."
        };
      }
    }

    if (host === 'dropbox.com') {
      u.searchParams.set('dl', '1');
      return { url: u.toString(), note: "Dropbox link detected — switched to direct-download mode." };
    }

    if (host === 'github.com') {
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
      if (m) return { url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`, note: "GitHub link detected — using the raw file endpoint." };
    }

    if (host === '1drv.ms' || host === 'onedrive.live.com' || host.endsWith('.sharepoint.com')) {
      return { url: rawUrl, note: "OneDrive link detected — attempting a direct fetch. OneDrive's sharing/CORS settings sometimes block this depending on how the link was shared." };
    }

    return { url: rawUrl };
  }

  // Confirms the fetched bytes actually look like a ZIP (".cyoa" files are ZIPs)
  // rather than, say, an HTML login/share page returned in place of the real file.
  static async looksLikeZip(blob) {
    try {
      const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
      return head[0] === 0x50 && head[1] === 0x4B; // 'P' 'K'
    } catch (e) {
      return false;
    }
  }

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

  static findFileEntry(zip, relativePath) {
    if (!relativePath) return null;
    const normalizedPath = relativePath.replace(/\\/g, '/');
    let fileEntry = zip.file(normalizedPath);
    if (!fileEntry) {
      const fileName = normalizedPath.split('/').pop().toLowerCase();
      const matches = zip.file(new RegExp(fileName + '$', 'i'));
      if (matches.length > 0) fileEntry = matches[0];
    }
    return fileEntry || null;
  }

  static async extractAudioBlobUrl(zip, relativePath) {
    const fileEntry = this.findFileEntry(zip, relativePath);
    if (!fileEntry) return null;
    const blob = await fileEntry.async("blob");
    return URL.createObjectURL(blob);
  }

  // Returns the raw Blob (not an object URL) so it can be re-bundled directly into a
  // freshly-built zip when exporting -- used to carry existing audio forward when a
  // story is edited without the user having to re-upload every audio file.
  static async extractAudioBlob(zip, relativePath) {
    const fileEntry = this.findFileEntry(zip, relativePath);
    if (!fileEntry) return null;
    return fileEntry.async("blob");
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
    this.variables = [];

    this.scenes = [
      {
        id: "scene001",
        title: "",
        timer: 0,
        timeoutNext: "",
        choiceOffset: 1.0,
        audioFile: null,
        existingAudio: null,
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
          existingAudio: s.audio || null,
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
        existingAudio: sc.audio || null,
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

    this.scenes.forEach(sc => {
      sc.choices.forEach(c => this.syncGatesForRuleSet(c));
      (sc.secondarySounds || []).forEach(sec => this.syncGatesForRuleSet(sec));
    });

    this.renderUI();
  }

  reindexScenes() {
    // Two-phase rename through unique temporary IDs. A naive single-pass rename can
    // transiently assign a scene the same ID another not-yet-processed scene still
    // holds (this happens whenever scenes are deleted or reordered), which silently
    // cross-wires whichever choice referenced that ID first. Routing every rename
    // through a guaranteed-unique temp ID first removes that possibility entirely.
    const renameEverywhere = (oldId, newId) => {
      if (!oldId || oldId === newId) return;
      this.scenes.forEach(s => {
        if (s.timeoutNext === oldId) s.timeoutNext = newId;
        s.choices.forEach(c => { if (c.next === oldId) c.next = newId; });
      });
    };

    const originalIds = this.scenes.map(sc => sc.id);

    this.scenes.forEach((sc, i) => {
      const tempId = "__tmp_scene_" + i + "__";
      renameEverywhere(originalIds[i], tempId);
      sc.id = tempId;
    });

    this.scenes.forEach((sc, i) => {
      const num = i + 1;
      const newId = "scene" + (num < 10 ? "00" + num : (num < 100 ? "0" + num : num));
      renameEverywhere(sc.id, newId);
      sc.id = newId;
    });
  }

  // Clears any choice/timeout link that points at a scene about to be deleted (instead
  // of letting reindexScenes() accidentally hand that link to whatever scene inherits
  // the freed-up ID). Returns how many links were cleared so the creator can be told.
  clearReferencesToScene(deletedId) {
    let count = 0;
    this.scenes.forEach(s => {
      if (s.timeoutNext === deletedId) { s.timeoutNext = ''; count++; }
      s.choices.forEach(c => {
        if (c.next === deletedId) { c.next = ''; count++; }
      });
    });
    return count;
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
      el.onchange = (e) => {
        const idx = e.target.dataset.vindex;
        const newName = e.target.value.trim();
        const oldName = this.variables[idx].name;
        if (!newName) { e.target.value = oldName; return; }
        const dup = this.variables.some((v, i) => String(i) !== String(idx) && v.name === newName);
        if (dup) {
          this.app.showToast(`A variable named "${newName}" already exists — pick a different name.`, 'error');
          e.target.value = oldName;
          return;
        }
        this.variables[idx].name = newName;
        if (oldName !== newName) this.renameVariableReferences(oldName, newName);
      };
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
        const idx = e.target.dataset.vindex;
        const removedName = this.variables[idx] && this.variables[idx].name;
        this.variables.splice(idx, 1);
        const cleared = removedName ? this.clearReferencesToVariable(removedName) : 0;
        this.renderUI();
        if (cleared > 0) {
          this.app.showToast(`Deleted "${removedName}". Removed ${cleared} condition/action/gate rule${cleared === 1 ? '' : 's'} that referenced it.`, 'info');
        }
      };
    });
  }

  // Updates every condition/action across choices and secondary sounds that referenced
  // a variable's old name, so renaming a variable doesn't silently orphan its usages.
  renameVariableReferences(oldName, newName) {
    const patch = (list) => {
      (list || []).forEach(entry => {
        if (entry.var === oldName) entry.var = newName;
        if (entry.targetType === 'variable' && entry.targetVar === oldName) entry.targetVar = newName;
      });
    };
    this.scenes.forEach(s => {
      s.choices.forEach(c => { patch(c.conditions); patch(c.actions); });
      (s.secondarySounds || []).forEach(sec => patch(sec.conditions));
    });
  }

  // Removes any condition/action (on choices or secondary sounds) that references a
  // variable about to be deleted, then drops any gate left pointing at a now-missing
  // condition so a funnel doesn't silently break. Returns how many rules were removed.
  // Keeps gates in lock-step with condition count: 2 conditions -> 1 gate, and one
  // more gate per condition after that, auto-wired as a chain (gate 1 combines C1+C2,
  // gate 2 combines gate 1's result with C3, and so on). The user only ever picks
  // each gate's TYPE (AND/OR/...); wiring is never exposed as something to configure.
  syncGatesForRuleSet(owner) {
    const conds = owner.conditions || [];
    const neededGateCount = Math.max(0, conds.length - 1);
    const oldGates = owner.gates || [];
    const newGates = [];
    for (let k = 0; k < neededGateCount; k++) {
      const gateType = oldGates[k] ? oldGates[k].gateType : 'AND';
      const gate = { id: "G" + (k + 1), gateType };
      if (k === 0) {
        gate.inputA = conds[0] ? conds[0].id : '';
        gate.inputB = conds[1] ? conds[1].id : '';
      } else {
        gate.inputA = newGates[k - 1].id;
        gate.inputB = conds[k + 1] ? conds[k + 1].id : '';
      }
      newGates.push(gate);
    }
    owner.gates = newGates;
  }

  // Which signal ids are valid choices for gates[gateIdx]'s inputA/inputB dropdown:
  // any condition, plus any strictly-EARLIER gate (never itself or a later gate --
  // that would reference a value that doesn't exist yet when gates are evaluated in
  // order). From that pool, anything already wired into a DIFFERENT input slot
  // anywhere in this rule set is excluded, so the same signal can't silently feed
  // two places at once -- the user has to un-wire it from its current slot first.
  gateSlotOptions(conditions, gates, gateIdx, slot) {
    const pool = [];
    (conditions || []).forEach((c, i) => pool.push(c.id || ("C" + (i + 1))));
    for (let i = 0; i < gateIdx; i++) pool.push(gates[i].id || ("G" + (i + 1)));

    const claimed = new Set();
    gates.forEach((g, i) => {
      const isThisSlot = (i === gateIdx);
      if (!(isThisSlot && slot === 'A') && g.inputA) claimed.add(g.inputA);
      if (!(isThisSlot && slot === 'B') && g.inputB) claimed.add(g.inputB);
    });

    const currentValue = slot === 'A' ? gates[gateIdx].inputA : gates[gateIdx].inputB;
    return pool.filter(id => id === currentValue || !claimed.has(id));
  }

  clearReferencesToVariable(varName) {
    let count = 0;
    const cleanConditionsAndGates = (conditions, gates) => {
      const withIds = (conditions || []).map((c, idx) => {
        if (!c.id) c.id = "C" + (idx + 1);
        return c;
      });
      const kept = withIds.filter(c => {
        const refsVar = c.var === varName || (c.targetType === 'variable' && c.targetVar === varName);
        if (refsVar) count++;
        return !refsVar;
      });
      const validIds = new Set(kept.map(c => c.id));
      const keptGates = [];
      (gates || []).forEach((g, gIdx) => {
        if (!g.id) g.id = "G" + (gIdx + 1);
        if (validIds.has(g.inputA) && validIds.has(g.inputB)) {
          keptGates.push(g);
          validIds.add(g.id);
        } else {
          count++;
        }
      });
      return { conditions: kept, gates: keptGates };
    };

    this.scenes.forEach(s => {
      s.choices.forEach(c => {
        c.actions = (c.actions || []).filter(a => {
          const refsVar = a.var === varName || (a.targetType === 'variable' && a.targetVar === varName);
          if (refsVar) count++;
          return !refsVar;
        });
        const cleaned = cleanConditionsAndGates(c.conditions, c.gates);
        c.conditions = cleaned.conditions;
        c.gates = cleaned.gates;
      });
      (s.secondarySounds || []).forEach(sec => {
        const cleaned = cleanConditionsAndGates(sec.conditions, sec.gates);
        sec.conditions = cleaned.conditions;
        sec.gates = cleaned.gates;
      });
    });

    return count;
  }

  // Builds a label that always reflects the real current state -- new file staged,
  // existing audio carried over from the loaded package, or nothing attached. Native
  // file inputs reset their own "Choose File" label whenever the surrounding UI is
  // re-rendered, so this badge (not the input itself) is the source of truth shown to
  // the user.
  audioStatusLabel(entry, prefix) {
    if (entry.audioFile) return `${prefix}: ${entry.audioFile.name} (new)`;
    if (entry.existingAudio) return `${prefix}: ${entry.existingAudio.split('/').pop()} (existing)`;
    return `No ${prefix.toLowerCase()} attached`;
  }

  // Builds one condition or gate row for a SECONDARY SOUND's "play only if" editor.
  // Mirrors the choice condition/gate editor's fields and behavior exactly, just
  // scoped to scene.secondarySounds[secIndex] instead of scene.choices[cIndex], and
  // kept on its own sec-cond-* / sec-gate-* class names so its event bindings never
  // collide with the choice editor's.
  buildRuleRow(kind, item, idx, pos, allConditions, allGates) {
    const row = document.createElement('div');
    row.className = 'sub-rule-row';
    const isSec = pos.secindex !== undefined;
    const ownerAttrs = isSec
      ? `data-sindex="${pos.sindex}" data-secindex="${pos.secindex}"`
      : `data-sindex="${pos.sindex}" data-cindex="${pos.cindex}"`;
    const prefix = isSec ? 'sec-' : '';

    if (kind === 'condition') {
      const cond = item;
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
        customInputHtml = `<input type="number" step="any" class="form-input sec-cond-val-input" value="${cond.value !== undefined ? cond.value : ''}" placeholder="Number" data-sindex="${pos.sindex}" data-secindex="${pos.secindex}" data-condindex="${idx}" style="flex:1; min-width:60px;" />`;
      } else if (varType === 'string' && isCustom) {
        customInputHtml = `<input type="text" class="form-input sec-cond-val-input" value="${cond.value !== undefined ? cond.value : ''}" placeholder="Text" data-sindex="${pos.sindex}" data-secindex="${pos.secindex}" data-condindex="${idx}" style="flex:1; min-width:60px;" />`;
      }

      row.innerHTML = `
        <span class="rule-id-tag">${cond.id || ('C' + (idx + 1))}</span>
        <select class="form-input sec-cond-unary-select" data-sindex="${pos.sindex}" data-secindex="${pos.secindex}" data-condindex="${idx}" style="width:65px; flex-shrink:0;">
          <option value="BUFFER" ${(cond.unary || 'BUFFER') === 'BUFFER' ? 'selected' : ''}>If</option>
          <option value="NOT" ${cond.unary === 'NOT' ? 'selected' : ''}>NOT</option>
        </select>
        <select class="form-input sec-cond-var-select" data-sindex="${pos.sindex}" data-secindex="${pos.secindex}" data-condindex="${idx}" style="flex:1.2; min-width:90px;">
          ${this.variables.map(v => `<option value="${v.name}" ${cond.var === v.name ? 'selected' : ''}>${v.name} (${v.type})</option>`).join('')}
        </select>
        <select class="form-input sec-cond-op-select" data-sindex="${pos.sindex}" data-secindex="${pos.secindex}" data-condindex="${idx}" style="flex:1.2; min-width:90px;">
          ${opOptions}
        </select>
        <select class="form-input sec-cond-target-select" data-sindex="${pos.sindex}" data-secindex="${pos.secindex}" data-condindex="${idx}" style="flex:1; min-width:80px;">
          ${targetSelectOptions}
        </select>
        ${customInputHtml}
        <button class="btn btn-danger btn-sm btn-delete-sec-cond" data-sindex="${pos.sindex}" data-secindex="${pos.secindex}" data-condindex="${idx}">&times;</button>
      `;
      return row;
    }

    // kind === 'gate' -- gates are auto-created/removed to match condition count,
    // but which signals feed each one is still user-chosen, just constrained so a
    // signal can't be wired into two inputs at once.
    const gate = item;
    const optionsA = this.gateSlotOptions(allConditions, allGates, idx, 'A');
    const optionsB = this.gateSlotOptions(allConditions, allGates, idx, 'B');
    const buildOptions = (options, current) => {
      let html = `<option value="" ${!current ? 'selected' : ''}>--</option>`;
      html += options.map(id => `<option value="${id}" ${id === current ? 'selected' : ''}>${id}</option>`).join('');
      return html;
    };

    row.innerHTML = `
      <span class="rule-id-tag">${gate.id || ('G' + (idx + 1))}</span>
      <select class="form-input ${prefix}gate-type-select" ${ownerAttrs} data-gindex="${idx}" style="width:80px; flex-shrink:0;">
        <option value="AND" ${gate.gateType === 'AND' ? 'selected' : ''}>AND</option>
        <option value="OR" ${gate.gateType === 'OR' ? 'selected' : ''}>OR</option>
        <option value="NAND" ${gate.gateType === 'NAND' ? 'selected' : ''}>NAND</option>
        <option value="NOR" ${gate.gateType === 'NOR' ? 'selected' : ''}>NOR</option>
        <option value="XOR" ${gate.gateType === 'XOR' ? 'selected' : ''}>XOR</option>
        <option value="XNOR" ${gate.gateType === 'XNOR' ? 'selected' : ''}>XNOR</option>
      </select>
      <select class="form-input ${prefix}gate-in-a-select" ${ownerAttrs} data-gindex="${idx}" style="flex:1; min-width:70px;">
        ${buildOptions(optionsA, gate.inputA)}
      </select>
      <span class="gate-combine-label">&amp;</span>
      <select class="form-input ${prefix}gate-in-b-select" ${ownerAttrs} data-gindex="${idx}" style="flex:1; min-width:70px;">
        ${buildOptions(optionsB, gate.inputB)}
      </select>
    `;
    return row;
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
          <span class="scene-tag">Scene ${index + 1}${scene.title ? ' (' + scene.title + ')' : ''}</span>
          <div class="scene-header-actions">
            <button class="btn btn-secondary btn-sm btn-move-scene-up" data-index="${index}" title="Move scene earlier" ${index === 0 ? 'disabled' : ''}>&uarr;</button>
            <button class="btn btn-secondary btn-sm btn-move-scene-down" data-index="${index}" title="Move scene later" ${index === this.scenes.length - 1 ? 'disabled' : ''}>&darr;</button>
            ${this.scenes.length > 1 ? `<button class="btn btn-danger btn-sm btn-delete-scene" data-index="${index}">Delete Scene</button>` : ''}
          </div>
        </div>
        <div class="form-grid">
          <div class="form-group full-width">
            <label>Scene Title:</label>
            <input type="text" class="form-input scene-title-input" value="${scene.title}" data-index="${index}" placeholder="Scene Title" />
          </div>
          <div class="form-group full-width">
            <label>Primary Audio File (.mp3, .wav, .m4a):</label>
            <input type="file" accept="audio/*" class="form-input scene-audio-input" data-index="${index}" />
            <span class="audio-status-row">
              <span class="badge ${scene.audioFile || scene.existingAudio ? 'badge-audio-ok' : 'badge-audio-none'}">${this.audioStatusLabel(scene, 'Primary audio')}</span>
              ${(scene.audioFile || scene.existingAudio) ? `<button type="button" class="btn-text-link btn-remove-scene-audio" data-index="${index}">Remove</button>` : ''}
            </span>
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
        const secCondCount = secSound.conditions ? secSound.conditions.length : 0;
        const secCard = document.createElement('div');
        secCard.className = 'choice-edit-box';
        secCard.innerHTML = `
          <div class="choice-edit-main-row">
            <span class="sec-sound-label">Sound #${secIdx + 1}</span>
            <input type="file" accept="audio/*" class="form-input sec-audio-file-input" data-sindex="${index}" data-secindex="${secIdx}" style="flex:2;" />
            <button class="btn btn-danger btn-sm btn-delete-sec-sound" data-sindex="${index}" data-secindex="${secIdx}">&times;</button>
          </div>
          <div class="audio-status-row">
            <span class="badge ${secSound.audioFile || secSound.existingAudio ? 'badge-audio-ok' : 'badge-audio-none'}">${this.audioStatusLabel(secSound, 'Sound audio')}</span>
            ${(secSound.audioFile || secSound.existingAudio) ? `<button type="button" class="btn-text-link btn-remove-sec-audio" data-sindex="${index}" data-secindex="${secIdx}">Remove</button>` : ''}
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
          <div class="choice-sub-editor">
            <div class="sub-editor-header">
              <span>Play Only If (${secCondCount}):</span>
              <button class="btn btn-secondary btn-sm btn-add-sec-cond" data-sindex="${index}" data-secindex="${secIdx}">+ Condition</button>
            </div>
            <div class="conditions-list" id="sec-cond-list-${index}-${secIdx}"></div>
            ${secCondCount === 0 ? '<div class="empty-hint">No conditions — this sound always plays when its start time is reached.</div>' : ''}
          </div>
          ${secCondCount >= 2 ? `
            <div class="choice-sub-editor" style="border-color: var(--accent-gold);">
              <div class="sub-editor-header">
                <span style="color: var(--accent-gold); font-weight:700;">Combine Conditions:</span>
              </div>
              <div class="gates-list" id="sec-gate-list-${index}-${secIdx}"></div>
            </div>
          ` : ''}
        `;
        secListContainer.appendChild(secCard);

        (secSound.conditions || []).forEach((cd, cIdx) => { cd.id = cd.id || ("C" + (cIdx + 1)); });
        (secSound.gates || []).forEach((gt, gIdx) => { gt.id = gt.id || ("G" + (gIdx + 1)); });

        const secCondContainer = secCard.querySelector(`#sec-cond-list-${index}-${secIdx}`);
        (secSound.conditions || []).forEach((cond, condIdx) => {
          secCondContainer.appendChild(this.buildRuleRow('condition', cond, condIdx, { sindex: index, secindex: secIdx }));
        });

        const secGateContainer = secCard.querySelector(`#sec-gate-list-${index}-${secIdx}`);
        if (secGateContainer) {
          (secSound.gates || []).forEach((gate, gIdx) => {
            secGateContainer.appendChild(this.buildRuleRow('gate', gate, gIdx, { sindex: index, secindex: secIdx }, secSound.conditions, secSound.gates));
          });
        }
      });

      // Render Choices List
      const choicesContainer = card.querySelector(`#choices-list-edit-${index}`);
      scene.choices.forEach((choice, cIndex) => {
        const choiceRow = document.createElement('div');
        choiceRow.className = 'choice-edit-box';

        const condCount = choice.conditions ? choice.conditions.length : 0;

        (choice.conditions || []).forEach((cd, cIdx) => { cd.id = cd.id || ("C" + (cIdx + 1)); });
        (choice.gates || []).forEach((gt, gIdx) => { gt.id = gt.id || ("G" + (gIdx + 1)); });

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
                <span style="color: var(--accent-gold); font-weight:700;">Combine Conditions:</span>
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

        // Render Binary Gates List (auto-created chain: N conditions -> N-1 gates;
        // inputs are user-choosable but exclusivity-constrained -- see buildRuleRow)
        const gateContainer = choiceRow.querySelector(`#gate-list-${index}-${cIndex}`);
        if (gateContainer) {
          (choice.gates || []).forEach((gate, gIdx) => {
            gateContainer.appendChild(this.buildRuleRow('gate', gate, gIdx, { sindex: index, cindex: cIndex }, choice.conditions, choice.gates));
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
          const scene = this.scenes[e.target.dataset.index];
          scene.audioFile = e.target.files[0];
          scene.existingAudio = null;
          this.renderUI();
        }
      };
    });

    // Secondary Sound Handlers
    document.querySelectorAll('.btn-add-sec-sound').forEach(el => {
      el.onclick = (e) => {
        const sIdx = e.target.dataset.index;
        if (!this.scenes[sIdx].secondarySounds) this.scenes[sIdx].secondarySounds = [];
        const list = this.scenes[sIdx].secondarySounds;
        const usedNums = list.map(s => parseInt(String(s.id).replace(/\D/g, ''), 10) || 0);
        const nextNum = usedNums.length > 0 ? Math.max(...usedNums) + 1 : 0;
        list.push({
          id: "sec_" + nextNum,
          audioFile: null,
          existingAudio: null,
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
          const sec = this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex];
          sec.audioFile = e.target.files[0];
          sec.existingAudio = null;
          this.renderUI();
        }
      };
    });

    document.querySelectorAll('.btn-remove-scene-audio').forEach(el => {
      el.onclick = (e) => {
        const scene = this.scenes[e.target.dataset.index];
        scene.audioFile = null;
        scene.existingAudio = null;
        this.renderUI();
      };
    });

    document.querySelectorAll('.btn-remove-sec-audio').forEach(el => {
      el.onclick = (e) => {
        const sec = this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex];
        sec.audioFile = null;
        sec.existingAudio = null;
        this.renderUI();
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

    // Secondary Sound "Play Only If" condition/gate handlers -- mirrors the choice
    // condition/gate handlers below, scoped to secondarySounds[secindex] instead.
    document.querySelectorAll('.btn-add-sec-cond').forEach(el => {
      el.onclick = (e) => {
        const sec = this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex];
        if (!sec.conditions) sec.conditions = [];
        const newId = "C" + (sec.conditions.length + 1);
        const firstVar = this.variables[0] ? this.variables[0].name : '';
        sec.conditions.push({ id: newId, unary: 'BUFFER', var: firstVar, op: '==', targetType: 'custom', value: '' });
        this.syncGatesForRuleSet(sec);
        this.renderUI();
      };
    });
    document.querySelectorAll('.sec-cond-unary-select').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].conditions[e.target.dataset.condindex].unary = e.target.value; };
    });
    document.querySelectorAll('.sec-cond-var-select').forEach(el => {
      el.onchange = (e) => {
        const cond = this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].conditions[e.target.dataset.condindex];
        cond.var = e.target.value;
        this.renderUI();
      };
    });
    document.querySelectorAll('.sec-cond-op-select').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].conditions[e.target.dataset.condindex].op = e.target.value; };
    });
    document.querySelectorAll('.sec-cond-target-select').forEach(el => {
      el.onchange = (e) => {
        const cond = this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].conditions[e.target.dataset.condindex];
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
    document.querySelectorAll('.sec-cond-val-input').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].conditions[e.target.dataset.condindex].value = e.target.value; };
    });
    document.querySelectorAll('.btn-delete-sec-cond').forEach(el => {
      el.onclick = (e) => {
        const sec = this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex];
        sec.conditions.splice(e.target.dataset.condindex, 1);
        this.syncGatesForRuleSet(sec);
        this.renderUI();
      };
    });
    document.querySelectorAll('.sec-gate-type-select').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].gates[e.target.dataset.gindex].gateType = e.target.value; };
    });
    document.querySelectorAll('.sec-gate-in-a-select').forEach(el => {
      el.onchange = (e) => {
        this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].gates[e.target.dataset.gindex].inputA = e.target.value;
        this.renderUI();
      };
    });
    document.querySelectorAll('.sec-gate-in-b-select').forEach(el => {
      el.onchange = (e) => {
        this.scenes[e.target.dataset.sindex].secondarySounds[e.target.dataset.secindex].gates[e.target.dataset.gindex].inputB = e.target.value;
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
        this.syncGatesForRuleSet(this.scenes[s].choices[c]);
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
        const choice = this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex];
        choice.conditions.splice(e.target.dataset.condindex, 1);
        this.syncGatesForRuleSet(choice);
        this.renderUI();
      };
    });

    document.querySelectorAll('.gate-type-select').forEach(el => {
      el.onchange = (e) => { this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].gates[e.target.dataset.gindex].gateType = e.target.value; };
    });
    document.querySelectorAll('.gate-in-a-select').forEach(el => {
      el.onchange = (e) => {
        this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].gates[e.target.dataset.gindex].inputA = e.target.value;
        this.renderUI();
      };
    });
    document.querySelectorAll('.gate-in-b-select').forEach(el => {
      el.onchange = (e) => {
        this.scenes[e.target.dataset.sindex].choices[e.target.dataset.cindex].gates[e.target.dataset.gindex].inputB = e.target.value;
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
        const idx = parseInt(e.target.dataset.index, 10);
        const removedId = this.scenes[idx] && this.scenes[idx].id;
        this.scenes.splice(idx, 1);
        const cleared = removedId ? this.clearReferencesToScene(removedId) : 0;
        this.reindexScenes();
        this.renderUI();
        if (cleared > 0) {
          this.app.showToast(`Deleted scene. Cleared ${cleared} choice/timeout link${cleared === 1 ? '' : 's'} that pointed to it — look for "-- Target Scene --" to reassign ${cleared === 1 ? 'it' : 'them'}.`, 'info');
        }
      };
    });

    document.querySelectorAll('.btn-move-scene-up').forEach(el => {
      el.onclick = (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        if (idx <= 0) return;
        [this.scenes[idx - 1], this.scenes[idx]] = [this.scenes[idx], this.scenes[idx - 1]];
        this.reindexScenes();
        this.renderUI();
      };
    });
    document.querySelectorAll('.btn-move-scene-down').forEach(el => {
      el.onclick = (e) => {
        const idx = parseInt(e.target.dataset.index, 10);
        if (idx >= this.scenes.length - 1) return;
        [this.scenes[idx], this.scenes[idx + 1]] = [this.scenes[idx + 1], this.scenes[idx]];
        this.reindexScenes();
        this.renderUI();
      };
    });

    document.querySelectorAll('.btn-move-choice-up').forEach(el => {
      el.onclick = (e) => {
        const s = e.target.dataset.sindex, cIdx = parseInt(e.target.dataset.cindex, 10);
        if (cIdx <= 0) return;
        const arr = this.scenes[s].choices;
        [arr[cIdx - 1], arr[cIdx]] = [arr[cIdx], arr[cIdx - 1]];
        this.renderUI();
      };
    });
    document.querySelectorAll('.btn-move-choice-down').forEach(el => {
      el.onclick = (e) => {
        const s = e.target.dataset.sindex, cIdx = parseInt(e.target.dataset.cindex, 10);
        const arr = this.scenes[s].choices;
        if (cIdx >= arr.length - 1) return;
        [arr[cIdx], arr[cIdx + 1]] = [arr[cIdx + 1], arr[cIdx]];
        this.renderUI();
      };
    });
  }

  addVariable() {
    let n = this.variables.length + 1;
    let name = "newVar" + n;
    while (this.variables.some(v => v.name === name)) { n++; name = "newVar" + n; }
    this.variables.push({ name, type: "float", default: 0 });
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
      existingAudio: null,
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

    let carriedOverCount = 0;

    for (let scene of this.scenes) {
      let audioPath = "";
      if (scene.audioFile) {
        const ext = scene.audioFile.name.split('.').pop();
        audioPath = "audio/" + scene.id + "." + ext;
        audioFolder.file(scene.id + "." + ext, scene.audioFile);
      } else if (scene.existingAudio && this.app.zipArchive) {
        const bytes = await CYOAParser.extractAudioBlob(this.app.zipArchive, scene.existingAudio);
        if (bytes) {
          const ext = scene.existingAudio.split('.').pop() || 'mp3';
          audioPath = "audio/" + scene.id + "." + ext;
          audioFolder.file(scene.id + "." + ext, bytes);
          carriedOverCount++;
        }
      }

      const secSoundsManifest = [];
      const secSounds = scene.secondarySounds || [];
      for (let idx = 0; idx < secSounds.length; idx++) {
        const sec = secSounds[idx];
        let secPath = "";
        if (sec.audioFile) {
          const ext = sec.audioFile.name.split('.').pop();
          secPath = "audio/" + scene.id + "_sec" + idx + "." + ext;
          audioFolder.file(scene.id + "_sec" + idx + "." + ext, sec.audioFile);
        } else if (sec.existingAudio && this.app.zipArchive) {
          const bytes = await CYOAParser.extractAudioBlob(this.app.zipArchive, sec.existingAudio);
          if (bytes) {
            const ext = sec.existingAudio.split('.').pop() || 'mp3';
            secPath = "audio/" + scene.id + "_sec" + idx + "." + ext;
            audioFolder.file(scene.id + "_sec" + idx + "." + ext, bytes);
            carriedOverCount++;
          }
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
      }

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

    const carryNote = carriedOverCount > 0 ? ` (${carriedOverCount} existing audio file${carriedOverCount === 1 ? '' : 's'} carried over)` : '';
    this.app.showToast("Export complete! .cyoa file downloaded." + carryNote, "success");
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
    this.lastNonZeroVolume = 1;

    try {
      this.initDOMReferences();
      this.creator = new CYOACreator(this);
      this.initEventListeners();
      this.loadPrefs();
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
      toastContainer: document.getElementById('toast-container'),
      btnToggleTheme: document.getElementById('btn-toggle-theme'),
      iconThemeLight: document.getElementById('icon-theme-light'),
      iconThemeDark: document.getElementById('icon-theme-dark'),
      btnShortcuts: document.getElementById('btn-shortcuts'),
      modalShortcuts: document.getElementById('modal-shortcuts'),
      btnCloseShortcuts: document.getElementById('btn-close-shortcuts'),
      btnZoomIn: document.getElementById('btn-flowchart-zoom-in'),
      btnZoomOut: document.getElementById('btn-flowchart-zoom-out'),
      btnZoomReset: document.getElementById('btn-flowchart-zoom-reset')
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
        this.savePrefs();
      };
    }
    if (this.dom.btnZoomIn) this.dom.btnZoomIn.onclick = () => this.setFlowchartZoom((this.flowchartZoom || 1) + 0.15);
    if (this.dom.btnZoomOut) this.dom.btnZoomOut.onclick = () => this.setFlowchartZoom((this.flowchartZoom || 1) - 0.15);
    if (this.dom.btnZoomReset) this.dom.btnZoomReset.onclick = () => this.setFlowchartZoom(1);

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
    if (this.dom.btnToggleTheme) this.dom.btnToggleTheme.onclick = () => this.toggleTheme();
    if (this.dom.btnShortcuts) {
      this.dom.btnShortcuts.onclick = () => {
        if (this.dom.modalShortcuts) this.dom.modalShortcuts.classList.remove('hidden');
      };
    }
    if (this.dom.btnCloseShortcuts) {
      this.dom.btnCloseShortcuts.onclick = () => this.dom.modalShortcuts.classList.add('hidden');
    }

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
        if (val > 0) this.lastNonZeroVolume = val;
        if (this.dom.audio) {
          this.dom.audio.volume = val;
          this.dom.audio.muted = (val === 0);
        }
        this.syncSecondaryVolumes();
        this.updateVolumeProgress(val);
        this.updateVolumeIcons(val === 0);
        this.savePrefs();
      };
    }

    if (this.dom.btnMute) {
      this.dom.btnMute.onclick = () => {
        if (this.dom.audio) {
          const willMute = !this.dom.audio.muted;
          this.dom.audio.muted = willMute;
          // Un-muting when the actual volume is 0 (e.g. the slider was dragged all the
          // way down, which auto-mutes) used to just report "full volume" visually
          // without ever restoring a real, audible volume. Restore one explicitly.
          if (!willMute && this.dom.audio.volume === 0) {
            this.dom.audio.volume = this.lastNonZeroVolume > 0 ? this.lastNonZeroVolume : 1;
          }
          const currentVal = this.dom.audio.muted ? 0 : this.dom.audio.volume;
          if (this.dom.volumeSlider) this.dom.volumeSlider.value = currentVal;
          this.syncSecondaryVolumes();
          this.updateVolumeProgress(currentVal);
          this.updateVolumeIcons(this.dom.audio.muted);
          this.savePrefs();
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

  // --- FLOWCHART MODAL METHODS WITH GUTTER ROUTING & CARD HOVER RESTORATION ---
  openFlowchartModal() {
    if (!this.storyData) return;
    if (typeof this.flowchartZoom !== 'number') this.flowchartZoom = 1;
    this.renderFlowchart();
    if (this.dom.modalFlowchart) this.dom.modalFlowchart.classList.remove('hidden');
  }

  setFlowchartZoom(z) {
    this.flowchartZoom = Math.max(0.5, Math.min(1.5, Math.round(z * 100) / 100));
    if (this.flowchartWrapperEl) {
      this.flowchartWrapperEl.style.setProperty('--fc-scale', this.flowchartZoom);
      this.updateFlowchartViewportSize();
      requestAnimationFrame(() => requestAnimationFrame(() => this.drawFlowchartConnections(this.flowchartSvgEl, this.flowchartWrapperEl)));
    }
    if (this.dom.btnZoomReset) this.dom.btnZoomReset.textContent = Math.round(this.flowchartZoom * 100) + "%";
  }

  // The tree wrapper is visually scaled with a CSS transform (so text, spacing, and
  // everything else scale together instead of just card width -- which used to leave
  // fonts/padding full-size inside a narrowed box and forced word-by-word wrapping).
  // A transform doesn't change how much space an element reserves in the page though,
  // so its viewport parent is explicitly resized to the scaled footprint -- otherwise
  // the scroll area stays full-size and zooming out just leaves dead space.
  updateFlowchartViewportSize() {
    if (!this.flowchartWrapperEl || !this.flowchartViewportEl) return;
    const zoom = this.flowchartZoom || 1;
    this.flowchartViewportEl.style.width = (this.flowchartWrapperEl.scrollWidth * zoom) + 'px';
    this.flowchartViewportEl.style.height = (this.flowchartWrapperEl.scrollHeight * zoom) + 'px';
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
    const allKeys = Object.keys(scenes);

    // --- Rank assignment: BFS shortest-path distance from Start ---
    const levels = {};
    const queue = [{ id: startId, level: 0 }];
    const visited = new Set();
    const predecessors = {};
    allKeys.forEach(k => predecessors[k] = []);
    const addEdge = (from, to) => { if (to && scenes[to]) predecessors[to].push(from); };
    allKeys.forEach(id => {
      const sc = scenes[id];
      if (sc.timeoutNext) addEdge(id, sc.timeoutNext);
      (sc.choices || []).forEach(c => addEdge(id, c.next));
    });

    while (queue.length > 0) {
      const { id, level } = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      levels[id] = Math.max(levels[id] || 0, level);
      const sc = scenes[id];
      if (sc) {
        if (sc.timeoutNext && !visited.has(sc.timeoutNext)) queue.push({ id: sc.timeoutNext, level: level + 1 });
        (sc.choices || []).forEach(c => { if (c.next && !visited.has(c.next)) queue.push({ id: c.next, level: level + 1 }); });
      }
    }

    const reachableLevels = Object.values(levels);
    const maxReachableLevel = reachableLevels.length ? Math.max(...reachableLevels) : 0;
    const unreachableLevel = maxReachableLevel + 1;
    let hasUnreachable = false;
    allKeys.forEach(key => {
      if (levels[key] === undefined) { levels[key] = unreachableLevel; hasUnreachable = true; }
    });

    const levelGroups = {};
    allKeys.forEach(key => {
      const lvl = levels[key];
      if (!levelGroups[lvl]) levelGroups[lvl] = [];
      levelGroups[lvl].push(key);
    });
    const sortedLevels = Object.keys(levelGroups).map(Number).sort((a, b) => a - b);
    if (levelGroups[0]) levelGroups[0].sort((a, b) => (a === startId ? -1 : b === startId ? 1 : 0));

    // --- Barycenter pass: order each rank near the average position of its
    // predecessors in the immediately preceding rank, to cut down crossing lines. ---
    const positionIndex = {};
    sortedLevels.forEach(lvl => levelGroups[lvl].forEach((id, i) => { positionIndex[id] = i; }));
    for (let li = 1; li < sortedLevels.length; li++) {
      const lvl = sortedLevels[li];
      const prevSet = new Set(levelGroups[sortedLevels[li - 1]]);
      const withKeys = levelGroups[lvl].map((id, originalIdx) => {
        const preds = predecessors[id].filter(p => prevSet.has(p));
        const key = preds.length > 0
          ? preds.reduce((sum, p) => sum + positionIndex[p], 0) / preds.length
          : (originalIdx + 1000);
        return { id, key };
      });
      withKeys.sort((a, b) => a.key - b.key);
      levelGroups[lvl] = withKeys.map(w => w.id);
      levelGroups[lvl].forEach((id, i) => { positionIndex[id] = i; });
    }

    const treeWrapper = document.createElement('div');
    treeWrapper.className = 'flowchart-tree-wrapper';
    treeWrapper.style.setProperty('--fc-scale', this.flowchartZoom || 1);

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

    sortedLevels.forEach(lvl => {
      const column = document.createElement('div');
      column.className = 'flowchart-column';
      column.dataset.colLevel = lvl;

      if (hasUnreachable && lvl === unreachableLevel) {
        const label = document.createElement('div');
        label.className = 'flowchart-unreachable-label';
        label.textContent = 'Not reachable from Start';
        column.appendChild(label);
      }

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
          const secConditionPills = secSounds
            .map(s => (s.conditions && s.conditions.length > 0)
              ? `<div class="flowchart-cond-pill">🔒 Sound plays if: ${s.conditions.map(cd => `${cd.unary === 'NOT' ? 'NOT ' : ''}${cd.var} ${cd.op} ${cd.targetType === 'variable' ? cd.targetVar : cd.value}`).join(' & ')}</div>`
              : '')
            .join('');
          secAudioBadge = `<div class="flowchart-sec-badge">🎵 Overlaid Sounds (${secSounds.length})</div>${secConditionPills}`;
        }

        let choicesHtml = '';
        if (sc.choices && sc.choices.length > 0) {
          choicesHtml = sc.choices.map((c, idx) => {
            const condText = (c.conditions && c.conditions.length > 0) ? `<div class="flowchart-cond-pill">🔒 Req: ${c.conditions.map(cd => `${cd.unary === 'NOT' ? 'NOT ' : ''}${cd.var} ${cd.op} ${cd.targetType === 'variable' ? cd.targetVar : cd.value}`).join(' & ')}</div>` : '';
            const actText = (c.actions && c.actions.length > 0) ? `<div class="flowchart-act-pill">⚡ ${c.actions.map(a => `${a.var} ${a.op} ${a.targetType === 'variable' ? a.targetVar : a.value}`).join(', ')}</div>` : '';
            const isBroken = c.next && !scenes[c.next];
            const targetLabel = !c.next ? 'End' : (isBroken ? c.next + ' (missing!)' : (scenes[c.next].title || c.next));

            return `
              <div class="flowchart-choice-item ${isBroken ? 'choice-broken' : ''}" data-from="${sceneId}" data-target="${c.next || ''}" data-choice-index="${idx}">
                <div class="choice-main-line">
                  <span class="choice-num">${idx + 1}</span>
                  <span class="choice-label">${c.text}</span>
                </div>
                <div class="choice-target-line">&rarr; ${targetLabel}</div>
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

    const zoomViewport = document.createElement('div');
    zoomViewport.className = 'flowchart-zoom-viewport';
    zoomViewport.appendChild(treeWrapper);
    container.appendChild(zoomViewport);
    this.flowchartWrapperEl = treeWrapper;
    this.flowchartViewportEl = zoomViewport;
    this.flowchartSvgEl = svgCanvas;

    container.querySelectorAll('.btn-jump-scene').forEach(btn => {
      btn.onclick = (e) => {
        const targetSceneId = e.currentTarget.dataset.sceneId;
        this.dom.modalFlowchart.classList.add('hidden');
        this.loadScene(targetSceneId, false, true);
      };
    });

    // Two rAFs (rather than a guessed setTimeout delay) reliably wait for layout to
    // settle before measuring card positions, regardless of device/render speed.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.updateFlowchartViewportSize();
      this.drawFlowchartConnections(svgCanvas, treeWrapper);
    }));

    if (typeof ResizeObserver !== 'undefined') {
      if (this.flowchartResizeObserver) this.flowchartResizeObserver.disconnect();
      this.flowchartResizeObserver = new ResizeObserver(() => {
        this.updateFlowchartViewportSize();
        this.drawFlowchartConnections(svgCanvas, treeWrapper);
      });
      this.flowchartResizeObserver.observe(treeWrapper);
    }
  }

  // GUTTER-BASED ROUTING ENGINE & CARD DEFAULT TIMEOUT HOVER HIGHLIGHTING
  drawFlowchartConnections(svg, wrapper) {
    if (!svg || !wrapper) return;
    const zoom = this.flowchartZoom || 1;
    const wrapperRect = wrapper.getBoundingClientRect();
    // getBoundingClientRect() reflects the CSS transform (visually scaled) position,
    // while scrollWidth/scrollHeight (used to size the SVG below) are unaffected by
    // transforms and stay in "natural" units. Dividing every rect-derived delta by
    // the current zoom converts it back into those same natural units, so card
    // positions and the SVG's own coordinate system always agree, at any zoom level.
    const toLocal = (px) => px / zoom;

    svg.setAttribute('width', wrapper.scrollWidth);
    svg.setAttribute('height', wrapper.scrollHeight);

    svg.querySelectorAll('.flowchart-connection-line').forEach(l => l.remove());

    if (this.settings.flowchartLineMode === 'hidden') return;

    const sceneCards = wrapper.querySelectorAll('.flowchart-node-card');
    const cardMap = {};
    sceneCards.forEach(c => cardMap[c.dataset.sceneId] = c);

    let laneCounter = 0;

    sceneCards.forEach(card => {
      const fromId = card.dataset.sceneId;
      const sceneObj = this.storyData.scenes[fromId];
      const choiceItems = card.querySelectorAll('.flowchart-choice-item');

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

          const cardARect = card.getBoundingClientRect();
          const cardBRect = targetCard.getBoundingClientRect();

          const cA_left = toLocal(cardARect.left - wrapperRect.left);
          const cA_right = toLocal(cardARect.right - wrapperRect.left);
          const cB_left = toLocal(cardBRect.left - wrapperRect.left);
          const cB_right = toLocal(cardBRect.right - wrapperRect.left);

          const x1 = toLocal(itemRect.right - wrapperRect.left);
          const y1 = toLocal(itemRect.top + itemRect.height / 2 - wrapperRect.top);

          let x2 = cB_left;
          const y2 = toLocal(targetRect.top - wrapperRect.top) + 25;

          const radius = 10;
          let d = '';

          // Small rotating per-edge lane offset so lines sharing the same gutter
          // fan out slightly instead of drawing exactly on top of one another.
          const lane = laneCounter % 5;
          laneCounter++;
          const laneOffset = (lane - 2) * 9;

          // Target is to the LEFT or a BACKWARD link
          if (cB_left < cA_left - 30) {
            const topMarginY = 25 + Math.abs(laneOffset);

            d = `M ${x1} ${y1} ` +
                `L ${cA_right + 15 - radius} ${y1} ` +
                `Q ${cA_right + 15} ${y1}, ${cA_right + 15} ${y1 - radius} ` +
                `L ${cA_right + 15} ${topMarginY + radius} ` +
                `Q ${cA_right + 15} ${topMarginY}, ${cA_right + 15 - radius} ${topMarginY} ` +
                `L ${cB_left - 15 + radius} ${topMarginY} ` +
                `Q ${cB_left - 15} ${topMarginY}, ${cB_left - 15} ${topMarginY + radius} ` +
                `L ${cB_left - 15} ${y2 - radius} ` +
                `Q ${cB_left - 15} ${y2}, ${cB_left - 15 + radius} ${y2} ` +
                `L ${cB_left} ${y2}`;
          }
          // Target is in the SAME COLUMN
          else if (Math.abs(cB_left - cA_left) < 30) {
            const rightGutterX = cA_right + 25 + laneOffset;
            const dy = y2 >= y1 ? 1 : -1;

            d = `M ${x1} ${y1} ` +
                `L ${rightGutterX - radius} ${y1} ` +
                `Q ${rightGutterX} ${y1}, ${rightGutterX} ${y1 + radius * dy} ` +
                `L ${rightGutterX} ${y2 - radius * dy} ` +
                `Q ${rightGutterX} ${y2}, ${rightGutterX - radius} ${y2} ` +
                `L ${cB_right} ${y2}`;
            x2 = cB_right;
          }
          // Forward link to a RIGHT column
          else {
            const channelX = cA_right + (cB_left - cA_right) / 2 + laneOffset;
            const dy = y2 >= y1 ? 1 : -1;

            if (Math.abs(y2 - y1) < 12) {
              d = `M ${x1} ${y1} L ${x2} ${y2}`;
            } else {
              d = `M ${x1} ${y1} ` +
                  `L ${channelX - radius} ${y1} ` +
                  `Q ${channelX} ${y1}, ${channelX} ${y1 + radius * dy} ` +
                  `L ${channelX} ${y2 - radius * dy} ` +
                  `Q ${channelX} ${y2}, ${channelX + radius} ${y2} ` +
                  `L ${x2} ${y2}`;
            }
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

          item.onmouseenter = (e) => {
            e.stopPropagation();
            svg.querySelectorAll(`path[data-from="${fromId}"]`).forEach(p => {
              p.classList.remove('line-highlight');
              if (this.settings.flowchartLineMode === 'hover') p.style.display = 'none';
            });
            path.style.display = 'block';
            path.classList.add('line-highlight');
          };

          item.onmouseleave = (e) => {
            e.stopPropagation();
            path.classList.remove('line-highlight');
            if (this.settings.flowchartLineMode === 'hover') {
              path.style.display = 'none';
            }
            if (card.contains(e.relatedTarget) && defaultTargetId) {
              const defaultPath = svg.querySelector(`path[data-from="${fromId}"][data-to="${defaultTargetId}"]`);
              if (defaultPath) {
                defaultPath.style.display = 'block';
                defaultPath.classList.add('line-highlight');
              }
            }
          };
        }
      });

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
    const resolved = CYOAParser.resolveShareLink(url);
    if (resolved.unsupported) {
      this.showToast(resolved.reason, 'error');
      return;
    }
    if (resolved.note) this.showToast(resolved.note, 'info');
    this.showToast("Fetching story package from URL...", "info");
    try {
      const response = await fetch(resolved.url);
      if (!response.ok) {
        throw new Error("HTTP " + response.status + ": " + response.statusText);
      }
      const blob = await response.blob();
      if (!(await CYOAParser.looksLikeZip(blob))) {
        throw new Error("That link didn't return a .cyoa/zip file — the host may require login, block direct downloads, or the link may point to a share page rather than the file itself. Try downloading it manually and using \"Open .cyoa\" instead.");
      }
      const filename = url.split('/').pop().split('?')[0] || "downloaded_story.cyoa";
      const file = new File([blob], filename, { type: "application/zip" });
      await this.loadCyoaFile(file);
    } catch (err) {
      console.error(err);
      const isNetworkErr = err instanceof TypeError;
      const msg = isNetworkErr
        ? "Couldn't reach that link. It may not allow direct downloads from other websites (a CORS restriction the host controls, not something this app can override), or the link may be private/expired."
        : err.message;
      this.showToast("Failed to load story from URL: " + msg, "error");
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
    this.savePrefs();
  }

  // --- PREFERENCES (theme, volume, speed, bell) persisted across sessions ---
  loadPrefs() {
    let prefs = {};
    try {
      const raw = localStorage.getItem('cyoa-prefs');
      if (raw) prefs = JSON.parse(raw) || {};
    } catch (e) { /* localStorage unavailable (private browsing, etc.) -- fall back to defaults */ }

    if (typeof prefs.bellEnabled === 'boolean') this.settings.bellEnabled = prefs.bellEnabled;
    if (typeof prefs.flowchartLineMode === 'string') this.settings.flowchartLineMode = prefs.flowchartLineMode;
    if (this.dom.btnToggleFlowchartLines) {
      this.dom.btnToggleFlowchartLines.textContent = "Lines: " + this.settings.flowchartLineMode.toUpperCase();
    }

    const volume = typeof prefs.volume === 'number' ? Math.max(0, Math.min(1, prefs.volume)) : 1;
    this.lastNonZeroVolume = volume > 0 ? volume : 1;
    if (this.dom.audio) { this.dom.audio.volume = volume; this.dom.audio.muted = (volume === 0); }
    if (this.dom.volumeSlider) this.dom.volumeSlider.value = volume;
    this.updateVolumeProgress(volume);
    this.updateVolumeIcons(volume === 0);

    if (this.dom.selectSpeed && typeof prefs.speed === 'number') {
      const match = Array.from(this.dom.selectSpeed.options).find(o => parseFloat(o.value) === prefs.speed);
      if (match) this.dom.selectSpeed.value = match.value;
    }

    if (this.dom.iconBellOn && this.dom.iconBellOff) {
      this.dom.iconBellOn.classList.toggle('hidden', !this.settings.bellEnabled);
      this.dom.iconBellOff.classList.toggle('hidden', this.settings.bellEnabled);
    }

    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
    const theme = (prefs.theme === 'light' || prefs.theme === 'dark') ? prefs.theme : (prefersLight ? 'light' : 'dark');
    this.applyTheme(theme, false);
  }

  savePrefs() {
    try {
      const prefs = {
        bellEnabled: this.settings.bellEnabled,
        flowchartLineMode: this.settings.flowchartLineMode,
        volume: this.dom.audio ? this.dom.audio.volume : 1,
        speed: this.dom.selectSpeed ? parseFloat(this.dom.selectSpeed.value) : 1,
        theme: document.documentElement.getAttribute('data-theme') || 'dark'
      };
      localStorage.setItem('cyoa-prefs', JSON.stringify(prefs));
    } catch (e) { /* localStorage unavailable -- preferences just won't persist */ }
  }

  applyTheme(theme, persist = true) {
    document.documentElement.setAttribute('data-theme', theme);
    if (this.dom.iconThemeLight && this.dom.iconThemeDark) {
      this.dom.iconThemeLight.classList.toggle('hidden', theme !== 'dark');
      this.dom.iconThemeDark.classList.toggle('hidden', theme !== 'light');
    }
    if (this.dom.btnToggleTheme) {
      this.dom.btnToggleTheme.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
      this.dom.btnToggleTheme.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
    if (persist) this.savePrefs();
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    this.applyTheme(current === 'dark' ? 'light' : 'dark');
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
          audioEl.playbackRate = this.dom.selectSpeed ? (parseFloat(this.dom.selectSpeed.value) || 1) : 1;

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
      if (this.dom.modalShortcuts) this.dom.modalShortcuts.classList.add('hidden');
      return;
    }
    if (e.key === '?') {
      if (this.dom.modalShortcuts) this.dom.modalShortcuts.classList.remove('hidden');
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
